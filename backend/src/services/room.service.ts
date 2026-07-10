/**
 * Oda servisi: oda listesi ve uygunluk hesaplaması.
 */
import { dbAll, dbOne } from '../db/schema';
import { ymdLocal } from '../utils/dates';
import { maskToWeekdays } from '../utils/weekdays';
import { config } from '../config/env';

import type { Room as SharedRoom } from '@klab/shared';

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** YYYY-MM-DD → ertesi gün (YYYY-MM-DD). nextAvailableDate hesabı için. */
function nextDay(dateStr: string): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

function prevDay(dateStr: string): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
}

/**
 * Tarih aralıklarını (YYYY-MM-DD, kapsayıcı) birleştirir: örtüşen VEYA bitişik
 * (1 gün arayla) aralıklar tek aralığa indirgenir. Çıktı start'a göre sıralı ve
 * çakışmasızdır. Boş-aralık / dolu-pencere hesapları bunun üzerine kurulur.
 */
function mergeDateRanges(
  ranges: Array<{ start: string; end: string }>
): Array<{ start: string; end: string }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  const merged: Array<{ start: string; end: string }> = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= nextDay(last.end)) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/**
 * Oda DTO — TEK kaynak @klab/shared (frontend ile birebir aynı tip).
 * Alan ekleme/değiştirme shared/index.d.ts üzerinden yapılır.
 */
export type RoomDto = SharedRoom;

interface RoomRow {
  id: string;
  code: string;
  name: string;
  district: string;
  neighborhood: string;
  capacity: number;
  description: string | null;
  theme: string;
  equipment: string;
  roomType: 'pod' | 'experience' | 'tribune';
  specs: string | null;
}

interface ActiveBooking {
  room_id: string;
  weekday_mask: number;
  start_date: string;
  end_date: string;
}

const FULL_WEEK_MASK = 127; // Pzt..Paz — tüm günler dolu demek

/** YYYY-MM-DD → ISO haftanın günü (1=Pzt..7=Paz). */
function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Paz..6=Cmt
  return day === 0 ? 7 : day;
}

/** [from, to] aralığının kapsadığı haftanın günlerinin maskesi (gün-bazlı mod için).
 *  7+ günlük aralık tüm haftayı kapsar (127). */
function weekdayMaskForRange(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days >= 7) return FULL_WEEK_MASK;
  let mask = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    mask |= 1 << (isoWeekday(d) - 1);
  }
  return mask;
}

/**
 * Oda listesi + uygunluk.
 *  - `from` verilirse uygunluk [from, to] ARALIĞINA göre hesaplanır: aralıkla
 *    örtüşen bir booking varsa oda o aralıkta DOLU (kullanıcı o aralık için
 *    rezervasyon yapamaz). `to` verilmezse tek gün (to = from) gibi davranır.
 *  - `from` verilmezse genel (bugünkü) uygunluk döner.
 */
