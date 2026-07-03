/**
 * Booking servisi.
 *
 * Güvenlik:
 * - app_security.md §10: Race condition için transaction içinde uygunluk kontrolü.
 * - app_security.md §5 (IDOR): User'lar yalnızca kendi booking'lerini görür.
 * - app_security.md §3: Tüm input zod ile doğrulanır, sorgular parameterized.
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun, dbTx } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import type { CreateBookingInput, ReviewBookingInput } from '../validators/schemas';
import {
  bookingTextForEmbedding,
  deleteBookingEmbedding,
  saveBookingEmbedding,
} from './embedding.service';
import { broadcastBooking, broadcastToAdmins } from './sse.service';
import { recordAudit } from './audit.service';
import { recordStageEvent } from './governance.service';
import { logger } from '../utils/logger';
import { maskToWeekdays, weekdaysToMask } from '../utils/weekdays';
import { addMonthsEndDate, periodEndDate } from '../utils/dates';

import type { Booking as SharedBooking, LifecycleStage } from '@klab/shared';

export type { LifecycleStage };

export const LIFECYCLE_STAGE_ORDER: LifecycleStage[] = [
  'application',
  'development',
  'stage',
  'production',
  'live',
];

/**
 * Booking DTO — TEK kaynak @klab/shared (frontend ile birebir aynı tip).
 * Alan ekleme/değiştirme shared/index.d.ts üzerinden yapılır.
 */
export type BookingDto = SharedBooking;

