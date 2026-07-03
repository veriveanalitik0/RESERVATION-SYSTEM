/**
 * Showcase "feed" — public galeri verisini TEK çağrıda toplar (#3).
 *
 * Önceden frontend 3 ayrı istek atıyordu (items + technologies + engagement).
 * Burada tek bundle'da birleştirilir → 3 round-trip yerine 1.
 *
 * Server-side cache:
 *  - Ağır kısım (bookings⋈rooms⋈users join + teknoloji sayımı) DEĞİŞKEN değil,
 *    bu yüzden 30 sn TTL ile bellekte cache'lenir.
 *  - Volatil kısım (like/comment sayıları) HER ZAMAN taze hesaplanır (ucuz GROUP BY),
 *    böylece beğeni/yorum anında yansır.
 *  - Galeriyi değiştiren mutasyonlar (showcase görseli, görünürlük toggle) cache'i
 *    açıkça invalidate eder; admin onay/red gibi seyrek değişimler 30 sn TTL ile yakalanır.
 */
import { dbAll } from '../db/schema';
import { getShowcaseEngagement } from './showcase.service';
// Paylaşılan DTO (backend↔frontend tek kaynak) — #6.
import type { ShowcaseItem, ShowcaseTechnology } from '@klab/shared';

export type { ShowcaseItem, ShowcaseTechnology };

export interface ShowcaseFeed {
  items: ShowcaseItem[];
  total: number;
  technologies: ShowcaseTechnology[];
  engagement: Record<string, { likes: number; comments: number }>;
  generatedAt: string;
}

interface ShowcaseRow {
  id: string;
  project_name: string;
  project_description: string;
  technologies: string;
  room_code: string;
  room_name: string;
  district: string;
  neighborhood: string;
  theme: string;
  user_id: string;
  full_name: string;
  has_photo?: boolean;
  period_months: number | null;
  period_key: '1w' | '2w' | '1m' | null;
  start_date: string;
  end_date: string;
  showcase_highlight: number;
  reviewed_at: string | null;
  showcase_image_url: string | null;
}

function parseTechs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    /* ignore */
  }
  return [];
}

async function queryItems(): Promise<ShowcaseItem[]> {
  const rows = await dbAll(`SELECT b.id, b.project_name, b.project_description, b.technologies,
              b.period_months, b.period_key, b.start_date, b.end_date, b.showcase_highlight,
              b.reviewed_at, b.user_id, b.showcase_image_url,
              r.code AS room_code, r.name AS room_name, r.district, r.neighborhood, r.theme,
              u.full_name, (u.profile_photo IS NOT NULL) AS has_photo
       FROM bookings b
       INNER JOIN rooms r ON r.id = b.room_id
       INNER JOIN users u ON u.id = b.user_id
       WHERE b.status = 'approved' AND b.showcase_visible = 1 AND u.status != 3
       ORDER BY b.showcase_highlight DESC, b.reviewed_at DESC
       LIMIT 60`, []) as ShowcaseRow[];

  return rows.map((r) => ({
    id: r.id,
    projectName: r.project_name,
    projectDescription: r.project_description,
    technologies: parseTechs(r.technologies),
    roomCode: r.room_code,
    roomName: r.room_name,
    district: r.district,
    neighborhood: r.neighborhood,
    theme: r.theme,
    authorId: r.user_id,
    authorFullName: r.full_name,
    authorPhoto: r.has_photo ? `/api/public/users/${r.user_id}/photo` : null,
    period: r.period_key ?? null,
    periodMonths: r.period_months ?? null,
    startDate: r.start_date,
    endDate: r.end_date,
    isHighlight: r.showcase_highlight === 1,
    approvedAt: r.reviewed_at,
    showcaseImageUrl: r.showcase_image_url,
  }));
}

async function queryTechnologies(): Promise<ShowcaseTechnology[]> {
  const rows = await dbAll(`SELECT technologies FROM bookings
       WHERE status = 'approved' AND showcase_visible = 1`, []) as Array<{ technologies: string }>;

  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of parseTechs(r.technologies)) {
      const k = t.trim();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([technology, count]) => ({ technology, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

/** Ağır (stabil) kısmın cache'i — items + technologies. */
let stableCache: { items: ShowcaseItem[]; technologies: ShowcaseTechnology[]; expiresAt: number } | null =
  null;
const TTL_MS = 30_000;

async function getStable(): Promise<{ items: ShowcaseItem[]; technologies: ShowcaseTechnology[] }> {
  const now = Date.now();
  if (!stableCache || stableCache.expiresAt <= now) {
    stableCache = {
      items: await queryItems(),
      technologies: await queryTechnologies(),
      expiresAt: now + TTL_MS,
    };
  }
  return { items: stableCache.items, technologies: stableCache.technologies };
}

/** Galeri içeriği değiştiğinde (görsel/görünürlük/onay) cache'i temizler. */
export function invalidateShowcaseFeed(): void {
  stableCache = null;
}

/** Tüm showcase bundle'ı — items(cache) + technologies(cache) + engagement(taze). */
export async function getShowcaseFeed(): Promise<ShowcaseFeed> {
  const { items, technologies } = await getStable();
  return {
    items,
    total: items.length,
    technologies,
    engagement: await getShowcaseEngagement(), // her çağrıda taze — beğeni/yorum anında yansır
    generatedAt: new Date().toISOString(),
  };
}

/** Eski /showcase route'u için (cache paylaşımlı). */
export async function getShowcaseItems(): Promise<{ items: ShowcaseItem[]; total: number }> {
  const { items } = await getStable();
  return { items, total: items.length };
}

/** Eski /showcase/technologies route'u için (cache paylaşımlı). */
export async function getShowcaseTechnologies(): Promise<ShowcaseTechnology[]> {
  return (await getStable()).technologies;
}