export async function listRooms(from?: string, to?: string): Promise<RoomDto[]> {
  const rooms = await dbAll(`SELECT id, code, name, district, neighborhood, capacity, description, theme, equipment,
              room_type AS "roomType", specs
       FROM rooms WHERE is_active = 1 ORDER BY code`, []) as RoomRow[];

  const today = ymdLocal();

  const activeBookings = await dbAll(`SELECT room_id, weekday_mask, start_date, end_date FROM bookings
       WHERE status IN ('approved', 'pending', 'feedback_requested')
         AND end_date >= ?`, [today]) as ActiveBooking[];

  // Bugünü kapsayan booking'lerin oda-bazlı doluluk maskesi (haftanın hangi
  // günleri dolu) + en geç bitiş tarihi. Hem genel uygunluk hem availableWeekdays
  // bundan türer.
  //
  // YALNIZ BUGÜNÜ KAPSAYAN booking'ler maskelenir: gelecekte başlayacak veya
  // ayrık dönemlerdeki kayıtların maskelerini OR'lamak, aralarında tamamen boş
  // olan odayı "dolu" gösteriyordu (6 ay sonraki booking bugünü kilitliyordu).
  const occ = new Map<string, { mask: number; maxEnd: string }>();
  for (const b of activeBookings) {
    if (b.start_date > today) continue; // henüz başlamadı — bugünkü uygunluğu etkilemez
    const cur = occ.get(b.room_id);
    if (!cur) {
      occ.set(b.room_id, { mask: b.weekday_mask, maxEnd: b.end_date });
    } else {
      cur.mask |= b.weekday_mask;
      if (b.end_date > cur.maxEnd) cur.maxEnd = b.end_date;
    }
  }

  /** Bir odanın bugünkü doluluk maskesinden boş (bookable) günleri çıkarır. */
  const freeWeekdays = (roomId: string): number[] => {
    const mask = occ.get(roomId)?.mask ?? 0;
    const out: number[] = [];
    for (let d = 1; d <= 7; d++) {
      if ((mask & (1 << (d - 1))) === 0) out.push(d);
    }
    return out;
  };

  // Tarih ARALIĞI filtresi: [from, to] boyunca uygunluk.
  const rangeFrom = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined;
  if (rangeFrom) {
    // to verilmemiş/geçersiz/from'dan küçükse tek gün gibi davran.
    const rangeTo = to && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= rangeFrom ? to : rangeFrom;
    const rangeMask = weekdayMaskForRange(rangeFrom, rangeTo);
    const busyInRange = new Set<string>();
    for (const b of activeBookings) {
      // Aralık örtüşmesi: booking [start,end] ile [from,to] kesişiyor mu?
      const overlaps = !(b.end_date < rangeFrom || b.start_date > rangeTo);
      if (!overlaps) continue;
      // Full-week modda (varsayılan) gün maskesi YOK SAYILIR: örtüşen herhangi bir
      // booking odayı o aralıkta doldurur. Gün-bazlı modda aralık-günleri kesişmeli.
      const dayConflict = config.weekdaySelection ? (b.weekday_mask & rangeMask) !== 0 : true;
      if (dayConflict) busyInRange.add(b.room_id);
    }
    return rooms.map((r) => {
      const busy = busyInRange.has(r.id);
      return {
        ...r,
        isAvailable: !busy,
        nextAvailableDate: null,
        // Full-week modda gün şeridi anlamsız → dolu ⇒ [], boş ⇒ tüm hafta.
        availableWeekdays: config.weekdaySelection ? freeWeekdays(r.id) : busy ? [] : ALL_WEEKDAYS,
      };
    });
  }

  return rooms.map((r) => {
    const info = occ.get(r.id);
    if (config.weekdaySelection) {
      // Gün-bazlı: oda ancak haftanın 7 günü de dolu ise "müsait değil".
      const fullyBooked = info ? (info.mask & FULL_WEEK_MASK) === FULL_WEEK_MASK : false;
      return {
        ...r,
        isAvailable: !fullyBooked,
        nextAvailableDate: fullyBooked && info ? nextDay(info.maxEnd) : null,
        availableWeekdays: freeWeekdays(r.id),
      };
    }
    // Full-week (varsayılan): bugünü kapsayan HERHANGİ bir booking → oda dolu.
    // Rezervasyon tüm haftayı kapsadığından kısmi gün ayrımı yapılmaz; aksi halde
    // Pzt-Cum dolu bir oda "müsait" görünüp tam-hafta talebinde reddediliyordu.
    const occupied = !!info;
    return {
      ...r,
      isAvailable: !occupied,
      nextAvailableDate: occupied ? nextDay(info!.maxEnd) : null,
      availableWeekdays: occupied ? [] : ALL_WEEKDAYS,
    };
  });
}

/* ============================================================
 * ODA MÜSAİTLİK DETAYI — kart açılınca gösterilen "müsait vakitler"
 * ============================================================ */

