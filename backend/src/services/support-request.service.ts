/**
 * Destek talebi iş akışı.
 *
 * Kullanıcı her ekranda görünen "Destek Talep Et" butonuyla serbest metin
 * açıklama gönderir; tüm aktif admin'lere in-app bildirim düşer. Admin destek
 * talebini "çözüldü" olarak işaretler.
 *
 * Güvenlik (app_security.md):
 * - SQL parameterized (§3)
 * - resolved_by + resolved_at ile audit-able (§8)
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { pushNotificationBulk } from './notification-center.service';
import { broadcastToAdmins } from './sse.service';

export type SupportRequestStatus = 'open' | 'resolved';

export interface SupportRequest {
  id: string;
  userId: string;
  description: string;
  status: SupportRequestStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportRequestWithUser extends SupportRequest {
  userFullName: string;
  userEmail: string;
  userDepartment: string | null;
}

interface DbRow {
  id: string;
  user_id: string;
  description: string;
  status: SupportRequestStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DbRowWithUser extends DbRow {
  user_full_name: string;
  user_email: string;
  user_department: string | null;
}

function rowToSupportRequest(row: DbRow): SupportRequest {
  return {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSupportRequestWithUser(row: DbRowWithUser): SupportRequestWithUser {
  return {
    ...rowToSupportRequest(row),
    userFullName: row.user_full_name,
    userEmail: row.user_email,
    userDepartment: row.user_department,
  };
}

const SELECT_ADMIN_REQUEST = `
  SELECT sr.*,
         u.full_name AS user_full_name,
         u.email AS user_email,
         u.department AS user_department
  FROM support_requests sr
  INNER JOIN users u ON u.id = sr.user_id
`;

/* ============================================================
 * USER — destek talebi oluştur
 * ============================================================ */

export async function createSupportRequest(
  userId: string,
  description: string
): Promise<SupportRequest> {
  const id = nanoid();

  await dbRun(`INSERT INTO support_requests (id, user_id, description) VALUES (?, ?, ?)`, [id, userId, description.trim()]);

  const row = await dbOne('SELECT * FROM support_requests WHERE id = ?', [id]) as DbRow;
  const created = rowToSupportRequest(row);

  // Bildirim hatası talebi geri almasın — bilinçli fire-and-forget.
  void notifyAdminsSupportRequested(created).catch(() => undefined);

  return created;
}

/* ============================================================
 * ADMIN — destek taleplerini listele + çöz
 * ============================================================ */

export async function listAdminSupportRequests(
  statusFilter?: SupportRequestStatus
): Promise<SupportRequestWithUser[]> {
  const params: unknown[] = [];
  let where = '';
  if (statusFilter) {
    where = 'WHERE sr.status = ?';
    params.push(statusFilter);
  }

  const rows = await dbAll(`${SELECT_ADMIN_REQUEST}
       ${where}
       ORDER BY
         CASE sr.status WHEN 'open' THEN 0 ELSE 1 END,
         sr.created_at DESC`, [...params]) as DbRowWithUser[];
  return rows.map(rowToSupportRequestWithUser);
}

export async function resolveSupportRequest(
  adminId: string,
  requestId: string
): Promise<SupportRequestWithUser> {

  const existing = await dbOne('SELECT * FROM support_requests WHERE id = ?', [requestId]) as DbRow | undefined;

  if (!existing) {
    throw new HttpError(404, 'Destek talebi bulunamadı.', 'SUPPORT_REQUEST_NOT_FOUND');
  }
  if (existing.status === 'resolved') {
    throw new HttpError(
      400,
      'Bu destek talebi zaten çözüldü.',
      'SUPPORT_REQUEST_ALREADY_RESOLVED'
    );
  }

  await dbRun(`UPDATE support_requests SET
       status = 'resolved', resolved_by = ?,
       resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [adminId, requestId]);

  const row = await dbOne(`${SELECT_ADMIN_REQUEST} WHERE sr.id = ?`, [requestId]) as DbRowWithUser;
  return rowToSupportRequestWithUser(row);
}

/* ============================================================
 * BİLDİRİM — yeni destek talebinde admin'lere in-app bildirim + SSE
 * ============================================================ */

async function notifyAdminsSupportRequested(request: SupportRequest): Promise<void> {
  const admins = await dbAll('SELECT id FROM admins WHERE status = 1', []) as Array<{ id: string }>;

  const submitter = await dbOne('SELECT full_name FROM users WHERE id = ?', [request.userId]) as { full_name: string } | undefined;
  const submitterName = submitter?.full_name ?? 'Bir kullanıcı';
  const snippet =
    request.description.length > 80
      ? `${request.description.slice(0, 80)}…`
      : request.description;

  if (admins.length > 0) {
    pushNotificationBulk(
      admins.map((a) => a.id),
      'admin',
      {
        category: 'system',
        title: 'Yeni destek talebi',
        body: `${submitterName}: ${snippet}`,
        link: '/admin/support',
      }
    );
  }

  broadcastToAdmins({
    type: 'support_request.created',
    data: { id: request.id },
  });
}