interface BookingRow {
  id: string;
  user_id: string;
  user_email?: string;
  user_full_name?: string;
  user_has_photo?: boolean;
  room_id: string;
  room_name: string;
  room_code: string;
  period_months: number | null;
  period_key: '1w' | '2w' | '1m' | null;
  weekday_mask: number;
  start_date: string;
  end_date: string;
  project_name: string;
  project_description: string;
  help_needed: string;
  technologies: string;
  status: 'pending' | 'approved' | 'rejected' | 'feedback_requested' | 'cancelled';
  admin_feedback: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_decision: 'approved' | 'rejected' | null;
  analyst_decision: 'approved' | 'rejected' | null;
  lifecycle_stage: LifecycleStage;
  stage_entered_at: string;
  review_track: 'standard' | 'swat';
  stage_advance_requested_at: string | null;
  stage_advance_note: string | null;
  showcase_image_url: string | null;
  progress_note?: string | null;
  progress_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDto(r: BookingRow): BookingDto {
  let techs: string[] = [];
  try {
    const parsed = JSON.parse(r.technologies) as unknown;
    if (Array.isArray(parsed)) techs = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    techs = [];
  }
  return {
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    userFullName: r.user_full_name,
    // Base64 yerine cache'lenebilir URL — payload şişmesini önler.
    userPhoto: r.user_has_photo ? `/api/public/users/${r.user_id}/photo` : null,
    roomId: r.room_id,
    roomName: r.room_name,
    roomCode: r.room_code,
    period: r.period_key ?? null,
    periodMonths: r.period_months ?? null,
    weekdays: maskToWeekdays(r.weekday_mask),
    startDate: r.start_date,
    endDate: r.end_date,
    projectName: r.project_name,
    projectDescription: r.project_description,
    helpNeeded: r.help_needed,
    technologies: techs,
    status: r.status,
    adminFeedback: r.admin_feedback,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    adminDecision: r.admin_decision ?? null,
    analystDecision: r.analyst_decision ?? null,
    lifecycleStage: r.lifecycle_stage,
    stageEnteredAt: r.stage_entered_at,
    reviewTrack: r.review_track,
    stageAdvanceRequestedAt: r.stage_advance_requested_at,
    stageAdvanceNote: r.stage_advance_note,
    showcaseImageUrl: r.showcase_image_url ?? null,
    progressNote: r.progress_note ?? null,
    progressUpdatedAt: r.progress_updated_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Bitiş tarihi hesabı utils/dates'e taşındı (ay taşması kıskaçlı, waitlist ile ortak).

/** YYYY-MM-DD → DD.MM.YYYY (kullanıcıya gösterilen TR tarih). */
function fmtTrDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return d && m && y ? `${d}.${m}.${y}` : ymd;
}

/** YYYY-MM-DD → ertesi gün (en erken müsait tarih). */
function nextDayYmd(ymd: string): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

/**
 * Çakışma hatası mesajı — odanın hangi tarih aralığında dolu olduğunu ve en
 * erken ne zaman müsait olacağını söyler ("ne zamana kadar dolu" görünürlüğü).
 */
function roomBusyMessage(busyStart: string, busyEnd: string): string {
  return (
    `Bu oda ${fmtTrDate(busyStart)} – ${fmtTrDate(busyEnd)} tarihleri arasında dolu. ` +
    `En erken ${fmtTrDate(nextDayYmd(busyEnd))} tarihinden itibaren rezervasyon yapabilirsiniz.`
  );
}

// Hafta günü ↔ maske yardımcıları utils/weekdays'e taşındı (waitlist ile paylaşılıyor).

function isValidStartDate(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(`${dateStr}T00:00:00`);
  return start.getTime() >= today.getTime();
}

/**
 * Oda-bazlı transaction advisory lock. Aynı oda için eşzamanlı rezervasyon
 * işlemlerini (oluştur / düzenle / onayla / yeniden ata) serialize eder; böylece
 * iki istek aynı anda boş görüp ikisi de yazamaz (çift rezervasyon race'i).
 * Lock transaction sonunda (COMMIT/ROLLBACK) otomatik bırakılır → dbTx içinde,
 * çakışma SELECT'inden ÖNCE çağrılmalı (app_security §10).
 */
async function lockRoomForBooking(roomId: string): Promise<void> {
  await dbRun('SELECT pg_advisory_xact_lock(hashtext(?))', [`room:${roomId}`]);
}

export async function createBooking(userId: string, input: CreateBookingInput): Promise<BookingDto> {
  if (!isValidStartDate(input.startDate)) {
    throw new HttpError(400, 'Başlangıç tarihi bugünden önce olamaz.', 'INVALID_START_DATE');
  }

  // Manuel bitiş verilmişse o (esnek/kısa süre), yoksa periyottan türetilen tarih.
  const endDate = input.endDate ?? periodEndDate(input.startDate, input.period);

  const bookingId = await dbTx(async () => {
    const room = await dbOne(`SELECT id, code, name FROM rooms WHERE id = ? AND is_active = 1`, [input.roomId]) as { id: string; code: string; name: string } | undefined;

    if (!room) {
      throw new HttpError(404, 'Oda bulunamadı.', 'ROOM_NOT_FOUND');
    }

    const weekdayMask = weekdaysToMask(input.weekdays);

    // Çakışma kontrolü + INSERT'i aynı oda için serialize et (çift rezervasyon race'i).
    await lockRoomForBooking(input.roomId);

    const conflict = await dbOne(`SELECT MIN(start_date) AS busy_start, MAX(end_date) AS busy_end
         FROM bookings
         WHERE room_id = ?
           AND status IN ('pending', 'approved', 'feedback_requested')
           AND NOT (end_date < ? OR start_date > ?)
           AND (weekday_mask & ?) != 0`, [input.roomId, input.startDate, endDate, weekdayMask]) as
      | { busy_start: string | null; busy_end: string | null }
      | undefined;

    if (conflict?.busy_end) {
      throw new HttpError(
        409,
        roomBusyMessage(conflict.busy_start!, conflict.busy_end),
        'ROOM_NOT_AVAILABLE'
      );
    }

    const id = nanoid();
    await dbRun(`INSERT INTO bookings (
        id, user_id, room_id, period_key, weekday_mask, start_date, end_date,
        project_name, project_description, help_needed, technologies, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, [id,
      userId,
      input.roomId,
      input.period,
      weekdayMask,
      input.startDate,
      endDate,
      input.projectName,
      input.projectDescription,
      input.helpNeeded,
      JSON.stringify(input.technologies)]);

    return id;
  });
  const created = await getBookingByIdForUser(userId, bookingId) as BookingDto;

  // Embedding hesapla (fire-and-forget — response'u bekletme)
  const embText = bookingTextForEmbedding({
    projectName: created.projectName,
    projectDescription: created.projectDescription,
    technologies: created.technologies,
  });
  saveBookingEmbedding(bookingId, embText).catch((err) =>
    logger.warn('embedding_create_failed', { bookingId, err: (err as Error).message })
  );

  // SSE event
  broadcastBooking(
    { type: 'booking.created', data: { bookingId, status: created.status } },
    userId
  );

  // In-app bildirim: aktif admin'lere yeni talep
  const admins = await dbAll("SELECT id FROM admins WHERE status = 1", []) as Array<{ id: string }>;
  if (admins.length > 0) {
    void import('./notification-center.service').then((m) => {
      m.pushNotificationBulk(admins.map((a) => a.id), 'admin', {
        category: 'booking',
        title: 'Yeni randevu talebi',
        body: `${created.userFullName ?? 'Bir kullanıcı'} — "${created.projectName}" (${created.roomCode})`,
        link: '/admin',
      });
    }).catch((err) => logger.warn('booking_created_notify_failed', { err: (err as Error).message }));
  }

  // Analitik danışman(lar)a bilgilendirme — talepleri GÖRÜNTÜLER (onay yetkisi yok).
  const analysts = await dbAll(
    "SELECT id FROM users WHERE status = 1 AND governance_role = 'analitik_danisman'", []
  ) as Array<{ id: string }>;
  if (analysts.length > 0) {
    void import('./notification-center.service').then((m) => {
      m.pushNotificationBulk(analysts.map((a) => a.id), 'danisman', {
        category: 'booking',
        title: 'Yeni randevu talebi (bilgilendirme)',
        body: `${created.userFullName ?? 'Bir kullanıcı'} — "${created.projectName}" (${created.roomCode})`,
        link: '/danisman',
      });
    }).catch((err) => logger.warn('booking_created_notify_analyst_failed', { err: (err as Error).message }));
  }

  return created;
}

/**
 * Kullanıcının kendi booking'ini düzenler.
 *
 * Güvenlik:
 * - IDOR koruması: user_id + booking_id eşleşmesi zorunlu (app_security §5)
 * - Status kısıtı: sadece 'pending' veya 'feedback_requested' düzenlenebilir.
 *   Admin onayı verilmiş (approved) veya reddedilmiş (rejected) booking değişmez.
 * - Düzenleme sonrası status → 'pending' (admin tekrar incelesin)
 * - Transaction içinde uygunluk yeniden kontrol edilir (race condition koruması, §10)
 */
export async function updateBooking(
  userId: string,
  bookingId: string,
  input: CreateBookingInput
): Promise<BookingDto> {
  // Manuel bitiş verilmişse o (esnek/kısa süre), yoksa periyottan türetilen tarih.
  const endDate = input.endDate ?? periodEndDate(input.startDate, input.period);

  await dbTx(async () => {
    // 1) Booking varlığı + sahiplik + status kontrolü
    const existing = await dbOne(`SELECT id, status, room_id, user_id
         FROM bookings WHERE id = ? AND user_id = ?`, [bookingId, userId]) as
      | { id: string; status: string; room_id: string; user_id: string }
      | undefined;

    if (!existing) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    if (existing.status !== 'pending' && existing.status !== 'feedback_requested') {
      throw new HttpError(
        409,
        'Bu durumdaki bir talep düzenlenemez. Sadece beklemede veya düzeltme talep edilen istekler düzenlenebilir.',
        'BOOKING_NOT_EDITABLE'
      );
    }

    // 2) Oda var mı?
    const room = await dbOne(`SELECT id FROM rooms WHERE id = ? AND is_active = 1`, [input.roomId]) as { id: string } | undefined;
    if (!room) throw new HttpError(404, 'Oda bulunamadı.', 'ROOM_NOT_FOUND');

    // 3) Gün-bazlı çakışma — kendi booking'i hariç, aynı gün + tarih örtüşmesi
    const weekdayMask = weekdaysToMask(input.weekdays);
    await lockRoomForBooking(input.roomId);
    const conflict = await dbOne(`SELECT MIN(start_date) AS busy_start, MAX(end_date) AS busy_end
         FROM bookings
         WHERE room_id = ?
           AND id != ?
           AND status IN ('pending', 'approved', 'feedback_requested')
           AND NOT (end_date < ? OR start_date > ?)
           AND (weekday_mask & ?) != 0`, [input.roomId, bookingId, input.startDate, endDate, weekdayMask]) as
      | { busy_start: string | null; busy_end: string | null }
      | undefined;
    if (conflict?.busy_end) {
      throw new HttpError(
        409,
        roomBusyMessage(conflict.busy_start!, conflict.busy_end),
        'ROOM_NOT_AVAILABLE'
      );
    }

    // 4) Güncelle: düzenleme sonrası admin tekrar incelesin → status='pending',
    //    önceki karar sıfırlanır (miras analyst_decision da temizlenir).
    await dbRun(`UPDATE bookings
       SET room_id = ?, period_key = ?, period_months = NULL, weekday_mask = ?, start_date = ?, end_date = ?,
           project_name = ?, project_description = ?, help_needed = ?, technologies = ?,
           status = 'pending', admin_feedback = NULL, reviewed_by = NULL, reviewed_at = NULL,
           admin_decision = NULL, analyst_decision = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [input.roomId,
      input.period,
      weekdayMask,
      input.startDate,
      endDate,
      input.projectName,
      input.projectDescription,
      input.helpNeeded,
      JSON.stringify(input.technologies),
      bookingId]);
  });
  const updated = await getBookingByIdForUser(userId, bookingId) as BookingDto;

  // Embedding güncelle
  const embText = bookingTextForEmbedding({
    projectName: updated.projectName,
    projectDescription: updated.projectDescription,
    technologies: updated.technologies,
  });
  saveBookingEmbedding(bookingId, embText).catch((err) =>
    logger.warn('embedding_update_failed', { bookingId, err: (err as Error).message })
  );

  broadcastBooking(
    { type: 'booking.updated', data: { bookingId, status: updated.status } },
    userId
  );

  return updated;
}

/**
 * Kullanıcı kendi booking'ini geri çeker / kalıcı siler.
 *
 * Güvenlik:
 * - IDOR: user_id + booking_id eşleşmesi
 * - Status kısıtı:
 *     pending / feedback_requested       → geri çekme
 *     cancelled                          → iptal edilmiş proje kalıcı silme
 *     approved + lifecycle_stage='live'  → tamamlanmış ("hazır") proje kalıcı silme
 *   Aktif onaylı rezervasyon silinemez — önce iptal (cancelApprovedBooking) gerekir.
 * - Hard delete: FK cascade randevu/embedding/beğeni/yorumları, kod stage
 *   olaylarını temizler.
 */
export async function deleteBooking(userId: string, bookingId: string): Promise<{ deleted: boolean; roomId: string }> {

  const roomId = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, status, room_id, lifecycle_stage FROM bookings WHERE id = ? AND user_id = ?`, [bookingId, userId]) as
      | { id: string; status: string; room_id: string; lifecycle_stage: LifecycleStage }
      | undefined;

    if (!existing) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    // Silinebilir durumlar:
    //  - pending / feedback_requested → talebi geri çekme (öteden beri var)
    //  - cancelled                    → iptal edilmiş proje temizliği
    //  - approved + live              → yaşam döngüsü tamamlanmış ("hazır") proje temizliği
    const withdrawable = existing.status === 'pending' || existing.status === 'feedback_requested';
    const purgeable =
      existing.status === 'cancelled' ||
      (existing.status === 'approved' && existing.lifecycle_stage === 'live');
    if (!withdrawable && !purgeable) {
      throw new HttpError(
        409,
        'Bu talep silinemez. Yalnız bekleyen/düzeltme istenen talepler geri çekilebilir; ' +
          'iptal edilmiş veya canlıya alınmış (tamamlanmış) projeler kalıcı silinebilir. ' +
          'Aktif onaylı bir rezervasyonu önce iptal edin.',
        'BOOKING_NOT_WITHDRAWABLE'
      );
    }

    // Komple silme: FK cascade'ler randevu/embedding/beğeni/yorumları temizler;
    // stage olayları FK'sız — elle temizlenir (yetim satır kalmasın).
    await dbRun('DELETE FROM project_stage_events WHERE request_id = ?', [bookingId]);
    await dbRun('DELETE FROM bookings WHERE id = ?', [bookingId]);
    return existing.room_id;
  });
  await deleteBookingEmbedding(bookingId);

  broadcastBooking({ type: 'booking.withdrawn', data: { bookingId } }, userId);
  broadcastToAdmins({ type: 'booking.withdrawn', data: { bookingId, roomId } });

  return { deleted: true, roomId };
}

/**
 * ONAYLI rezervasyon iptali — kullanıcı (sahibi) veya admin.
 *
 * deleteBooking'den farkı: approved kayıt SİLİNMEZ (tarih bütünlüğü/audit),
 * status='cancelled' yapılır. Oda kapasitesi serbest kalır (çakışma sorguları
 * yalnız pending/approved/feedback_requested sayar) ve bekleme listesi
 * promotion'ı tetiklenir.
 */
export async function cancelApprovedBooking(
  bookingId: string,
  actor: { id: string; type: 'user' | 'admin' }
): Promise<BookingDto> {
  const roomId = await dbTx(async () => {
    const existing = await dbOne(
      `SELECT id, user_id, room_id, status FROM bookings WHERE id = ?`,
      [bookingId]
    ) as { id: string; user_id: string; room_id: string; status: string } | undefined;

    if (!existing || (actor.type === 'user' && existing.user_id !== actor.id)) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    if (existing.status !== 'approved') {
      throw new HttpError(409, 'Yalnız onaylı rezervasyonlar iptal edilebilir.', 'BOOKING_NOT_APPROVED');
    }

    await dbRun(
      `UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [bookingId]
    );
    // Bu rezervasyona bağlı planlanmış saatli randevular da iptal edilir.
    await dbRun(
      `UPDATE appointments SET status = 'cancelled' WHERE booking_id = ? AND status = 'scheduled'`,
      [bookingId]
    );
    return existing.room_id;
  });

  recordAudit({
    eventType: 'booking.updated',
    subjectId: actor.id,
    subjectType: actor.type,
    success: true,
    details: { bookingId, action: 'cancel_approved', roomId },
  });

  const cancelled = await getBookingByIdAdmin(bookingId) as BookingDto;

  broadcastBooking({ type: 'booking.withdrawn', data: { bookingId, cancelled: true } }, cancelled.userId);
  broadcastToAdmins({ type: 'booking.withdrawn', data: { bookingId, roomId, cancelled: true } });

  // Oda boşaldı — bekleme listesindeki ilk uygun kişiyi terfi ettir.
  // Döngüsel import olmaması için dinamik import (waitlist → booking yönü zaten var).
  try {
    const { tryPromoteForRoom } = await import('./waitlist.service');
    await tryPromoteForRoom(roomId);
  } catch (err) {
    logger.warn('cancel_promote_failed', { roomId, err: (err as Error).message });
  }

  return cancelled;
}