export interface RoomBusyRange {
  startDate: string;
  endDate: string;
  /** Bu booking'in kapsadığı haftanın günleri (1=Pzt..7=Paz). */
  weekdays: number[];
}

export interface RoomAvailabilityDay {
  date: string; // YYYY-MM-DD
  slots: Array<{ start: string; end: string }>; // o gün dolu saat aralıkları (PII'siz)
}

export interface RoomAvailabilityDto {
  roomId: string;
  isAvailable: boolean;
  nextAvailableDate: string | null;
  /** Bookable (boş) haftanın günleri (1=Pzt..7=Paz). */
  availableWeekdays: number[];
  /** Aktif booking'lerin kapladığı tarih aralıkları (kişisel veri içermez). */
  busyRanges: RoomBusyRange[];
  /**
   * Bugünden itibaren rezerve edilebilir boş tarih aralıkları (dolu pencerelerden
   * önce ve aralarında, kapsayıcı). Oda bugün doluysa, doluluk bittikten sonra başlar.
   */
  freeGaps: Array<{ startDate: string; endDate: string }>;
  /**
   * Oda bugün müsaitse, gelecekteki en yakın dolu pencere — "Randevu Al" altındaki
   * bilgilendirme notu için. null = ileride dolu pencere yok.
   */
  nextOccupiedWindow: { startDate: string; endDate: string } | null;
  /**
   * Oda bugün doluysa, mevcut doluluk bittikten sonraki en erken müsait tarih —
   * "doluluk sonrası randevu al" için. null = oda bugün zaten müsait.
   */
  earliestAvailableAfter: string | null;
  /**
   * [from, to] penceresindeki dolu GÜNLER (PII'siz) — bookings'ten türetilir,
   * busyRanges / freeGaps ile aynı kaynak ve tutarlı. Her dolu gün, günü tümüyle
   * kaplayan tek bir tüm-gün aralığı olarak temsil edilir; rezervasyonlar
   * tarih-aralığı bazlıdır (saat granülerliği yoktur).
   */
  appointments: RoomAvailabilityDay[];
  from: string;
  to: string;
}

/**
 * Tek bir oda için zengin müsaitlik bilgisi: boş günler, dolu tarih aralıkları
 * ve [from,to] penceresindeki dolu randevu saatleri. Oda detay modalı bunu
 * çağırıp "müsait vakitler / dolu saatler"i gösterir. Kişisel veri (kim) DÖNMEZ.
 */
