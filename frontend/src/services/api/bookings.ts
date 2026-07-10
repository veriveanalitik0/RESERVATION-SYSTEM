/**
 * Rezervasyon API'si — kullanıcı booking CRUD/aşama akışı ve admin
 * inceleme/atama/aşama yönetimi metotları.
 */
import type {
  Booking,
  CreateBookingPayload,
  DuplicateMatch,
  ReviewBookingPayload,
  StageEvent,
} from '../../types';
import { request, staffKind } from './core';

export const bookingsApi = {
  async listUserBookings() {
    return request<{ bookings: Booking[] }>('/user/bookings', { kind: 'user' });
  },

  /** Onaylı rezervasyonu iptal et — kayıt 'cancelled' olur, oda boşalır. */
  async cancelApprovedBooking(bookingId: string) {
    return request<{ booking: Booking }>(`/user/bookings/${encodeURIComponent(bookingId)}/cancel`, {
      method: 'POST',
      kind: 'user',
    });
  },

  /** Dashboard ilerleme notu — yalnız sahibi, yalnız onaylı booking. */
  async updateBookingProgress(bookingId: string, progressNote: string) {
    return request<{ booking: Booking }>(`/user/bookings/${encodeURIComponent(bookingId)}/progress`, {
      method: 'PUT',
      body: { progressNote },
      kind: 'user',
    });
  },

  async createBooking(payload: CreateBookingPayload) {
    // Yanıt: oluşturulan booking + (varsa) otomatik duplicate-tespiti uyarısı (#4).
    return request<{ booking: Booking; duplicateWarning: DuplicateMatch | null }>(
      '/user/bookings',
      {
        method: 'POST',
        body: payload,
        kind: 'user',
      }
    );
  },

  async updateBooking(id: string, payload: CreateBookingPayload) {
    return request<{ booking: Booking }>(`/user/bookings/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
      kind: 'user',
    });
  },

  async deleteBooking(id: string) {
    return request<{ deleted: boolean }>(`/user/bookings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: 'user',
    });
  },

  /** Kullanıcı aşamayı kendisi ilerletir (canlıya kadar — canlı geçişi onaylıdır). */
  async selfAdvanceStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/user/bookings/${encodeURIComponent(bookingId)}/advance-stage`,
      { method: 'POST', kind: 'user' }
    );
  },

  /** Kullanıcı admin'den CANLIYA geçiş onayı talep eder. */
  async requestStageAdvance(bookingId: string, note?: string) {
    return request<{ booking: Booking }>(
      `/user/bookings/${encodeURIComponent(bookingId)}/request-advance`,
      { method: 'POST', body: { note }, kind: 'user' }
    );
  },

  /* ============ ADMIN ============ */

  async listAdminBookings(status?: string) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<{ bookings: Booking[] }>(`/admin/bookings${qs}`, { kind: staffKind() });
  },

  async reviewBooking(id: string, payload: ReviewBookingPayload) {
    return request<{
      booking: Booking;
      autoWaitlisted: boolean;
      waitlistPosition?: number;
    }>(`/admin/bookings/${id}/review`, {
      method: 'POST',
      body: payload,
      kind: staffKind(),
    });
  },

  async adminReassignBooking(bookingId: string, roomId: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/reassign`,
      { method: 'POST', body: { roomId }, kind: staffKind() }
    );
  },

  async adminReassignBookingUser(bookingId: string, userId: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/reassign-user`,
      { method: 'POST', body: { userId }, kind: staffKind() }
    );
  },

  async adminDeleteBooking(bookingId: string) {
    return request<{
      deleted: boolean;
      roomId: string;
      userId: string;
      wasApproved: boolean;
    }>(`/admin/bookings/${encodeURIComponent(bookingId)}`, {
      method: 'DELETE',
      kind: staffKind(),
    });
  },

  /** Booking detayı + yaşam döngüsü zaman çizelgesi (modal "Geçmiş" tab'ı için). */
  async adminGetBookingDetail(bookingId: string) {
    return request<{ booking: Booking; stageEvents: StageEvent[] }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}`,
      { kind: staffKind() }
    );
  },

  async adminAdvanceBookingStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/advance-stage`,
      { method: 'POST', kind: staffKind() }
    );
  },

  async adminRegressBookingStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/regress-stage`,
      { method: 'POST', kind: staffKind() }
    );
  },

  async adminSetBookingReviewTrack(bookingId: string, track: 'standard' | 'swat') {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/review-track`,
      { method: 'POST', body: { track }, kind: staffKind() }
    );
  },

  async adminRejectStageAdvanceRequest(bookingId: string, note?: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/advance-request`,
      { method: 'DELETE', body: { note }, kind: staffKind() }
    );
  },
};