export async function listUserBookings(userId: string): Promise<BookingDto[]> {
  const rows = await dbAll(`SELECT b.*, r.name AS room_name, r.code AS room_code,
              u.email AS user_email, u.full_name AS user_full_name, (u.profile_photo IS NOT NULL) AS user_has_photo
       FROM bookings b
       INNER JOIN rooms r ON r.id = b.room_id
       INNER JOIN users u ON u.id = b.user_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`, [userId]) as BookingRow[];
  return rows.map(rowToDto);
}

/**
 * Kullanıcının kendi ilerleme notunu günceller (dashboard "ne üzerinde
 * çalışıyorum" alanı). Yalnız sahibi ve yalnız onaylı booking'lerde.
 */
export async function updateBookingProgress(
  userId: string,
  bookingId: string,
  progressNote: string
): Promise<BookingDto> {
  const existing = await dbOne(
    `SELECT id, user_id, status FROM bookings WHERE id = ?`,
    [bookingId]
  ) as { id: string; user_id: string; status: string } | undefined;

  if (!existing || existing.user_id !== userId) {
    throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
  }
  if (existing.status !== 'approved') {
    throw new HttpError(409, 'İlerleme notu yalnız onaylı rezervasyonlarda güncellenebilir.', 'BOOKING_NOT_APPROVED');
  }

  await dbRun(
    `UPDATE bookings
       SET progress_note = ?, progress_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [progressNote || null, bookingId]
  );

  const updated = await getBookingByIdForUser(userId, bookingId);
  if (!updated) throw new HttpError(500, 'Booking güncellendi ama okunamadı.', 'INTERNAL');
  return updated;
}

export async function getBookingByIdForUser(userId: string, bookingId: string): Promise<BookingDto | undefined> {
  const row = await dbOne(`SELECT b.*, r.name AS room_name, r.code AS room_code,
              u.email AS user_email, u.full_name AS user_full_name, (u.profile_photo IS NOT NULL) AS user_has_photo
       FROM bookings b
       INNER JOIN rooms r ON r.id = b.room_id
       INNER JOIN users u ON u.id = b.user_id
       WHERE b.id = ? AND b.user_id = ?
       LIMIT 1`, [bookingId, userId]) as BookingRow | undefined;
  return row ? rowToDto(row) : undefined;
}

export async function listAllBookings(filters?: {
  status?: 'pending' | 'approved' | 'rejected' | 'feedback_requested';
  /** Sayfalama — tablo büyüdükçe sınırsız SELECT pool'u kilitlemesin. */
  limit?: number;
  offset?: number;
}): Promise<BookingDto[]> {
  let sql = `
    SELECT b.*,
           r.name AS room_name, r.code AS room_code,
           u.email AS user_email, u.full_name AS user_full_name, (u.profile_photo IS NOT NULL) AS user_has_photo
    FROM bookings b
    INNER JOIN rooms r ON r.id = b.room_id
    INNER JOIN users u ON u.id = b.user_id
  `;
  const params: unknown[] = [];

  if (filters?.status) {
    sql += ' WHERE b.status = ?';
    params.push(filters.status);
  }

  sql += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
  params.push(Math.min(Math.max(filters?.limit ?? 200, 1), 500));
  params.push(Math.max(filters?.offset ?? 0, 0));

  const rows = await dbAll(sql, [...params]) as BookingRow[];
  return rows.map(rowToDto);
}

export async function getBookingByIdAdmin(bookingId: string): Promise<BookingDto | undefined> {
  const row = await dbOne(`SELECT b.*,
              r.name AS room_name, r.code AS room_code,
              u.email AS user_email, u.full_name AS user_full_name, (u.profile_photo IS NOT NULL) AS user_has_photo
       FROM bookings b
       INNER JOIN rooms r ON r.id = b.room_id
       INNER JOIN users u ON u.id = b.user_id
       WHERE b.id = ?
       LIMIT 1`, [bookingId]) as BookingRow | undefined;
  return row ? rowToDto(row) : undefined;
}

export interface ReviewBookingResult {
  booking: BookingDto;
  /** Admin approve denedi ama oda doluydu → otomatik waitlist'e taşındı. */
  autoWaitlisted?: boolean;
  /** Waitlist'e taşındıysa atanmış sıra numarası. */
  waitlistPosition?: number;
  /** Onay durumu — bu review sonrası (analystDecision miras alan, hep null). */
  approvalState: {
    adminDecision: 'approved' | 'rejected' | null;
    analystDecision: 'approved' | 'rejected' | null;
    finalStatus: BookingDto['status'];
  };
}

export async function reviewBooking(
  adminId: string,
  bookingId: string,
  input: ReviewBookingInput
): Promise<ReviewBookingResult> {
  // TEK ONAY: talebi yalnız ADMIN sonuçlandırır (onay/ret/düzeltme isteği).
  // Analitik danışman talepleri sadece görüntüler — karar yetkisi yoktur.

  // Bu review sonrası booking'in varacağı durum.
  let newStatus: BookingDto['status'] = 'pending';
  let autoWaitlistedPosition: number | null = null;

  await dbTx(async () => {
    const existing = await dbOne(`SELECT id, user_id, status, room_id, period_months, period_key, weekday_mask, start_date, end_date,
                project_name, project_description, help_needed, technologies, admin_decision, analyst_decision
         FROM bookings WHERE id = ?`, [bookingId]) as
      | {
          id: string;
          user_id: string;
          status: string;
          room_id: string;
          period_months: number | null;
          period_key: '1w' | '2w' | '1m' | null;
          weekday_mask: number;
          start_date: string;
          end_date: string;
          project_name: string;
          project_description: string;
          help_needed: string;
          technologies: string;
          admin_decision: 'approved' | 'rejected' | null;
          analyst_decision: 'approved' | 'rejected' | null;
        }
      | undefined;

    if (!existing) throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');

    // Yalnız değerlendirilebilir durumlar incelenebilir (sonuçlanmış talep tekrar incelenemez).
    if (existing.status !== 'pending' && existing.status !== 'feedback_requested') {
      throw new HttpError(409, 'Bu talep zaten sonuçlandırılmış.', 'BOOKING_NOT_REVIEWABLE');
    }

    if (input.action === 'request_feedback') {
      // Kullanıcıdan düzeltme iste — kararı sıfırla.
      newStatus = 'feedback_requested';
      await dbRun(`UPDATE bookings
         SET status = 'feedback_requested', admin_feedback = ?, reviewed_by = ?,
             reviewed_at = CURRENT_TIMESTAMP, admin_decision = NULL, analyst_decision = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`, [input.feedback ?? null, adminId, bookingId]);
      return;
    }

    if (input.action === 'reject') {
      newStatus = 'rejected';
      await dbRun(`UPDATE bookings
         SET status = 'rejected', admin_decision = 'rejected', admin_feedback = ?, reviewed_by = ?,
             reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`, [input.feedback ?? null, adminId, bookingId]);
      return;
    }

    // input.action === 'approve' → admin onayı NİHAİDİR:
    // çakışma kontrolü + auto-waitlist + lifecycle.
    await lockRoomForBooking(existing.room_id);
    const conflict = await dbOne(`SELECT id FROM bookings
         WHERE room_id = ? AND id != ? AND status = 'approved'
           AND NOT (end_date < ? OR start_date > ?)
           AND (weekday_mask & ?) != 0
         LIMIT 1`, [existing.room_id, existing.id, existing.start_date, existing.end_date, existing.weekday_mask]);
    if (conflict) {
      // Oda dolu → booking'i otomatik waitlist'e ekle, kendisini 'rejected' yap.
      const maxRow = await dbOne(`SELECT COALESCE(MAX(position), 0) AS max_pos
           FROM waitlist WHERE room_id = ? AND status = 'waiting'`, [existing.room_id]) as { max_pos: number };
      const position = maxRow.max_pos + 1;
      const dupe = await dbOne(`SELECT id FROM waitlist
           WHERE user_id = ? AND room_id = ? AND desired_start_date = ?
             AND status IN ('waiting', 'promoted')
           LIMIT 1`, [existing.user_id, existing.room_id, existing.start_date]);
      if (!dupe) {
        const wId = nanoid();
        await dbRun(`INSERT INTO waitlist (
             id, user_id, room_id, period_months, period_key, desired_start_date,
             project_name, project_description, help_needed, technologies, weekday_mask, position, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`, [wId,
          existing.user_id,
          existing.room_id,
          existing.period_months,
          existing.period_key,
          existing.start_date,
          existing.project_name,
          existing.project_description,
          existing.help_needed,
          existing.technologies,
          existing.weekday_mask,
          position]);
      }
      newStatus = 'rejected';
      autoWaitlistedPosition = position;
      const autoFeedback =
        `Oda bu tarih aralığında dolu olduğu için talebiniz otomatik olarak ` +
        `bekleme listesine alındı (sıra: ${position}). Oda boşaldığında ` +
        `yeniden değerlendirilecektir.` +
        (input.feedback ? `\n\nNot: ${input.feedback}` : '');
      await dbRun(`UPDATE bookings
         SET status = 'rejected', admin_decision = 'approved', admin_feedback = ?, reviewed_by = ?,
             reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`, [autoFeedback, adminId, bookingId]);
      return;
    }

    // Çakışma yok → onay + lifecycle application → development.
    newStatus = 'approved';
    await dbRun(`UPDATE bookings
       SET status = 'approved', admin_decision = 'approved', admin_feedback = ?, reviewed_by = ?,
           reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [input.feedback ?? null, adminId, bookingId]);
    await dbRun(`UPDATE bookings
       SET lifecycle_stage = 'development',
           stage_entered_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lifecycle_stage = 'application'`, [bookingId]);
  });
  const reviewed = await getBookingByIdAdmin(bookingId) as BookingDto;
  // tx içindeki karar dallarından sonra otoriter (DB'deki) nihai durum.
  newStatus = reviewed.status;

  // Audit timeline: ilk onayda application → development geçişini kaydet.
  // (advance/regress kendi fonksiyonlarında ayrı stage event'i atar.)
  if (newStatus === 'approved' && reviewed.lifecycleStage === 'development') {
    await recordStageEvent({
      requestId: bookingId,
      fromStage: 'application',
      toStage: 'development',
      actorId: adminId,
      actorType: 'admin',
      note: input.feedback || 'İlk onay — geliştirme aşamasına geçti.',
    });
  }

  // SSE: ilgili user'a + admin'lere yayın
  broadcastBooking(
    {
      type: 'booking.reviewed',
      data: {
        bookingId: reviewed.id,
        status: reviewed.status,
        adminFeedback: reviewed.adminFeedback,
      },
    },
    reviewed.userId
  );

  // In-app bildirim — talep sahibine.
  void import('./notification-center.service').then((m) => {
    const notifTitle =
      newStatus === 'approved'
        ? 'Randevu talebin onaylandı'
        : newStatus === 'rejected'
          ? 'Randevu talebin reddedildi'
          : 'Randevu talebin için düzeltme istendi';
    m.pushNotification({
      recipientId: reviewed.userId,
      recipientType: 'user',
      category: 'booking',
      title: notifTitle,
      body: `"${reviewed.projectName}" (${reviewed.roomCode}) — Taleplerim sayfasından görüntüle.`,
      link: '/bookings',
    });
  }).catch((err) => logger.warn('booking_review_notify_failed', { err: (err as Error).message }));

  // Eğer reject ya da feedback_requested ile slot serbest kaldıysa,
  // waitlist promotion tetikle (oda durum değişimi).
  if (newStatus === 'rejected') {
    // Async — booking response'unu bekletme
    import('./waitlist.service')
      .then((m) => m.tryPromoteForRoom(reviewed.roomId))
      .catch((err) =>
        logger.warn('waitlist_promote_failed', {
          roomId: reviewed.roomId,
          err: (err as Error).message,
        })
      );
  }

  // Otomatik waitlist'e taşındıysa: admin'lere kuyruğun güncellendiğini bildir
  // + kullanıcıya in-app bildirim (toast yerine kalıcı notification).
  if (autoWaitlistedPosition !== null) {
    recordAudit({
      eventType: 'waitlist.joined',
      subjectId: adminId,
      subjectType: 'admin',
      success: true,
      details: {
        bookingId,
        userId: reviewed.userId,
        roomId: reviewed.roomId,
        position: autoWaitlistedPosition,
        autoFromBooking: true,
      },
    });
    broadcastToAdmins({
      type: 'waitlist.changed',
      data: { roomId: reviewed.roomId, action: 'auto_added_from_booking' },
    });
  }

  return {
    booking: reviewed,
    autoWaitlisted: autoWaitlistedPosition !== null,
    waitlistPosition: autoWaitlistedPosition ?? undefined,
    approvalState: {
      adminDecision: reviewed.adminDecision,
      analystDecision: reviewed.analystDecision,
      finalStatus: reviewed.status,
    },
  };
}

