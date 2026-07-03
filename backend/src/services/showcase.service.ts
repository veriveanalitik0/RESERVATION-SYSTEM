/**
 * Showcase/Envanter etkileşim servisi.
 *
 * Sadece status='approved' AND showcase_visible=1 projeler için.
 * - Like: bir user × booking için tek (UNIQUE).
 * - Comment: serbest (1..1000 karakter).
 *
 * Güvenlik:
 * - Login zorunlu (anonymous engaging engellenir).
 * - Comment body Zod validate (sınır + trim).
 * - Audit log: like/comment her ikisi 'showcase.liked' / 'showcase.commented' event'i.
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { recordAudit } from './audit.service';

async function assertShowcaseable(bookingId: string): Promise<void> {
  const row = await dbOne(`SELECT id FROM bookings
       WHERE id = ? AND status = 'approved' AND showcase_visible = 1`, [bookingId]);
  if (!row) {
    throw new HttpError(404, 'Proje galeride bulunamadı.', 'NOT_FOUND');
  }
}

/* ============ LIKES ============ */

export interface LikeStatus {
  liked: boolean;
  count: number;
}

export async function getLikeStatus(bookingId: string, userId: string | null): Promise<LikeStatus> {
  const count = (
    await dbOne('SELECT COUNT(*) AS c FROM showcase_likes WHERE booking_id = ?', [bookingId]) as {
      c: number;
    }
  ).c;
  if (!userId) return { liked: false, count };
  const own = await dbOne('SELECT id FROM showcase_likes WHERE booking_id = ? AND user_id = ?', [bookingId, userId]);
  return { liked: !!own, count };
}

export async function toggleLike(bookingId: string, userId: string): Promise<LikeStatus> {
  await assertShowcaseable(bookingId);

  const existing = await dbOne('SELECT id FROM showcase_likes WHERE booking_id = ? AND user_id = ?', [bookingId, userId]) as { id: string } | undefined;

  if (existing) {
    await dbRun('DELETE FROM showcase_likes WHERE id = ?', [existing.id]);
  } else {
    await dbRun('INSERT INTO showcase_likes (id, booking_id, user_id) VALUES (?, ?, ?)', [nanoid(), bookingId, userId]);

    recordAudit({
      eventType: 'showcase.liked',
      subjectId: userId,
      subjectType: 'user',
      success: true,
      details: { bookingId },
    });
  }

  return await getLikeStatus(bookingId, userId);
}

/* ============ COMMENTS ============ */

export interface ShowcaseComment {
  id: string;
  bookingId: string;
  userId: string;
  userFullName: string;
  userProfilePhoto: string | null;
  body: string;
  createdAt: string;
}

interface CommentRow {
  id: string;
  booking_id: string;
  user_id: string;
  user_full_name: string;
  profile_photo: string | null;
  body: string;
  created_at: string;
}

function commentRowToDto(r: CommentRow): ShowcaseComment {
  return {
    id: r.id,
    bookingId: r.booking_id,
    userId: r.user_id,
    userFullName: r.user_full_name,
    userProfilePhoto: r.profile_photo,
    body: r.body,
    createdAt: r.created_at,
  };
}

export async function listComments(bookingId: string, limit = 100): Promise<ShowcaseComment[]> {
  const rows = await dbAll(`SELECT sc.id, sc.booking_id, sc.user_id, sc.user_full_name, sc.body, sc.created_at,
              u.profile_photo
       FROM showcase_comments sc
       LEFT JOIN users u ON u.id = sc.user_id
       WHERE sc.booking_id = ?
       ORDER BY sc.created_at DESC
       LIMIT ?`, [bookingId, limit]) as CommentRow[];
  return rows.map(commentRowToDto);
}

export async function postComment(args: {
  bookingId: string;
  userId: string;
  userFullName: string;
  body: string;
}): Promise<ShowcaseComment> {
  await assertShowcaseable(args.bookingId);
  const body = args.body.trim();
  if (body.length < 1 || body.length > 1000) {
    throw new HttpError(400, 'Yorum 1-1000 karakter olmalı.', 'VALIDATION');
  }

  const id = nanoid();
  await dbRun(`INSERT INTO showcase_comments (id, booking_id, user_id, user_full_name, body)
       VALUES (?, ?, ?, ?, ?)`, [id, args.bookingId, args.userId, args.userFullName, body]);

  recordAudit({
    eventType: 'showcase.commented',
    subjectId: args.userId,
    subjectType: 'user',
    success: true,
    details: { bookingId: args.bookingId, length: body.length },
  });

  const row = await dbOne(`SELECT sc.id, sc.booking_id, sc.user_id, sc.user_full_name, sc.body, sc.created_at,
              u.profile_photo
       FROM showcase_comments sc
       LEFT JOIN users u ON u.id = sc.user_id
       WHERE sc.id = ?`, [id]) as CommentRow;
  return commentRowToDto(row);
}

export async function deleteComment(commentId: string, userId: string): Promise<{ deleted: boolean }> {
  const row = await dbOne('SELECT id, user_id FROM showcase_comments WHERE id = ?', [commentId]) as { id: string; user_id: string } | undefined;
  if (!row) throw new HttpError(404, 'Yorum bulunamadı.', 'NOT_FOUND');
  // IDOR: yalnız sahibi silebilir (admin için ayrı endpoint olabilir, demo'da basit)
  if (row.user_id !== userId) {
    throw new HttpError(403, 'Yalnız kendi yorumunuzu silebilirsiniz.', 'FORBIDDEN');
  }
  await dbRun('DELETE FROM showcase_comments WHERE id = ?', [commentId]);
  return { deleted: true };
}

/**
 * Showcase'deki tüm onaylı projeler için like + comment count map'i.
 * /api/public/showcase response'una "engagement" alanı eklemek için.
 */
export async function getShowcaseEngagement(): Promise<Record<
  string,
  { likes: number; comments: number }
>> {
  const likes = await dbAll(`SELECT booking_id, COUNT(*) AS c FROM showcase_likes GROUP BY booking_id`, []) as Array<{ booking_id: string; c: number }>;
  const comments = await dbAll(`SELECT booking_id, COUNT(*) AS c FROM showcase_comments GROUP BY booking_id`, []) as Array<{ booking_id: string; c: number }>;
  const map: Record<string, { likes: number; comments: number }> = {};
  for (const l of likes) {
    map[l.booking_id] = map[l.booking_id] ?? { likes: 0, comments: 0 };
    map[l.booking_id].likes = l.c;
  }
  for (const c of comments) {
    map[c.booking_id] = map[c.booking_id] ?? { likes: 0, comments: 0 };
    map[c.booking_id].comments = c.c;
  }
  return map;
}
