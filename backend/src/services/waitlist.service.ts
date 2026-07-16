/**
 * Waitlist (bekleme listesi) servisi.
 *
 * İş kuralı:
 *  - Kullanıcı, dolu (rezerve) bir oda için belirli bir tarih aralığına waitlist'e yazılabilir.
 *  - Her waitlist entry'sinin bir `position` değeri vardır (FIFO).
 *  - Çatışan booking iptal edilirse / dolup serbest kalırsa: head-of-line user otomatik
 *    promote edilir → yeni booking 'pending' status'la oluşur, waitlist entry 'promoted'.
 *  - Aynı user aynı oda + tarih için TEK entry açabilir.
 *  - Geçmiş tarihler hariç (`desired_start_date >= bugün`).
 *
 * Güvenlik:
 *  - IDOR: user_id eşleşmesi zorunlu (kullanıcı sadece kendi entry'sini iptal eder).
 *  - Transaction: position atama + insert tek atomic txn.
 *  - Race condition: room state taşıdığında promote işlemi transaction içinde.
 *
 * Maintenance cron:
 *  - Periyodik (her 30sn) scan: serbest kalan odalar için head'i promote et,
 *    süresi geçmiş entry'ları 'expired' işaretle.
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun, dbTx } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { recordAudit } from '../services/audit.service';
import { broadcastBooking, broadcastToAdmins, broadcastToUser } from './sse.service';
import { maskToWeekdays, weekdaysToMask } from '../utils/weekdays';
import type { WaitlistEntry as SharedWaitlistEntry } from '@klab/shared';
import { addMonthsEndDate, periodEndDate } from '../utils/dates';

/** Waitlist DTO — TEK kaynak @klab/shared (frontend ile birebir aynı tip). */
export type WaitlistEntryDto = SharedWaitlistEntry;