/**
 * Admin: bir booking'i başka bir odaya taşır (oda ataması değiştirme).
 *
 * Onaylı bir booking taşınırken hedef oda aynı tarih aralığında başka bir
 * onaylı booking ile çakışmamalı (race condition koruması — transaction).
 */
export async function reassignBookingRoom(
  adminId: string,
  bookingId: string,
  newRoomId: string
): Promise<BookingDto> {

  const oldRoomId = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, room_id, status, weekday_mask, start_date, end_date FROM bookings WHERE id = ?`, [bookingId]) as
      | { id: string; room_id: string; status: string; weekday_mask: number; start_date: string; end_date: string }
      | undefined;
    if (!existing) throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');

    if (existing.room_id === newRoomId) {
      throw new HttpError(400, 'Booking zaten bu odada.', 'SAME_ROOM');
    }

    const room = await dbOne(`SELECT id FROM rooms WHERE id = ? AND is_active = 1`, [newRoomId]) as { id: string } | undefined;
    if (!room) throw new HttpError(404, 'Hedef oda bulunamadı.', 'ROOM_NOT_FOUND');

    // Onaylı booking için hedef odada tarih çakışması kontrolü.
    if (existing.status === 'approved') {
      await lockRoomForBooking(newRoomId);
      const conflict = await dbOne(`SELECT id FROM bookings
           WHERE room_id = ? AND id != ? AND status = 'approved'
             AND NOT (end_date < ? OR start_date > ?)
             AND (weekday_mask & ?) != 0
           LIMIT 1`, [newRoomId, existing.id, existing.start_date, existing.end_date, existing.weekday_mask]);
      if (conflict) {
        throw new HttpError(
          409,
          'Hedef oda bu tarih aralığında başka bir onaylı booking ile dolu.',
          'ROOM_CONFLICT'
        );
      }
    }

    await dbRun(`UPDATE bookings SET room_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newRoomId, bookingId]);

    // Bağlı scheduled appointment'ları da yeni odaya taşı (aksi halde randevular
    // eski odada/yanlış takvimde görünür) — aynı transaction içinde cascade.
    await dbRun(`UPDATE appointments SET room_id = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ? AND status = 'scheduled'`, [newRoomId, bookingId]);

    return existing.room_id;
  });
  const reassigned = await getBookingByIdAdmin(bookingId) as BookingDto;

  recordAudit({
    eventType: 'booking.reassigned',
    subjectId: adminId,
    subjectType: 'admin',
    success: true,
    details: { bookingId, fromRoomId: oldRoomId, toRoomId: newRoomId },
  });

  broadcastBooking(
    { type: 'booking.updated', data: { bookingId, kind: 'reassigned' } },
    reassigned.userId
  );

  return reassigned;
}

