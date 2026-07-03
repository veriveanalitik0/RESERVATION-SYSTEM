/**
 * User profil & admin user management servisleri.
 *
 * Güvenlik:
 * - User: yalnızca kendi profilini görür/günceller (IDOR — app_security §5)
 * - Admin: tüm user'ları yönetebilir; ancak admins tablosunu DEĞİŞTİREMEZ (ayrı endpoint olmalı)
 * - Soft delete: status=3 (data_security §11) — booking history korunur
 * - Audit log: admin user değişiklikleri loglanır
 */
import { dbAll, dbOne, dbRun, dbTx } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import type { AdminUserUpdateInput, ProfileUpdateInput } from '../validators/schemas';
import { hashPassword, invalidateSubjectCache } from './auth.service';
import { revokeAllForSubject } from './token.service';

export type UserGovernanceRole = 'analitik_danisman' | 'yz_arge' | 'izleyici';

export interface UserProfileDto {
  id: string;
  email: string;
  fullName: string;
  role: 'user';
  /** İsteğe bağlı yönetişim rolü — admin atar. NULL = sıradan kullanıcı. */
  governanceRole: UserGovernanceRole | null;
  department: string | null;
  title: string | null;
  manager: string | null;
  phone: string | null;
  bio: string | null;
  projectIdea: string | null;
  profilePhoto: string | null;
  /** Kullanıcının kendi seçtiği görsel — leaderboard kartı + public profil arka planı. */
  profileBackgroundUrl: string | null;
  /** Sohbet ekranı arka plan teması (kullanıcının seçtiği görsel). */
  chatBackgroundUrl: string | null;
  status: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserListItemDto extends UserProfileDto {
  bookingCount: number;
  approvedBookingCount: number;
  pendingBookingCount: number;
  lastBookingAt: string | null;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: 'user';
  governance_role: UserGovernanceRole | null;
  department: string | null;
  title: string | null;
  manager: string | null;
  phone: string | null;
  bio: string | null;
  project_idea: string | null;
  profile_photo: string | null;
  profile_background_url: string | null;
  chat_background_url: string | null;
  status: number;
  created_at: string;
  updated_at: string;
}

function toDto(r: UserRow): UserProfileDto {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    governanceRole: r.governance_role,
    department: r.department,
    title: r.title,
    manager: r.manager,
    phone: r.phone,
    bio: r.bio,
    projectIdea: r.project_idea,
    profilePhoto: r.profile_photo,
    profileBackgroundUrl: r.profile_background_url,
    chatBackgroundUrl: r.chat_background_url,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const PROFILE_COLUMNS =
  'id, email, full_name, role, governance_role, department, title, manager, phone, bio, project_idea, profile_photo, profile_background_url, chat_background_url, status, created_at, updated_at';

export async function getUserProfile(userId: string): Promise<UserProfileDto> {
  const row = await dbOne(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ? AND status != 3 LIMIT 1`, [userId]) as UserRow | undefined;
  if (!row) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');
  return toDto(row);
}

/**
 * Profil günceller. Sadece tanımlı alanlar değiştirilir (partial update).
 * E-posta, parola, role bu endpoint'ten değiştirilemez.
 */
export async function updateUserProfile(userId: string, input: ProfileUpdateInput): Promise<UserProfileDto> {

  // Mevcut user var mı?
  const exists = await dbOne(`SELECT id FROM users WHERE id = ? AND status != 3 LIMIT 1`, [userId]);
  if (!exists) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');

  // Sadece undefined olmayan alanları güncelle
  const updates: string[] = [];
  const params: unknown[] = [];

  const fieldMap: Array<[keyof ProfileUpdateInput, string]> = [
    ['fullName', 'full_name'],
    ['department', 'department'],
    ['title', 'title'],
    ['manager', 'manager'],
    ['phone', 'phone'],
    ['bio', 'bio'],
    ['projectIdea', 'project_idea'],
  ];

  for (const [k, col] of fieldMap) {
    if (input[k] !== undefined) {
      updates.push(`${col} = ?`);
      params.push(input[k] ?? null);
    }
  }

  if (updates.length === 0) {
    return await getUserProfile(userId);
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(userId);

  await dbRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params]);
  return await getUserProfile(userId);
}

/* ============================================================
 * ADMIN — User Management
 * ============================================================ */

export interface UserSearchFilters {
  q?: string;
  status?: 'all' | 'active' | 'disabled';
  department?: string;
  hasBookings?: 'any' | 'yes' | 'no';
  limit?: number;
}

export async function listAllUsers(filters: UserSearchFilters = {}): Promise<UserListItemDto[]> {
  const whereParts: string[] = [];
  const params: unknown[] = [];

  // Status filtresi
  if (filters.status === 'active') {
    whereParts.push('users.status = 1');
  } else if (filters.status === 'disabled') {
    whereParts.push('users.status = 3');
  }
  // 'all' veya undefined → kısıt yok

  // Department filter (exact match)
  if (filters.department && filters.department.trim()) {
    whereParts.push('LOWER(users.department) = LOWER(?)');
    params.push(filters.department.trim());
  }

  // Free text search — full_name, email, department, title (case-insensitive)
  if (filters.q && filters.q.trim().length > 0) {
    const like = `%${filters.q.trim().toLowerCase()}%`;
    whereParts.push(`(
      LOWER(users.full_name) LIKE ?
      OR LOWER(users.email) LIKE ?
      OR LOWER(IFNULL(users.department, '')) LIKE ?
      OR LOWER(IFNULL(users.title, '')) LIKE ?
    )`);
    params.push(like, like, like, like);
  }

  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);

  // Liste yanıtında base64 foto YOK (max 500 satır x 200KB şişme). has_photo
  // bayrağıyla URL üretilir; tekil profil endpoint'leri base64 dönmeye devam eder.
  const LIST_COLUMNS = PROFILE_COLUMNS.replace(
    'profile_photo,',
    '(profile_photo IS NOT NULL) AS has_photo,'
  );
  const baseSql = `
    SELECT ${LIST_COLUMNS},
           (SELECT COUNT(*) FROM bookings b WHERE b.user_id = users.id) AS booking_count,
           (SELECT COUNT(*) FROM bookings b WHERE b.user_id = users.id AND b.status = 'approved') AS approved_count,
           (SELECT COUNT(*) FROM bookings b WHERE b.user_id = users.id AND b.status IN ('pending', 'feedback_requested')) AS pending_count,
           (SELECT MAX(created_at) FROM bookings b WHERE b.user_id = users.id) AS last_booking
    FROM users
    ${where}
    ORDER BY users.status ASC, users.created_at DESC
    LIMIT ?
  `;
  params.push(limit);

  let rows = await dbAll(baseSql, [...params]) as Array<
    UserRow & {
      has_photo?: boolean;
      booking_count: number;
      approved_count: number;
      pending_count: number;
      last_booking: string | null;
    }
  >;

  // hasBookings filtresi (post-filter — SQL subquery'i ile entegre etmek daha pahalı,
  // limit zaten sınırlı, in-memory filtreleme makul).
  if (filters.hasBookings === 'yes') {
    rows = rows.filter((r) => r.booking_count > 0);
  } else if (filters.hasBookings === 'no') {
    rows = rows.filter((r) => r.booking_count === 0);
  }

  return rows.map((r) => ({
    ...toDto(r),
    profilePhoto: r.has_photo ? `/api/public/users/${r.id}/photo` : null,
    bookingCount: r.booking_count,
    approvedBookingCount: r.approved_count,
    pendingBookingCount: r.pending_count,
    lastBookingAt: r.last_booking,
  }));
}

export async function listDepartments(): Promise<string[]> {
  const rows = await dbAll(`SELECT DISTINCT department FROM users
       WHERE department IS NOT NULL AND TRIM(department) != ''
       ORDER BY department ASC`, []) as Array<{ department: string }>;
  return rows.map((r) => r.department);
}

export async function getUserByIdAdmin(id: string): Promise<UserProfileDto> {
  const row = await dbOne(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]) as UserRow | undefined;
  if (!row) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');
  return toDto(row);
}

/**
 * Admin tarafından kullanıcı güncelleme.
 * Status değiştirilebilir (aktif/devre dışı).
 */
export async function adminUpdateUser(id: string, input: AdminUserUpdateInput): Promise<UserProfileDto> {

  const exists = await dbOne(`SELECT id FROM users WHERE id = ? LIMIT 1`, [id]);
  if (!exists) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');

  const updates: string[] = [];
  const params: unknown[] = [];

  const fieldMap: Array<[keyof AdminUserUpdateInput, string]> = [
    ['fullName', 'full_name'],
    ['department', 'department'],
    ['title', 'title'],
    ['manager', 'manager'],
    ['phone', 'phone'],
    ['bio', 'bio'],
    ['projectIdea', 'project_idea'],
    ['status', 'status'],
    ['governanceRole', 'governance_role'],
  ];

  for (const [k, col] of fieldMap) {
    if (input[k] !== undefined) {
      updates.push(`${col} = ?`);
      params.push(input[k] ?? null);
    }
  }

  if (updates.length === 0) {
    return await getUserByIdAdmin(id);
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(id);

  await dbRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params]);
  // status≠1 (devre dışı) veya governance_role değişimi → aktif refresh token'ları
  // iptal et: aksi halde devre dışı bırakılan / yetki rolü değişen kullanıcı, refresh
  // ile (legacy uçlar dahil) oturum yenilemeye devam edebilirdi. (Soft-delete zaten
  // adminDeleteUser'da revoke ediyor; bu, status=0 ve rol-değişimi durumunu kapatır.)
  if ((input.status !== undefined && input.status !== 1) || input.governanceRole !== undefined) {
    await dbRun(`UPDATE refresh_tokens SET revoked = 1 WHERE subject_id = ?`, [id]);
  }
  // governance_role/status değişmiş olabilir — auth cache bayatlamasın.
  invalidateSubjectCache(id);
  return await getUserByIdAdmin(id);
}

/**
 * Soft delete — status=3.
 * Hard delete kullanılmaz çünkü bookings tablosunda RESTRICT FK var.
 * data_security §11: soft delete master data için tercih edilir.
 */
export async function adminDeleteUser(id: string): Promise<{ deleted: boolean }> {
  await dbTx(async () => {
    const existing = await dbOne(`SELECT id, status FROM users WHERE id = ?`, [id]) as
      | { id: string; status: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');
    if (existing.status === 3) {
      throw new HttpError(409, 'Kullanıcı zaten devre dışı.', 'ALREADY_DELETED');
    }
    await dbRun(`UPDATE users SET status = 3, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
    // Aktif refresh token'ları iptal et
    await dbRun(`UPDATE refresh_tokens SET revoked = 1 WHERE subject_id = ? AND subject_type = 'user'`, [id]);
  });
  // Auth cache: devre dışı kullanıcı 30sn daha istek atamasın.
  invalidateSubjectCache(id);
  return { deleted: true };
}

/**
 * Soft delete'i geri al (aktifleştir).
 */
export async function adminRestoreUser(id: string): Promise<UserProfileDto> {
  const exists = await dbOne(`SELECT id, status FROM users WHERE id = ?`, [id]) as
    | { id: string; status: number }
    | undefined;
  if (!exists) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');
  if (exists.status === 1) return await getUserByIdAdmin(id);
  await dbRun(`UPDATE users SET status = 1, failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
  invalidateSubjectCache(id);
  return await getUserByIdAdmin(id);
}

/**
 * Admin: bir kullanıcının parolasını sıfırlar.
 * Hesabın kilidini açar (failed_login sıfırlanır) ve tüm oturumları
 * (refresh token) iptal eder — kullanıcı yeni parolayla giriş yapmalı.
 */
export async function adminResetUserPassword(
  id: string,
  newPassword: string
): Promise<void> {
  const user = await dbOne(`SELECT id FROM users WHERE id = ? AND status != 3`, [id]) as { id: string } | undefined;
  if (!user) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');

  const passwordHash = await hashPassword(newPassword);
  await dbRun(`UPDATE users SET
       password_hash = ?, failed_login_count = 0, locked_until = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [passwordHash, id]);

  await revokeAllForSubject('user', id);
}