interface WaitlistRow {
  id: string;
  user_id: string;
  user_full_name?: string;
  user_email?: string;
  room_id: string;
  room_code?: string;
  room_name?: string;
  period_months: number | null;
  period_key: '1w' | '2w' | '1m' | null;
  desired_start_date: string;
  desired_end_date: string | null;
  project_name: string;
  project_description: string;
  help_needed: string;
  technologies: string;
  weekday_mask: number;
  position: number;
  status: 'waiting' | 'promoted' | 'expired' | 'cancelled';
  promoted_booking_id: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDto(r: WaitlistRow): WaitlistEntryDto {
  let techs: string[] = [];
  try {
    const t = JSON.parse(r.technologies) as unknown;
    if (Array.isArray(t)) techs = t.filter((x): x is string => typeof x === 'string');
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    userId: r.user_id,
    userFullName: r.user_full_name,
    userEmail: r.user_email,
    roomId: r.room_id,
    roomCode: r.room_code ?? '',
    roomName: r.room_name ?? '',
    period: r.period_key ?? null,
    periodMonths: r.period_months ?? null,
    desiredStartDate: r.desired_start_date,
    // Bitiş tarihi: kullanıcı manuel (kısa) seçtiyse o, yoksa start + periyot ile
    // türetilir (booking ile aynı kural). Miras kayıtlarda ay-bazlı türetme.
    desiredEndDate: r.desired_end_date ?? derivedEnd(r),
    projectName: r.project_name,
    projectDescription: r.project_description,
    helpNeeded: r.help_needed,
    technologies: techs,
    weekdays: maskToWeekdays(r.weekday_mask),
    position: r.position,
    status: r.status,
    promotedBookingId: r.promoted_booking_id,
    notifiedAt: r.notified_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Bitiş tarihi hesabı utils/dates'e taşındı (ay taşması kıskaçlı, booking ile ortak).
const addMonths = addMonthsEndDate;

/** Satırın bitiş tarihini süre modelinden türet (period_key öncelikli, miras ay-bazlı). */
function derivedEnd(r: Pick<WaitlistRow, 'desired_start_date' | 'period_key' | 'period_months'>): string {
  if (r.period_key) return periodEndDate(r.desired_start_date, r.period_key);
  return addMonths(r.desired_start_date, r.period_months ?? 1);
}

function isStartDateValid(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(`${dateStr}T00:00:00`);
  return start.getTime() >= today.getTime();
}

export interface JoinWaitlistInput {
  roomId: string;
  /** Süre seçeneği: 1 hafta / 2 hafta / 1 ay. */
  period: '1w' | '2w' | '1m';
  desiredStartDate: string;
  /** Manuel (periyottan kısa) bitiş tarihi. Verilmezse start + periyot türetilir. */
  desiredEndDate?: string;
  projectName: string;
  projectDescription: string;
  helpNeeded: string;
  technologies: string[];
  /** Haftanın seçili günleri (1=Pzt..7=Paz). Verilmezse tüm hafta. */
  weekdays?: number[];
}

export async function joinWaitlist(userId: string, input: JoinWaitlistInput): Promise<WaitlistEntryDto> {
  if (!isStartDateValid(input.desiredStartDate)) {
    throw new HttpError(400, 'Başlangıç tarihi bugünden önce olamaz.', 'INVALID_START_DATE');
  }

  const periodEnd = periodEndDate(input.desiredStartDate, input.period);
  if (input.desiredEndDate) {
    if (input.desiredEndDate < input.desiredStartDate) {
      throw new HttpError(400, 'Bitiş tarihi başlangıçtan önce olamaz.', 'INVALID_END_DATE');
    }
    if (input.desiredEndDate > periodEnd) {
      throw new HttpError(400, 'Bitiş tarihi periyodun ötesine geçemez.', 'INVALID_END_DATE');
    }
  }
  // Manuel (kısa) bitiş verilmişse o, yoksa periyottan türetilen tarih.
  const endDate = input.desiredEndDate ?? periodEnd;
  const weekdayMask = weekdaysToMask(input.weekdays);

  const id = await dbTx(async () => {
    // Oda var mı?
    const room = await dbOne(`SELECT id FROM rooms WHERE id = ? AND is_active = 1`, [input.roomId]) as { id: string } | undefined;
    if (!room) throw new HttpError(404, 'Oda bulunamadı.', 'ROOM_NOT_FOUND');

    // Aslında oda boşsa waitlist'e değil booking'e gitmeli — kontrol.
    // Çakışma semantiği createBooking ile aynı: tarih aralığı VE haftanın
    // günleri kesişiyorsa doludur (yalnız tarih bakmak yanlış pozitif üretir).
    const conflict = await dbOne(`SELECT id FROM bookings
         WHERE room_id = ?
           AND status IN ('pending', 'approved', 'feedback_requested')
           AND NOT (end_date < ? OR start_date > ?)
           AND (weekday_mask & ?) != 0
         LIMIT 1`, [input.roomId, input.desiredStartDate, endDate, weekdayMask]);
    if (!conflict) {
      throw new HttpError(
        409,
        'Bu oda bu tarihte zaten müsait. Doğrudan randevu oluşturabilirsiniz.',
        'WAITLIST_ROOM_AVAILABLE'
      );
    }

    // Aynı user aynı oda + tarih için zaten waiting/promoted entry var mı?
    const existing = await dbOne(`SELECT id FROM waitlist
         WHERE user_id = ? AND room_id = ? AND desired_start_date = ?
           AND status IN ('waiting', 'promoted')
         LIMIT 1`, [userId, input.roomId, input.desiredStartDate]);
    if (existing) {
      throw new HttpError(
        409,
        'Bu oda ve tarih için zaten waitlist kaydınız var.',
        'WAITLIST_ALREADY_JOINED'
      );
    }

    // Position = mevcut maks + 1 (sadece waiting olanlar arasında)
    const maxRow = await dbOne(`SELECT COALESCE(MAX(position), 0) AS max_pos
         FROM waitlist WHERE room_id = ? AND status = 'waiting'`, [input.roomId]) as { max_pos: number };
    const position = maxRow.max_pos + 1;

    const id = nanoid();
    await dbRun(`INSERT INTO waitlist (
         id, user_id, room_id, period_key, desired_start_date, desired_end_date,
         project_name, project_description, help_needed, technologies, weekday_mask, position, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`, [id,
      userId,
      input.roomId,
      input.period,
      input.desiredStartDate,
      input.desiredEndDate ?? null,
      input.projectName,
      input.projectDescription,
      input.helpNeeded,
      JSON.stringify(input.technologies),
      weekdayMask,
      position]);

    return id;
  });
  const entry = await getWaitlistEntry(id);
  if (!entry) throw new HttpError(500, 'Waitlist kaydı yazıldı ama okunamadı.', 'INTERNAL');

  recordAudit({
    eventType: 'waitlist.joined',
    subjectId: userId,
    subjectType: 'user',
    success: true,
    details: { waitlistId: id, roomId: input.roomId, position: entry.position },
  });

  broadcastToAdmins({
    type: 'waitlist.changed',
    data: { roomId: input.roomId, action: 'joined' },
  });
  broadcastToUser(userId, {
    type: 'waitlist.changed',
    data: { waitlistId: id, action: 'joined' },
  });

  return entry;
}

export async function getWaitlistEntry(id: string): Promise<WaitlistEntryDto | undefined> {
  const row = await dbOne(`SELECT w.*, r.code AS room_code, r.name AS room_name,
              u.full_name AS user_full_name, u.email AS user_email
       FROM waitlist w
       INNER JOIN rooms r ON r.id = w.room_id
       INNER JOIN users u ON u.id = w.user_id
       WHERE w.id = ? LIMIT 1`, [id]) as WaitlistRow | undefined;
  return row ? rowToDto(row) : undefined;
}

export async function listUserWaitlist(userId: string): Promise<WaitlistEntryDto[]> {
  const rows = await dbAll(`SELECT w.*, r.code AS room_code, r.name AS room_name,
              u.full_name AS user_full_name, u.email AS user_email
       FROM waitlist w
       INNER JOIN rooms r ON r.id = w.room_id
       INNER JOIN users u ON u.id = w.user_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`, [userId]) as WaitlistRow[];
  return rows.map(rowToDto);
}

export async function listRoomWaitlist(roomId: string): Promise<WaitlistEntryDto[]> {
  const rows = await dbAll(`SELECT w.*, r.code AS room_code, r.name AS room_name,
              u.full_name AS user_full_name, u.email AS user_email
       FROM waitlist w
       INNER JOIN rooms r ON r.id = w.room_id
       INNER JOIN users u ON u.id = w.user_id
       WHERE w.room_id = ? AND w.status = 'waiting'
       ORDER BY w.position ASC`, [roomId]) as WaitlistRow[];
  return rows.map(rowToDto);
}

export async function listAllWaitlist(page?: { limit?: number; offset?: number }): Promise<WaitlistEntryDto[]> {
  const limit = Math.min(Math.max(page?.limit ?? 200, 1), 500);
  const offset = Math.max(page?.offset ?? 0, 0);
  const rows = await dbAll(`SELECT w.*, r.code AS room_code, r.name AS room_name,
              u.full_name AS user_full_name, u.email AS user_email
       FROM waitlist w
       INNER JOIN rooms r ON r.id = w.room_id
       INNER JOIN users u ON u.id = w.user_id
       ORDER BY w.created_at DESC
       LIMIT ? OFFSET ?`, [limit, offset]) as WaitlistRow[];
  return rows.map(rowToDto);
}

export async function cancelWaitlist(userId: string, waitlistId: string): Promise<{ cancelled: boolean }> {

  const roomId = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, status, room_id FROM waitlist WHERE id = ? AND user_id = ?`, [waitlistId, userId]) as
      | { id: string; status: string; room_id: string }
      | undefined;
    if (!existing) {
      throw new HttpError(404, 'Waitlist kaydı bulunamadı.', 'WAITLIST_ENTRY_NOT_FOUND');
    }
    if (existing.status !== 'waiting') {
      throw new HttpError(
        409,
        'Bu kayıt artık iptal edilemez.',
        'WAITLIST_ENTRY_NOT_FOUND'
      );
    }
    await dbRun(`UPDATE waitlist SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [waitlistId]);
    return existing.room_id;
  });