/**
 * Admin: bir booking'i tamamen siler (hard delete).
 *
 * Kullanıcı `deleteBooking`'inden farkı:
 *  - Status fark etmez (approved/rejected dahil tümü silinebilir).
 *  - Audit'e `booking.admin_deleted` event tipi düşer.
 *  - Booking onaylıydıysa odada slot serbest kalır → waitlist promote tetiklenir.
 */
export async function adminDeleteBooking(
  adminId: string,
  bookingId: string
): Promise<{ deleted: boolean; roomId: string; userId: string; wasApproved: boolean }> {

  const existing = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, user_id, room_id, status FROM bookings WHERE id = ?`, [bookingId]) as
      | { id: string; user_id: string; room_id: string; status: string }
      | undefined;

    if (!existing) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }

    await dbRun('DELETE FROM bookings WHERE id = ?', [bookingId]);
    return existing;
  });
  await deleteBookingEmbedding(bookingId);

  recordAudit({
    eventType: 'booking.admin_deleted',
    subjectId: adminId,
    subjectType: 'admin',
    success: true,
    details: {
      bookingId,
      userId: existing.user_id,
      roomId: existing.room_id,
      previousStatus: existing.status,
    },
  });

  broadcastBooking(
    { type: 'booking.withdrawn', data: { bookingId } },
    existing.user_id
  );
  broadcastToAdmins({
    type: 'booking.withdrawn',
    data: { bookingId, roomId: existing.room_id },
  });

  const wasApproved = existing.status === 'approved';
  if (wasApproved) {
    // Slot boşaldı → waitlist promotion (async, response'u bekletmez).
    import('./waitlist.service')
      .then((m) => m.tryPromoteForRoom(existing.room_id))
      .catch((err) =>
        logger.warn('waitlist_promote_failed', {
          roomId: existing.room_id,
          err: (err as Error).message,
        })
      );
  }

  return {
    deleted: true,
    roomId: existing.room_id,
    userId: existing.user_id,
    wasApproved,
  };
}

/**
 * Admin: bir booking'in user'ını değiştirir (kullanıcı yeniden atama).
 *
 * Kullanım: oda dolu ama yanlış kişi rezervasyon yapmış → admin doğru kullanıcıya
 * taşır. Onaylı booking için ek bir tarih çakışma kontrolü gerekmez (oda zaten
 * o tarihte bu booking'e ayrılmış).
 */
export async function reassignBookingUser(
  adminId: string,
  bookingId: string,
  newUserId: string
): Promise<BookingDto> {

  const existing = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, user_id, room_id, status FROM bookings WHERE id = ?`, [bookingId]) as
      | { id: string; user_id: string; room_id: string; status: string }
      | undefined;
    if (!existing) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }

    if (existing.user_id === newUserId) {
      throw new HttpError(400, 'Booking zaten bu kullanıcıya ait.', 'SAME_USER');
    }

    const user = await dbOne(`SELECT id FROM users WHERE id = ? AND status = 1`, [newUserId]) as { id: string } | undefined;
    if (!user) {
      throw new HttpError(404, 'Hedef kullanıcı bulunamadı veya pasif.', 'USER_NOT_FOUND');
    }

    await dbRun(`UPDATE bookings SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newUserId, bookingId]);

    // Bağlı scheduled appointment'ları da yeni kullanıcıya taşı (aksi halde
    // randevular eski kullanıcıda kalır) — aynı transaction içinde cascade.
    await dbRun(`UPDATE appointments SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ? AND status = 'scheduled'`, [newUserId, bookingId]);

    return existing;
  });
  const reassigned = await getBookingByIdAdmin(bookingId) as BookingDto;

  recordAudit({
    eventType: 'booking.user_reassigned',
    subjectId: adminId,
    subjectType: 'admin',
    success: true,
    details: {
      bookingId,
      fromUserId: existing.user_id,
      toUserId: newUserId,
      roomId: existing.room_id,
    },
  });

  // Hem eski hem yeni user'a haber ver, ayrıca admin kanalı.
  broadcastBooking(
    { type: 'booking.updated', data: { bookingId, kind: 'user_reassigned' } },
    existing.user_id
  );
  broadcastBooking(
    { type: 'booking.updated', data: { bookingId, kind: 'user_reassigned' } },
    newUserId
  );
  broadcastToAdmins({
    type: 'booking.updated',
    data: { bookingId, kind: 'user_reassigned' },
  });

  return reassigned;
}

/**
 * Admin / Ar-Ge: bir booking'i yaşam döngüsünde bir sonraki aşamaya ilerletir.
 *
 *   application → development → stage → production → live
 *
 * 'application' aşamasından çıkış zaten reviewBooking(approve) ile yapılır,
 * bu fonksiyon onun ötesindeki manuel ilerletmeler için kullanılır. Booking
 * onaylanmış olmalıdır (status='approved').
 *
 * `actorType` audit + zaman çizelgesi doğruluğu için: admin route 'admin',
 * governance/arge route 'arge' geçer (kim ilerletti net kalır).
 */
export async function advanceBookingLifecycle(
  actorId: string,
  bookingId: string,
  actorType: 'admin' | 'arge' = 'admin'
): Promise<BookingDto> {

  const { from, to } = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, status, lifecycle_stage FROM bookings WHERE id = ?`, [bookingId]) as
      | { id: string; status: string; lifecycle_stage: LifecycleStage }
      | undefined;
    if (!existing) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    if (existing.status !== 'approved') {
      throw new HttpError(
        409,
        'Sadece onaylanmış booking ilerletilebilir.',
        'BOOKING_NOT_APPROVED'
      );
    }

    const currentIdx = LIFECYCLE_STAGE_ORDER.indexOf(existing.lifecycle_stage);
    if (currentIdx < 0 || currentIdx >= LIFECYCLE_STAGE_ORDER.length - 1) {
      throw new HttpError(
        409,
        'Booking zaten son aşamada (live).',
        'LIFECYCLE_TERMINAL'
      );
    }
    const next = LIFECYCLE_STAGE_ORDER[currentIdx + 1];

    // İlerlerken varsa bekleyen kullanıcı talebi tüketilir (talep karşılandı).
    await dbRun(`UPDATE bookings
       SET lifecycle_stage = ?, stage_entered_at = CURRENT_TIMESTAMP,
           stage_advance_requested_at = NULL,
           stage_advance_note = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [next, bookingId]);

    return { from: existing.lifecycle_stage, to: next };
  });
  const updated = await getBookingByIdAdmin(bookingId) as BookingDto;

  recordAudit({
    eventType: 'booking.updated',
    subjectId: actorId,
    subjectType: actorType,
    success: true,
    details: { bookingId, kind: 'lifecycle_advanced', fromStage: from, toStage: to },
  });

  await recordStageEvent({
    requestId: bookingId,
    fromStage: from,
    toStage: to,
    actorId,
    actorType,
    note: 'Aşama ilerletildi.',
  });

  broadcastBooking(
    {
      type: 'booking.updated',
      data: { bookingId, kind: 'lifecycle_advanced', stage: to },
    },
    updated.userId
  );
  broadcastToAdmins({
    type: 'booking.updated',
    data: { bookingId, kind: 'lifecycle_advanced', stage: to },
  });

  return updated;
}

/**
 * Admin / Ar-Ge: bir booking'i yaşam döngüsünde bir önceki aşamaya geri al.
 *
 *   live → production → stage → development
 *
 * 'development'dan geri 'application'a düşmek senaryosu manuel iptal anlamına
 * gelir ve burada engellenir; bunun yerine reviewBooking(reject) kullanılmalı.
 *
 * `actorType` audit + zaman çizelgesi doğruluğu için (advanceBookingLifecycle ile aynı).
 */
export async function regressBookingLifecycle(
  actorId: string,
  bookingId: string,
  actorType: 'admin' | 'arge' = 'admin'
): Promise<BookingDto> {

  const { from, to } = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, status, lifecycle_stage FROM bookings WHERE id = ?`, [bookingId]) as
      | { id: string; status: string; lifecycle_stage: LifecycleStage }
      | undefined;
    if (!existing) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    if (existing.status !== 'approved') {
      throw new HttpError(
        409,
        'Sadece onaylanmış booking geri alınabilir.',
        'BOOKING_NOT_APPROVED'
      );
    }

    const currentIdx = LIFECYCLE_STAGE_ORDER.indexOf(existing.lifecycle_stage);
    if (currentIdx <= 1) {
      // 0 = application, 1 = development. Daha geri gitmek istenirse review-reject akışı.
      throw new HttpError(
        409,
        'Booking en erken aşamada — daha geri alınamaz.',
        'LIFECYCLE_AT_START'
      );
    }
    const prev = LIFECYCLE_STAGE_ORDER[currentIdx - 1];

    await dbRun(`UPDATE bookings
       SET lifecycle_stage = ?, stage_entered_at = CURRENT_TIMESTAMP,
           stage_advance_requested_at = NULL,
           stage_advance_note = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [prev, bookingId]);

    return { from: existing.lifecycle_stage, to: prev };
  });
  const updated = await getBookingByIdAdmin(bookingId) as BookingDto;

  recordAudit({
    eventType: 'booking.updated',
    subjectId: actorId,
    subjectType: actorType,
    success: true,
    details: { bookingId, kind: 'lifecycle_regressed', fromStage: from, toStage: to },
  });

  await recordStageEvent({
    requestId: bookingId,
    fromStage: from,
    toStage: to,
    actorId,
    actorType,
    note: 'Aşama geri alındı.',
  });

  broadcastBooking(
    {
      type: 'booking.updated',
      data: { bookingId, kind: 'lifecycle_regressed', stage: to },
    },
    updated.userId
  );
  broadcastToAdmins({
    type: 'booking.updated',
    data: { bookingId, kind: 'lifecycle_regressed', stage: to },
  });

  return updated;
}

/**
 * Admin: bir booking'i SWAT (fast-track) inceleme akışına alır veya çıkarır.
 * SWAT işareti review için "yüksek öncelikli" anlamına gelir.
 */
export async function setBookingReviewTrack(
  adminId: string,
  bookingId: string,
  track: 'standard' | 'swat'
): Promise<BookingDto> {
  const existing = await dbOne(`SELECT id, review_track FROM bookings WHERE id = ?`, [bookingId]) as { id: string; review_track: string } | undefined;
  if (!existing) {
    throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
  }
  if (existing.review_track === track) {
    throw new HttpError(400, 'Booking zaten bu inceleme akışında.', 'SAME_TRACK');
  }
  await dbRun(`UPDATE bookings SET review_track = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [track, bookingId]);

  const updated = await getBookingByIdAdmin(bookingId) as BookingDto;

  recordAudit({
    eventType: 'booking.updated',
    subjectId: adminId,
    subjectType: 'admin',
    success: true,
    details: { bookingId, kind: 'review_track_changed', track },
  });

  broadcastBooking(
    { type: 'booking.updated', data: { bookingId, kind: 'review_track_changed', track } },
    updated.userId
  );
  broadcastToAdmins({
    type: 'booking.updated',
    data: { bookingId, kind: 'review_track_changed', track },
  });

  return updated;
}

