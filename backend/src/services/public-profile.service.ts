/**
 * Public profil servisi — `/u/:userId` sayfası için.
 *
 * Görünenler:
 *  - full_name, department, title, bio, project_idea, profile_photo
 *  - Onaylı + showcase_visible projeler listesi
 *  - Toplam beğeni + yorum sayıları
 *
 * Gizlenen (PII):
 *  - email asla
 *  - failed_login_count, locked_until, password_hash, status asla
 *
 * Auth gerektirmez (public).
 */
import { dbAll, dbOne } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';

export interface PublicProfile {
  id: string;
  fullName: string;
  department: string | null;
  title: string | null;
  bio: string | null;
  projectIdea: string | null;
  profilePhoto: string | null;
  profileBackgroundUrl: string | null;
  joinedAt: string;
  projects: Array<{
    id: string;
    projectName: string;
    projectDescription: string;
    technologies: string[];
    roomCode: string;
    roomName: string;
    startDate: string;
    endDate: string;
    isHighlight: boolean;
    likeCount: number;
    commentCount: number;
    approvedAt: string | null;
    showcaseImageUrl: string | null;
  }>;
  stats: {
    projectCount: number;
    totalLikes: number;
    totalComments: number;
  };
}

interface UserRow {
  id: string;
  full_name: string;
  department: string | null;
  title: string | null;
  bio: string | null;
  project_idea: string | null;
  profile_photo: string | null;
  profile_background_url: string | null;
  created_at: string;
  status: number;
}

interface ProjectRow {
  id: string;
  project_name: string;
  project_description: string;
  technologies: string;
  room_code: string;
  room_name: string;
  start_date: string;
  end_date: string;
  showcase_highlight: number;
  showcase_image_url: string | null;
  reviewed_at: string | null;
  like_count: number;
  comment_count: number;
}

function parseTechs(raw: string): string[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
  } catch {
    /* skip */
  }
  return [];
}

export async function getPublicProfile(userId: string): Promise<PublicProfile> {
  const user = await dbOne(`SELECT id, full_name, department, title, bio, project_idea, profile_photo, profile_background_url, created_at, status
       FROM users WHERE id = ?`, [userId]) as UserRow | undefined;
  if (!user || user.status === 3) {
    throw new HttpError(404, 'Profil bulunamadı.', 'USER_NOT_FOUND');
  }

  const projects = await dbAll(`SELECT b.id, b.project_name, b.project_description, b.technologies, b.start_date, b.end_date,
              b.showcase_highlight, b.showcase_image_url, b.reviewed_at,
              r.code AS room_code, r.name AS room_name,
              (SELECT COUNT(*) FROM showcase_likes l WHERE l.booking_id = b.id) AS like_count,
              (SELECT COUNT(*) FROM showcase_comments c WHERE c.booking_id = b.id) AS comment_count
       FROM bookings b
       INNER JOIN rooms r ON r.id = b.room_id
       WHERE b.user_id = ? AND b.status = 'approved' AND b.showcase_visible = 1
       ORDER BY b.showcase_highlight DESC, b.reviewed_at DESC`, [userId]) as ProjectRow[];

  const totalLikes = projects.reduce((s, p) => s + p.like_count, 0);
  const totalComments = projects.reduce((s, p) => s + p.comment_count, 0);

  return {
    id: user.id,
    fullName: user.full_name,
    department: user.department,
    title: user.title,
    bio: user.bio,
    projectIdea: user.project_idea,
    profilePhoto: user.profile_photo,
    profileBackgroundUrl: user.profile_background_url,
    joinedAt: user.created_at,
    projects: projects.map((p) => ({
      id: p.id,
      projectName: p.project_name,
      projectDescription: p.project_description,
      technologies: parseTechs(p.technologies),
      roomCode: p.room_code,
      roomName: p.room_name,
      startDate: p.start_date,
      endDate: p.end_date,
      isHighlight: p.showcase_highlight === 1,
      likeCount: p.like_count,
      commentCount: p.comment_count,
      approvedAt: p.reviewed_at,
      showcaseImageUrl: p.showcase_image_url,
    })),
    stats: {
      projectCount: projects.length,
      totalLikes,
      totalComments,
    },
  };
}