  // Geriye kalanların position'larını yeniden hesapla
  await recomputePositions(roomId);

  recordAudit({
    eventType: 'waitlist.left',
    subjectId: userId,
    subjectType: 'user',
    success: true,
    details: { waitlistId },
  });

  broadcastToUser(userId, {
    type: 'waitlist.changed',
    data: { waitlistId, action: 'cancelled' },
  });
  broadcastToAdmins({
    type: 'waitlist.changed',
    data: { roomId, action: 'cancelled' },
  });

  return { cancelled: true };
}

/**
 * Geçmiş kaydı (iptal edilmiş / süresi geçmiş) listeden kalıcı kaldırır.
 * Yalnız 'cancelled' veya 'expired' kayıtlar silinebilir (aktif sırayı bozmaz).
 * IDOR: kayıt giriş yapan kullanıcıya ait olmalı.
 */
export async function removeWaitlistEntry(userId: string, waitlistId: string): Promise<{ removed: boolean }> {
  const row = await dbOne(`SELECT id, user_id, status FROM waitlist WHERE id = ?`, [waitlistId]) as
    | { id: string; user_id: string; status: string }
    | undefined;
  if (!row || row.user_id !== userId) {
    throw new HttpError(404, 'Kayıt bulunamadı.', 'WAITLIST_ENTRY_NOT_FOUND');
  }
  if (row.status !== 'cancelled' && row.status !== 'expired') {
    throw new HttpError(409, 'Yalnız iptal edilmiş veya süresi geçmiş kayıtlar kaldırılabilir.', 'WAITLIST_NOT_REMOVABLE');
  }
  await dbRun(`DELETE FROM waitlist WHERE id = ?`, [waitlistId]);
  return { removed: true };
}