/**
 * Kullanıcı: onaylı projesinin bir sonraki aşamaya ilerletilmesi için admin'den
 * talep oluşturur. Talep yoksa stage_advance_requested_at=now, varsa idempotent
 * olarak yenilenir (kullanıcı not'unu güncelleyebilir).
 */
export async function requestStageAdvance(
  userId: string,
  bookingId: string,
  note?: string
): Promise<BookingDto> {

  await dbTx(async () => {
    const existing = await dbOne(`SELECT id, user_id, status, lifecycle_stage FROM bookings WHERE id = ?`, [bookingId]) as
      | { id: string; user_id: string; status: string; lifecycle_stage: LifecycleStage }
      | undefined;
    if (!existing) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    if (existing.user_id !== userId) {
      throw new HttpError(403, 'Bu booking size ait değil.', 'NOT_OWNED');
    }
    if (existing.status !== 'approved') {
      throw new HttpError(
        409,
        'Sadece onaylı projeler için aşama talebi oluşturulabilir.',
        'BOOKING_NOT_APPROVED'
      );
    }
    const idx = LIFECYCLE_STAGE_ORDER.indexOf(existing.lifecycle_stage);
    if (idx >= LIFECYCLE_STAGE_ORDER.length - 1) {
      throw new HttpError(
        409,
        'Proje zaten son aşamada (canlı).',
        'LIFECYCLE_TERMINAL'
      );
    }
    // Onay yalnız CANLIYA geçiş için gerekir; önceki aşamaları kullanıcı
    // kendisi ilerletir (selfAdvanceBookingStage).
    if (existing.lifecycle_stage !== 'production') {
      throw new HttpError(
        409,
        'Bu aşamayı onaysız kendiniz ilerletebilirsiniz — onay yalnız canlıya geçişte gerekir.',
        'ADVANCE_SELF_SERVICE'
      );
    }

    await dbRun(`UPDATE bookings
       SET stage_advance_requested_at = CURRENT_TIMESTAMP,
           stage_advance_note = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [(note ?? '').trim().slice(0, 500) || null, bookingId]);
  });
  const updated = await getBookingByIdAdmin(bookingId) as BookingDto;

  recordAudit({
    eventType: 'booking.updated',
    subjectId: userId,
    subjectType: 'user',
    success: true,
    details: { bookingId, kind: 'stage_advance_requested', note: note ?? null },
  });

  // Sadece adminlere bildir — yeni iş kuyruğunda.
  broadcastToAdmins({
    type: 'booking.updated',
    data: {
      bookingId,
      kind: 'stage_advance_requested',
      userId: updated.userId,
      currentStage: updated.lifecycleStage,
    },
  });

  return updated;
}

/**
 * Kullanıcı: kendi projesinin aşamasını CANLIYA KADAR kendisi ilerletir.
 *
 *   development → stage(Test) → production(Pre-Production)  → onay GEREKMEZ
 *   production → live (Canlı)                               → requestStageAdvance + admin onayı
 *
 * Güvenlik: sahiplik (IDOR) + status='approved' + aşama sırası kontrolü.
 */
export async function selfAdvanceBookingStage(
  userId: string,
  bookingId: string
): Promise<BookingDto> {
  const { from, to } = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, user_id, status, lifecycle_stage FROM bookings WHERE id = ?`, [bookingId]) as
      | { id: string; user_id: string; status: string; lifecycle_stage: LifecycleStage }
      | undefined;
    if (!existing) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    if (existing.user_id !== userId) {
      throw new HttpError(403, 'Bu booking size ait değil.', 'NOT_OWNED');
    }
    if (existing.status !== 'approved') {
      throw new HttpError(
        409,
        'Sadece onaylı projelerin aşaması ilerletilebilir.',
        'BOOKING_NOT_APPROVED'
      );
    }

    const currentIdx = LIFECYCLE_STAGE_ORDER.indexOf(existing.lifecycle_stage);
    if (currentIdx >= LIFECYCLE_STAGE_ORDER.length - 1) {
      throw new HttpError(409, 'Proje zaten son aşamada (canlı).', 'LIFECYCLE_TERMINAL');
    }
    const next = LIFECYCLE_STAGE_ORDER[currentIdx + 1];
    if (next === 'live') {
      // Canlıya geçiş self-servis DEĞİL — admin onayı zorunlu.
      throw new HttpError(
        409,
        'Canlıya geçiş admin onayı gerektirir — aşama ilerletme talebi oluşturun.',
        'LIVE_REQUIRES_APPROVAL'
      );
    }
    if (existing.lifecycle_stage === 'application') {
      // application → development otomatik (ilk onayda) — kullanıcı tetikleyemez.
      throw new HttpError(
        409,
        'Proje henüz onaylanıp geliştirme aşamasına alınmadı.',
        'ADVANCE_NOT_AVAILABLE'
      );
    }

    await dbRun(`UPDATE bookings
       SET lifecycle_stage = ?, stage_entered_at = CURRENT_TIMESTAMP,
           stage_advance_requested_at = NULL,
           stage_advance_note = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [next, bookingId]);

    return { from: existing.lifecycle_stage, to: next };
  });
  const updated = await getBookingByIdAdmin(bookingId) as BookingDto;

  recordAudit({
    eventType: 'booking.updated',
    subjectId: userId,
    subjectType: 'user',
    success: true,
    details: { bookingId, kind: 'lifecycle_self_advanced', fromStage: from, toStage: to },
  });

  await recordStageEvent({
    requestId: bookingId,
    fromStage: from,
    toStage: to,
    actorId: userId,
    actorType: 'user',
    note: 'Kullanıcı aşamayı ilerletti (self-servis).',
  });

  broadcastBooking(
    { type: 'booking.updated', data: { bookingId, kind: 'lifecycle_advanced', stage: to } },
    userId
  );
  broadcastToAdmins({
    type: 'booking.updated',
    data: { bookingId, kind: 'lifecycle_advanced', stage: to },
  });

  return updated;
}

/**
 * Admin: kullanıcının aşama ilerletme talebini reddet (ilerletmeden iptal et).
 * Reddedildiğinde sebep `note` parametresi ile audit log'a düşer.
 */
export async function rejectStageAdvanceRequest(
  adminId: string,
  bookingId: string,
  note?: string
): Promise<BookingDto> {
  const existing = await dbOne(`SELECT id, user_id, stage_advance_requested_at FROM bookings WHERE id = ?`, [bookingId]) as
    | { id: string; user_id: string; stage_advance_requested_at: string | null }
    | undefined;
  if (!existing) {
    throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
  }
  if (!existing.stage_advance_requested_at) {
    throw new HttpError(409, 'Bekleyen bir aşama talebi yok.', 'NO_REQUEST');
  }

  await dbRun(`UPDATE bookings
     SET stage_advance_requested_at = NULL,
         stage_advance_note = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [bookingId]);

  const updated = await getBookingByIdAdmin(bookingId) as BookingDto;

  recordAudit({
    eventType: 'booking.updated',
    subjectId: adminId,
    subjectType: 'admin',
    success: true,
    details: { bookingId, kind: 'stage_advance_rejected', adminNote: note ?? null },
  });

  broadcastBooking(
    { type: 'booking.updated', data: { bookingId, kind: 'stage_advance_rejected' } },
    existing.user_id
  );
  broadcastToAdmins({
    type: 'booking.updated',
    data: { bookingId, kind: 'stage_advance_rejected' },
  });

  return updated;
}
