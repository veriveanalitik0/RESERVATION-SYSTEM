/**
 * Oda & randevu API'si — oda listesi/müsaitlik/ısı-haritası, kiosk uçları ve
 * günlük randevu (appointment) metotları.
 */
import type {
  Appointment,
  KioskData,
  KioskRoom,
  Room,
  RoomApptHeatmap,
  RoomAvailability,
  RoomWithOccupancy,
} from '../../types';
import { request, staffKind } from './core';

export const roomsApi = {
  async listUserRooms(from?: string, to?: string) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{ rooms: Room[] }>(`/user/rooms${qs}`, { kind: 'user' });
  },

  /** Oda müsaitlik detayı — boş günler, dolu tarih aralıkları, dolu saatler. */
  async roomAvailability(roomId: string, params?: { from?: string; to?: string }) {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<RoomAvailability>(
      `/user/rooms/${encodeURIComponent(roomId)}/availability${suffix}`,
      { kind: 'user' }
    );
  },

  /** Appointment (saatli) ısı-haritası — oda × gün, saat detaylı (#5). */
  async roomAppointmentHeatmap(params?: { from?: string; to?: string }) {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<RoomApptHeatmap>(`/user/rooms/appointment-heatmap${suffix}`, { kind: 'user' });
  },

  /** Kiosk seçici — aktif odalar (public). */
  async kioskRooms() {
    return request<{ rooms: KioskRoom[] }>('/public/rooms', {
      kind: 'user',
      auth: false,
      noAuth: true,
    });
  },

  /** Bir odanın kiosk verisi — son görsel + oda (public). */
  async roomKiosk(roomId: string) {
    return request<KioskData>(`/public/rooms/${encodeURIComponent(roomId)}/kiosk`, {
      kind: 'user',
      auth: false,
      noAuth: true,
    });
  },

  /* ============ ODALAR — admin doluluk + atama ============ */

  async adminRoomsOccupancy() {
    return request<{ rooms: RoomWithOccupancy[] }>('/admin/rooms/occupancy', {
      kind: staffKind(),
    });
  },

  /* ============ APPOINTMENTS — günlük randevular ============ */

  async listUserAppointments(opts: {
    from?: string;
    to?: string;
    includeCancelled?: boolean;
  } = {}) {
    const qs = new URLSearchParams();
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.includeCancelled) qs.set('includeCancelled', 'true');
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ appointments: Appointment[] }>(
      `/user/appointments${query}`,
      { kind: 'user' }
    );
  },

  async listBookingAppointments(bookingId: string) {
    return request<{ appointments: Appointment[] }>(
      `/user/bookings/${encodeURIComponent(bookingId)}/appointments`,
      { kind: 'user' }
    );
  },

  async createAppointment(payload: {
    bookingId: string;
    startAt: string;
    endAt: string;
    title?: string;
    notes?: string;
  }) {
    return request<{ appointment: Appointment }>('/user/appointments', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async cancelAppointment(id: string) {
    return request<{ cancelled: boolean }>(
      `/user/appointments/${encodeURIComponent(id)}`,
      { method: 'DELETE', kind: 'user' }
    );
  },

  async adminListAppointments(opts: {
    from?: string;
    to?: string;
    includeCancelled?: boolean;
  } = {}) {
    const qs = new URLSearchParams();
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.includeCancelled) qs.set('includeCancelled', 'true');
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ appointments: Appointment[] }>(
      `/admin/appointments${query}`,
      { kind: staffKind() }
    );
  },

  async adminCancelAppointment(id: string) {
    return request<{ cancelled: boolean }>(
      `/admin/appointments/${encodeURIComponent(id)}`,
      { method: 'DELETE', kind: staffKind() }
    );
  },
};
