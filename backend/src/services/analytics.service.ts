/**
 * Analytics servisi — admin dashboard'daki grafikler için.
 *
 * Tüm sorgular READ-ONLY ve parameterized.
 * Veri tek bir endpoint'te toplanır → frontend bir kez fetch yapar.
 */
import { dbAll, dbOne } from '../db/schema';

/** Gün farkı (end-start+1) — pg tarih çıkarma. */
const DAY_DIFF = '(b.end_date::date - b.start_date::date + 1)';

export interface DailyBookingPoint {
  date: string; // YYYY-MM-DD
  created: number;
  approved: number;
  rejected: number;
}

export interface RoomUsage {
  roomId: string;
  roomCode: string;
  roomName: string;
  totalBookings: number;
  approvedBookings: number;
  utilizationDays: number; // approved start_date..end_date toplam gün
}

export interface TechnologyCount {
  technology: string;
  count: number;
}

export interface StatusBreakdown {
  status: string;
  count: number;
}

export interface PeriodDistribution {
  periodMonths: number;
  count: number;
}

export interface TopUser {
  userId: string;
  fullName: string;
  email: string;
  bookingCount: number;
  approvedCount: number;
}

export interface AnalyticsResponse {
  generatedAt: string;
  dailyBookings: DailyBookingPoint[];
  roomUsage: RoomUsage[];
  topTechnologies: TechnologyCount[];
  statusBreakdown: StatusBreakdown[];
  periodDistribution: PeriodDistribution[];
  topUsers: TopUser[];
  totals: {
    bookings: number;
    users: number;
    approved: number;
    pending: number;
    rejected: number;
    feedbackRequested: number;
    activeWaitlist: number;
  };
}

function lastNDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const c = new Date(d);
    c.setDate(d.getDate() - i);
    out.push(c.toISOString().slice(0, 10));
  }
  return out;
}