async function recomputePositions(roomId: string): Promise<void> {
  const rows = await dbAll(`SELECT id FROM waitlist
       WHERE room_id = ? AND status = 'waiting'
       ORDER BY created_at ASC`, [roomId]) as Array<{ id: string }>;
  await dbTx(async () => {
    // for...of: forEach(async) callback'leri beklenmez — UPDATE'ler transaction
    // kapsamı dışına kaçabilirdi.
    for (const [idx, row] of rows.entries()) {
      await dbRun(`UPDATE waitlist SET position = ? WHERE id = ?`, [idx + 1, row.id]);
    }
  });
}

export type WaitlistMove = 'up' | 'down' | 'top';

/**
 * Admin: bir waitlist kaydının sırasını değiştirir (öncelik verme).
 * Yalnızca aynı odadaki 'waiting' kayıtlar arasında çalışır; position'lar
 * yeni sıraya göre 1..N olarak yeniden numaralandırılır.
 */
export async function moveWaitlistEntry(waitlistId: string, move: WaitlistMove): Promise<void> {
  const entry = await dbOne(`SELECT id, room_id, status FROM waitlist WHERE id = ?`, [waitlistId]) as { id: string; room_id: string; status: string } | undefined;
  if (!entry) {
    throw new HttpError(404, 'Waitlist kaydı bulunamadı.', 'WAITLIST_ENTRY_NOT_FOUND');
  }
  if (entry.status !== 'waiting') {
    throw new HttpError(
      409,
      'Sadece bekleyen kayıtların sırası değiştirilebilir.',
      'WAITLIST_NOT_WAITING'
    );
  }

  const ids = (
    await dbAll(`SELECT id FROM waitlist
         WHERE room_id = ? AND status = 'waiting'
         ORDER BY position ASC`, [entry.room_id]) as Array<{ id: string }>
  ).map((r) => r.id);

  const idx = ids.indexOf(waitlistId);
  if (idx === -1) return;

  const next = [...ids];
  if (move === 'top' && idx > 0) {
    next.splice(idx, 1);
    next.unshift(waitlistId);
  } else if (move === 'up' && idx > 0) {
    [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
  } else if (move === 'down' && idx < ids.length - 1) {
    [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
  } else {
    return; // sınırda — değişiklik yok
  }
  await dbTx(async () => {
    for (const [i, id] of next.entries()) {
      await dbRun(`UPDATE waitlist SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [i + 1, id]);
    }
  });

  recordAudit({
    eventType: 'waitlist.reordered',
    subjectType: 'admin',
    success: true,
    details: { waitlistId, roomId: entry.room_id, move },
  });
  broadcastToAdmins({
    type: 'waitlist.changed',
    data: { roomId: entry.room_id, action: 'reordered' },
  });
}

/* ============================================================
 * PROMOTE: serbest kalan oda için head-of-line user'ı booking'e çevir
 * ============================================================ */

/** Eşzamanlı bir koşu entry'yi zaten promote ettiğinde tx'i geri almak için sentinel. */
class WaitlistAlreadyPromoted extends Error {}

/**
 * Belirli bir oda için bekleyenleri kontrol et:
 *  - Her bir waiting entry için: o tarihte oda hala çakışıyor mu?
 *  - Çakışmıyorsa: yeni booking (status='pending') oluştur, entry'yi 'promoted' yap.
 *  - Aynı oda için aynı anda birden fazla entry promote olabilir, çakışmıyorsa.
 *
 * Eşzamanlılık: her entry'nin dbTx'i oda-bazlı pg_advisory_xact_lock alır (createBooking
 * ile AYNI 'room:<id>' anahtarı) → promotion ↔ yeni rezervasyon ↔ diğer promote koşuları
 * aynı oda için serialize edilir; ayrıca waitlist UPDATE status guard'lıdır (çift promote yok).
 */
export async function tryPromoteForRoom(roomId: string): Promise<string[]> {
  const entries = await dbAll(`SELECT * FROM waitlist
       WHERE room_id = ? AND status = 'waiting'
       ORDER BY position ASC`, [roomId]) as WaitlistRow[];

  const promotedIds: string[] = [];

  for (const entry of entries) {
    // Manuel (kısa) bitiş seçilmişse o, yoksa periyottan türetilen tarih.
    const endDate = entry.desired_end_date ?? derivedEnd(entry);

    // Tarih geçti mi?
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(`${entry.desired_start_date}T00:00:00`).getTime() < today.getTime()) {
      await dbRun(`UPDATE waitlist SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [entry.id]);
      continue;
    }

    let newBookingId: string | null = null;

    newBookingId = await dbTx(async () => {
      // Oda-bazlı advisory lock — createBooking ile AYNI anahtar ('room:<id>').
      // Çakışma SELECT'inden ÖNCE alınır: promotion ile yeni rezervasyon (ve diğer
      // promote koşuları) aynı oda için serialize edilir → çift/örtüşen booking yok.
      await dbRun('SELECT pg_advisory_xact_lock(hashtext(?))', [`room:${roomId}`]);

      // Çakışma kontrolü entry'nin weekday_mask'iyle yapılır; yeni booking de
      // aynı maskeyle açılır (önceden DEFAULT 127 ile TÜM haftaya yayılıyordu).
      const conflict = await dbOne(`SELECT id FROM bookings
           WHERE room_id = ?
             AND status IN ('pending', 'approved', 'feedback_requested')
             AND NOT (end_date < ? OR start_date > ?)
             AND (weekday_mask & ?) != 0
           LIMIT 1`, [roomId, entry.desired_start_date, endDate, entry.weekday_mask]);
      if (conflict) return null;

      const id = nanoid();
      await dbRun(`INSERT INTO bookings (
           id, user_id, room_id, period_months, period_key, start_date, end_date,
           project_name, project_description, help_needed, technologies, weekday_mask, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, [id,
        entry.user_id,
        entry.room_id,
        entry.period_months,
        entry.period_key,
        entry.desired_start_date,
        endDate,
        entry.project_name,
        entry.project_description,
        entry.help_needed,
        entry.technologies,
        entry.weekday_mask]);

      // Status guard: yalnız HÂLÂ 'waiting' ise promote et. Eşzamanlı ikinci koşu
      // bu entry'yi zaten promote ettiyse changes=0 → tx geri alınır (INSERT iptal),
      // çift booking ve çift promote engellenir.
      const upd = await dbRun(`UPDATE waitlist
         SET status = 'promoted', promoted_booking_id = ?, notified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'waiting'`, [id, entry.id]);
      if (upd.changes === 0) throw new WaitlistAlreadyPromoted();

      return id;
    }).catch((err: unknown) => {
      if (err instanceof WaitlistAlreadyPromoted) return null;
      throw err;
    });

    if (newBookingId) {
      promotedIds.push(entry.id);

      recordAudit({
        eventType: 'waitlist.promoted',
        subjectId: entry.user_id,
        subjectType: 'user',
        success: true,
        details: { waitlistId: entry.id, newBookingId, roomId },
      });

      // In-app bildirim: "Sıranız geldi" — talep sahibine
      const roomRow = await dbOne('SELECT code FROM rooms WHERE id = ?', [roomId]) as { code: string } | undefined;
      void import('./notification-center.service').then((m) => {
        m.pushNotification({
          recipientId: entry.user_id,
          recipientType: 'user',
          category: 'waitlist',
          title: 'Sıranız geldi',
          body: `"${entry.project_name}" için ${roomRow?.code ?? '???'} odası serbest kaldı — talebiniz oluşturuldu.`,
          link: '/bookings',
        });
      }).catch((err) => logger.warn('waitlist_promote_notify_failed', { err: (err as Error).message }));

      broadcastBooking(
        {
          type: 'booking.created',
          data: { bookingId: newBookingId, fromWaitlist: true },
        },
        entry.user_id
      );
      broadcastToUser(entry.user_id, {
        type: 'waitlist.changed',
        data: { waitlistId: entry.id, action: 'promoted', bookingId: newBookingId },
      });
    }
  }

  if (promotedIds.length > 0) {
    await recomputePositions(roomId);
  }
  return promotedIds;
}

/**
 * Tüm odalar için promotion + expired temizleme cron.
 * Periyodik çağrılır (server start sırasında setInterval).
 *
 * Çok-instance notu: Ayrı bir cron leader-kilidi GEREKMEZ çünkü eşzamanlılık veri
 * katmanında garanti altında: tryPromoteForRoom her entry'yi oda-bazlı
 * pg_advisory_xact_lock ('room:<id>', createBooking ile aynı anahtar) altında
 * promote eder ve waitlist UPDATE'i status='waiting' guard'lıdır. Böylece aynı
 * slot iki instance'ta çift promote edilemez (lock COMMIT'te bırakılır → nested-tx
 * sorunu yok). Leader-lock yalnız gereksiz tekrar işi azaltırdı, doğruluk için şart değil.
 */
let maintenanceTimer: NodeJS.Timeout | null = null;

export function startWaitlistMaintenance(intervalMs = 30_000): void {
  if (maintenanceTimer) return;
  const tick = async () => {
    try {
      const roomsWithWaitlist = await dbAll(`SELECT DISTINCT room_id FROM waitlist WHERE status = 'waiting'`, []) as Array<{ room_id: string }>;
      for (const r of roomsWithWaitlist) {
        await tryPromoteForRoom(r.room_id);
      }
    } catch (err) {
      logger.warn('waitlist_maintenance_error', { err: (err as Error).message });
    }
  };
  maintenanceTimer = setInterval(() => {
    void tick();
  }, intervalMs);
  // Server start'ta hemen bir kez çalıştır
  setTimeout(() => {
    void tick();
  }, 2000);
}

export function stopWaitlistMaintenance(): void {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}