export async function getRoomAvailability(
  roomId: string,
  opts: { from?: string; to?: string } = {}
): Promise<RoomAvailabilityDto | undefined> {
  const room = await getRoomById(roomId);
  if (!room) return undefined;

  const today = ymdLocal();
  const valid = (d?: string): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const from = valid(opts.from) ? opts.from : today;
  // Varsayılan pencere: bugünden +13 gün (2 hafta).
  const to = valid(opts.to)
    ? opts.to
    : new Date(new Date(`${from}T00:00:00Z`).getTime() + 13 * 86400000).toISOString().slice(0, 10);

  const activeBookings = await dbAll(`SELECT weekday_mask, start_date, end_date FROM bookings
       WHERE room_id = ?
         AND status IN ('approved', 'pending', 'feedback_requested')
         AND end_date >= ?
       ORDER BY start_date ASC`, [roomId, today]) as Array<{
    weekday_mask: number;
    start_date: string;
    end_date: string;
  }>;

  // Bugünü kapsayan booking'lerin maskesi → boş günler + nextAvailableDate.
  let mask = 0;
  let maxEnd = '';
  let occupiedToday = false;
  for (const b of activeBookings) {
    if (b.start_date > today) continue;
    occupiedToday = true;
    mask |= b.weekday_mask;
    if (b.end_date > maxEnd) maxEnd = b.end_date;
  }

  // Full-week modda (varsayılan) bugünü kapsayan herhangi bir booking odayı
  // doldurur; gün-bazlı modda yalnız 7 gün de doluysa. availableWeekdays buna göre.
  let isAvailable: boolean;
  let availableWeekdays: number[];
  if (config.weekdaySelection) {
    const fullyBooked = (mask & FULL_WEEK_MASK) === FULL_WEEK_MASK;
    isAvailable = !fullyBooked;
    availableWeekdays = [];
    for (let d = 1; d <= 7; d++) {
      if ((mask & (1 << (d - 1))) === 0) availableWeekdays.push(d);
    }
  } else {
    isAvailable = !occupiedToday;
    availableWeekdays = occupiedToday ? [] : ALL_WEEKDAYS;
  }
  const nextAvailableDate = !isAvailable && maxEnd ? nextDay(maxEnd) : null;

  const busyRanges: RoomBusyRange[] = activeBookings.map((b) => ({
    startDate: b.start_date,
    endDate: b.end_date,
    weekdays: maskToWeekdays(b.weekday_mask),
  }));

  // --- Tarih-bazlı doluluk pencereleri (full-week semantiği) ---
  // Aktif booking aralıklarını birleştir → çakışmasız sıralı dolu pencereler.
  const merged = mergeDateRanges(
    activeBookings.map((b) => ({ start: b.start_date, end: b.end_date }))
  );
  // Bugünü kapsayan dolu pencere (varsa) ve gelecekteki en yakın dolu pencere.
  const coveringToday = merged.find((m) => m.start <= today && m.end >= today) ?? null;
  const futureWindow = merged.find((m) => m.start > today) ?? null;
  const nextOccupiedWindow = futureWindow
    ? { startDate: futureWindow.start, endDate: futureWindow.end }
    : null;
  // Oda bugün doluysa: mevcut (bitişikleriyle birleşmiş) doluluğun ertesi günü.
  const earliestAvailableAfter = coveringToday ? nextDay(coveringToday.end) : null;
  // Boş aralıklar: cursor'dan (bugün ya da bugünkü doluluğun ertesi günü) başlayıp
  // her dolu pencereden öncesini bounded aralık olarak toplar. Son pencereden
  // sonraki açık-uçlu kuyruk dahil edilmez (sınırsız).
  const freeGaps: Array<{ startDate: string; endDate: string }> = [];
  let cursor = coveringToday ? nextDay(coveringToday.end) : today;
  for (const m of merged) {
    if (m.end < cursor) continue; // tamamen cursor'dan önce
    if (m.start <= cursor) {
      cursor = nextDay(m.end); // cursor bu pencerenin içinde → ilerlet
      continue;
    }
    freeGaps.push({ startDate: cursor, endDate: prevDay(m.start) });
    cursor = nextDay(m.end);
  }

  // [from, to] penceresindeki dolu GÜNLER (PII'siz) — gerçek doluluk olan
  // BOOKINGS'ten türetilir (busyRanges / freeGaps ile aynı `merged` kaynağı,
  // full-week semantiği). Eskiden bu alan 'appointments' (status='scheduled')
  // tablosundan besleniyordu; o tablo aktif randevu akışında DOLDURULMUYOR →
  // alan hep boş kalıp modal "planlı dolu saat yok, oda uygun" derken aynı
  // pencerede busyRanges doluyu gösteriyordu (kullanıcıyı yanıltan çelişki).
  // Rezervasyonlar tarih-aralığı bazlı olduğundan her dolu gün, o günü tümüyle
  // kaplayan tek bir tüm-gün aralığı (YEREL gün sınırları; sunucu TZ=Europe/
  // Istanbul, frontend saatleri yerel gösterir) olarak temsil edilir.
  const appointments: RoomAvailabilityDay[] = [];
  const startMs = new Date(`${from}T00:00:00Z`).getTime();
  const endMs = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = startMs, i = 0; t <= endMs && i < 366; t += 86400000, i++) {
    const date = new Date(t).toISOString().slice(0, 10);
    const occupied = merged.some((m) => m.start <= date && m.end >= date);
    if (!occupied) continue;
    appointments.push({
      date,
      slots: [
        {
          start: new Date(`${date}T00:00:00`).toISOString(),
          end: new Date(`${date}T23:59:00`).toISOString(),
        },
      ],
    });
  }

  return {
    roomId,
    isAvailable,
    nextAvailableDate,
    availableWeekdays,
    busyRanges,
    freeGaps,
    nextOccupiedWindow,
    earliestAvailableAfter,
    appointments,
    from,
    to,
  };
}