export async function getAnalytics(): Promise<AnalyticsResponse> {
  const dates = lastNDates(30);

  // 1) Günlük booking sayıları (created bazlı + approved/rejected reviewed_at bazlı)
  const dailyMap = new Map<string, DailyBookingPoint>();
  for (const d of dates) {
    dailyMap.set(d, { date: d, created: 0, approved: 0, rejected: 0 });
  }

  const createdRows = await dbAll(`SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c FROM bookings
       WHERE substr(created_at, 1, 10) >= ? GROUP BY substr(created_at, 1, 10)`, [dates[0]]) as Array<{ d: string; c: number }>;
  for (const row of createdRows) {
    const p = dailyMap.get(row.d);
    if (p) p.created = row.c;
  }

  const reviewedRows = await dbAll(`SELECT substr(reviewed_at, 1, 10) AS d, status, COUNT(*) AS c FROM bookings
       WHERE reviewed_at IS NOT NULL AND substr(reviewed_at, 1, 10) >= ?
       GROUP BY substr(reviewed_at, 1, 10), status`, [dates[0]]) as Array<{ d: string; status: string; c: number }>;
  for (const row of reviewedRows) {
    const p = dailyMap.get(row.d);
    if (!p) continue;
    if (row.status === 'approved') p.approved += row.c;
    if (row.status === 'rejected') p.rejected += row.c;
  }

  // 2) Oda kullanım istatistikleri
  const roomRows = await dbAll(`SELECT r.id AS room_id, r.code AS room_code, r.name AS room_name,
              COUNT(b.id) AS total,
              SUM(CASE WHEN b.status = 'approved' THEN 1 ELSE 0 END) AS approved,
              COALESCE(SUM(
                CASE WHEN b.status = 'approved'
                  THEN ${DAY_DIFF}
                  ELSE 0
                END
              ), 0) AS util_days
       FROM rooms r
       LEFT JOIN bookings b ON b.room_id = r.id
       GROUP BY r.id
       ORDER BY util_days DESC`, []) as Array<{
      room_id: string;
      room_code: string;
      room_name: string;
      total: number;
      approved: number;
      util_days: number;
    }>;
  const roomUsage: RoomUsage[] = roomRows.map((r) => ({
    roomId: r.room_id,
    roomCode: r.room_code,
    roomName: r.room_name,
    totalBookings: r.total ?? 0,
    approvedBookings: r.approved ?? 0,
    utilizationDays: Math.round(r.util_days ?? 0),
  }));

  // 3) Top teknolojiler (JSON array parse)
  const techRows = await dbAll(`SELECT technologies FROM bookings WHERE status IN ('approved', 'pending', 'feedback_requested')`, []) as Array<{ technologies: string }>;
  const techCount = new Map<string, number>();
  for (const row of techRows) {
    try {
      const parsed = JSON.parse(row.technologies) as unknown;
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          if (typeof t === 'string' && t.trim().length > 0) {
            const k = t.trim();
            techCount.set(k, (techCount.get(k) ?? 0) + 1);
          }
        }
      }
    } catch {
      /* skip */
    }
  }
  const topTechnologies: TechnologyCount[] = [...techCount.entries()]
    .map(([technology, count]) => ({ technology, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // 4) Status dağılımı
  const statusRows = await dbAll(`SELECT status, COUNT(*) AS c FROM bookings GROUP BY status`, []) as Array<{ status: string; c: number }>;
  const statusBreakdown: StatusBreakdown[] = statusRows.map((r) => ({
    status: r.status,
    count: r.c,
  }));

  // 5) Periyot dağılımı
  const periodRows = await dbAll(`SELECT period_months, COUNT(*) AS c FROM bookings GROUP BY period_months ORDER BY period_months ASC`, []) as Array<{ period_months: number; c: number }>;
  const periodDistribution: PeriodDistribution[] = periodRows.map((r) => ({
    periodMonths: r.period_months,
    count: r.c,
  }));

  // 6) Top user'lar
  const userRows = await dbAll(`SELECT u.id, u.full_name, u.email,
              COUNT(b.id) AS total,
              SUM(CASE WHEN b.status = 'approved' THEN 1 ELSE 0 END) AS approved
       FROM users u
       LEFT JOIN bookings b ON b.user_id = u.id
       WHERE u.status != 3
       GROUP BY u.id
       HAVING COUNT(b.id) > 0
       ORDER BY total DESC, approved DESC
       LIMIT 8`, []) as Array<{
      id: string;
      full_name: string;
      email: string;
      total: number;
      approved: number;
    }>;
  const topUsers: TopUser[] = userRows.map((r) => ({
    userId: r.id,
    fullName: r.full_name,
    email: r.email,
    bookingCount: r.total,
    approvedCount: r.approved,
  }));

  // 7) Toplamlar
  const totals = {
    bookings: 0,
    users: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    feedbackRequested: 0,
    activeWaitlist: 0,
  };
  const tCount = await dbOne('SELECT COUNT(*) AS c FROM bookings', []) as { c: number };
  totals.bookings = tCount.c;
  const uCount = await dbOne('SELECT COUNT(*) AS c FROM users WHERE status != 3', []) as { c: number };
  totals.users = uCount.c;
  for (const s of statusBreakdown) {
    if (s.status === 'approved') totals.approved = s.count;
    if (s.status === 'pending') totals.pending = s.count;
    if (s.status === 'rejected') totals.rejected = s.count;
    if (s.status === 'feedback_requested') totals.feedbackRequested = s.count;
  }
  try {
    const wCount = await dbOne(`SELECT COUNT(*) AS c FROM waitlist WHERE status = 'waiting'`, []) as { c: number };
    totals.activeWaitlist = wCount.c;
  } catch {
    // waitlist tablosu henüz yoksa (migration sırası)
    totals.activeWaitlist = 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    dailyBookings: [...dailyMap.values()],
    roomUsage,
    topTechnologies,
    statusBreakdown,
    periodDistribution,
    topUsers,
    totals,
  };
}