export async function getRoomById(id: string): Promise<RoomRow | undefined> {
  return await dbOne(`SELECT id, code, name, district, neighborhood, capacity, description, theme, equipment,
              room_type AS "roomType", specs
       FROM rooms WHERE id = ? AND is_active = 1 LIMIT 1`, [id]) as RoomRow | undefined;
}

/* ============================================================
 * ADMIN — odalar + kim hangi odada (doluluk)
 * ============================================================ */

export interface RoomOccupant {
  bookingId: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  projectName: string;
  period: '1w' | '2w' | '1m' | null;
  periodMonths: number | null;
  startDate: string;
  endDate: string;
  status: 'approved' | 'pending' | 'feedback_requested';
  /** Projeye atanmış üretilen görsel (varsa) — oda kartı arka planı için. */
  showcaseImageUrl: string | null;
}

export interface RoomWithOccupancy extends RoomDto {
  /** Aktif booking'ler (onaylı + bekleyen), başlangıç tarihine göre sıralı. */
  bookings: RoomOccupant[];
  approvedCount: number;
  pendingCount: number;
}

interface OccupantRow {
  id: string;
  room_id: string;
  user_id: string;
  user_full_name: string;
  user_email: string;
  project_name: string;
  period_months: number | null;
  period_key: '1w' | '2w' | '1m' | null;
  start_date: string;
  end_date: string;
  status: 'approved' | 'pending' | 'feedback_requested';
  showcase_image_url: string | null;
}

/**
 * Admin "Odalar" görünümü — her oda + içindeki aktif booking'ler (kim,
 * hangi proje, hangi tarih, hangi durum). Süresi geçmiş booking'ler hariç.
 */
export async function getRoomsWithOccupancy(): Promise<RoomWithOccupancy[]> {
  const rooms = await listRooms();
  const today = ymdLocal();

  const rows = await dbAll(`SELECT b.id, b.room_id, b.user_id, b.project_name, b.period_months, b.period_key,
              b.start_date, b.end_date, b.status, b.showcase_image_url,
              u.full_name AS user_full_name, u.email AS user_email
       FROM bookings b
       INNER JOIN users u ON u.id = b.user_id
       WHERE b.status IN ('approved', 'pending', 'feedback_requested')
         AND b.end_date >= ?
       ORDER BY b.start_date ASC`, [today]) as OccupantRow[];

  const byRoom = new Map<string, RoomOccupant[]>();
  for (const r of rows) {
    const list = byRoom.get(r.room_id) ?? [];
    list.push({
      bookingId: r.id,
      userId: r.user_id,
      userFullName: r.user_full_name,
      userEmail: r.user_email,
      projectName: r.project_name,
      period: r.period_key ?? null,
      periodMonths: r.period_months ?? null,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      showcaseImageUrl: r.showcase_image_url,
    });
    byRoom.set(r.room_id, list);
  }

  return rooms.map((room) => {
    const bookings = byRoom.get(room.id) ?? [];
    return {
      ...room,
      bookings,
      approvedCount: bookings.filter((b) => b.status === 'approved').length,
      pendingCount: bookings.filter((b) => b.status !== 'approved').length,
    };
  });
}

// NOT: Eski "oda × haftanın günü" (weekday_mask) ısı-haritası KALDIRILDI. Aktif UI
// gerçek randevulara dayanan appointment.service.getRoomAppointmentHeatmap'i kullanır;
// eski sürüm dar tarih penceresinde pencere-dışı günleri de sayan bir hataya sahipti.
