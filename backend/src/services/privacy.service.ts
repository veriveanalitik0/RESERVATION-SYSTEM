/**
 * KVKK / GDPR uyum servisi.
 *
 * Sağladığı haklar:
 *  - Right to access (Md.11/b): kullanıcı kendi tüm verisini JSON olarak indirir.
 *  - Right to be forgotten (Md.11/e — silme): kullanıcının verileri kalıcı silinir
 *    veya pseudonymize edilir (booking history için).
 *  - Right to rectification: profil update endpoint zaten var.
 *
 * Strateji:
 *  - Soft delete + PII purge: kullanıcı silindiğinde:
 *    1) users.status = 3 (soft delete — IDOR FK koruması için)
 *    2) users.full_name, email, department, title, manager, phone, bio, project_idea → pseudonymize
 *    3) Tüm refresh_tokens → revoke
 *    4) Tüm waitlist entries → 'cancelled'
 *    5) Bookings: status='approved' olanlar tarih bütünlüğü için kalır,
 *       diğerleri silinir; kalanların project_description'ında PII varsa scrub.
 *       (Audit için booking history korunur — anonymized.)
 *    6) audit_logs → değişmez (compliance/forensic; retention süresi
 *       data_security §11 ile yönetilir).
 *
 * Audit:
 *  - export → 'user.data_export' event
 *  - delete → 'user.data_purge' event
 */
import { dbAll, dbOne, dbRun, dbTx } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { recordAudit } from './audit.service';
import { invalidateSubjectCache } from './auth.service';
import { deleteStoredFiles } from './visual-store.service';

export interface UserDataExport {
  generatedAt: string;
  schemaVersion: string;
  user: Record<string, unknown>;
  bookings: Array<Record<string, unknown>>;
  waitlist: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
}

/**
 * Kullanıcının tüm verilerini JSON olarak döner.
 * IDOR: yalnız çağıran user kendi verisini görür.
 */
export async function exportUserData(userId: string): Promise<UserDataExport> {

  const user = await dbOne(`SELECT id, email, full_name, role, department, title, manager, phone, bio,
              project_idea, status, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`, [userId]) as Record<string, unknown> | undefined;
  if (!user) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');

  const bookings = await dbAll(`SELECT b.id, b.room_id, b.period_months, b.start_date, b.end_date,
              b.project_name, b.project_description, b.help_needed, b.technologies,
              b.status, b.admin_feedback, b.reviewed_at, b.created_at, b.updated_at,
              r.code AS room_code, r.name AS room_name
       FROM bookings b
       INNER JOIN rooms r ON r.id = b.room_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`, [userId]) as Array<Record<string, unknown>>;

  const waitlist = await dbAll(`SELECT w.id, w.room_id, w.period_months, w.desired_start_date,
              w.project_name, w.project_description, w.help_needed, w.technologies,
              w.position, w.status, w.created_at, w.updated_at,
              r.code AS room_code, r.name AS room_name
       FROM waitlist w
       INNER JOIN rooms r ON r.id = w.room_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`, [userId]) as Array<Record<string, unknown>>;

  // Audit log: yalnız bu kullanıcıyı subject olarak alan kayıtlar
  const auditLog = await dbAll(`SELECT event_type, success, details, created_at, ip_address
       FROM audit_logs
       WHERE subject_id = ? AND subject_type = 'user'
       ORDER BY created_at DESC
       LIMIT 500`, [userId]) as Array<Record<string, unknown>>;

  recordAudit({
    eventType: 'user.data_export', // KVKK veri ihracı — ayrı denetim olayı (genel user.update'ten ayrı izlenebilir).
    subjectId: userId,
    subjectType: 'user',
    success: true,
    details: { action: 'data_export', bookings: bookings.length, waitlist: waitlist.length },
  });

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0',
    user,
    bookings,
    waitlist,
    auditLog,
  };
}

/**
 * Right to be forgotten — KVKK Md.11/e.
 *
 * Geri dönüşü YOK. Soft-delete + PII purge.
 * Pending/feedback_requested booking'ler silinir. Approved booking'ler
 * pseudonymize edilir (tarih bütünlüğü + admin audit için).
 *
 * Çağıran:
 *  - user kendisi (self-service), VEYA
 *  - admin (başka user için, audit'le)
 *
 * NOT: audit_logs SİLİNMEZ — compliance retention süresine tâbi (data_security §11).
 */
export interface PurgeResult {
  purgedUser: { id: string; pseudonymizedAs: string };
  deletedBookings: number;
  pseudonymizedBookings: number;
  cancelledWaitlist: number;
  revokedTokens: number;
  deletedChatMessages: number;
  deletedComments: number;
  deletedLikes: number;
  deletedNotifications: number;
  cancelledAppointments: number;
  deletedSupportRequests: number;
  deletedHardwareRequests: number;
  deletedVisuals: number;
}

export async function purgeUser(userId: string, requestedBy: { id: string; type: 'user' | 'admin' }): Promise<PurgeResult> {
  const pseudo = `deleted-${userId.slice(0, 8)}`;

  const counts = await dbTx(async () => {
    const existing = await dbOne(`SELECT id, status FROM users WHERE id = ? LIMIT 1`, [userId]) as { id: string; status: number } | undefined;
    if (!existing) throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');

    // 1) Pending/feedback bookings → silinir
    const delRes = await dbRun(`DELETE FROM bookings WHERE user_id = ?
         AND status IN ('pending', 'feedback_requested')`, [userId]);

    // 2) Approved/rejected bookings → pseudonymize (PII scrub)
    const pseudonymizeRes = await dbRun(`UPDATE bookings
         SET project_description = '[Kullanıcı tarafından silindi]',
             help_needed = '[Kullanıcı tarafından silindi]',
             showcase_image_url = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND status IN ('approved', 'rejected')`, [userId]);

    // 3) Waitlist → cancelled
    const waitlistRes = await dbRun(`UPDATE waitlist
         SET status = 'cancelled',
             project_description = '[silindi]',
             help_needed = '[silindi]',
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND status IN ('waiting', 'promoted')`, [userId]);

    // 4) Refresh tokens → revoke
    const tokensRes = await dbRun(`UPDATE refresh_tokens SET revoked = 1
         WHERE subject_id = ? AND subject_type = 'user' AND revoked = 0`, [userId]);

    // 4b) Diğer kişisel veri tabloları — "unutulma hakkı" yalnız users/bookings
    // ile bitmez (KVKK): sohbet, yorum, beğeni, bildirim, randevu, destek/donanım
    // talepleri ve üretilen görseller de temizlenir.
    const chatRes = await dbRun(
      `DELETE FROM chat_messages WHERE sender_id = ? OR recipient_id = ?`,
      [userId, userId]
    );
    const commentsRes = await dbRun(`DELETE FROM showcase_comments WHERE user_id = ?`, [userId]);
    const likesRes = await dbRun(`DELETE FROM showcase_likes WHERE user_id = ?`, [userId]);
    const notifRes = await dbRun(
      `DELETE FROM notifications WHERE recipient_id = ?`,
      [userId]
    );
    // Randevular: geçmiş kayıtların tarih bütünlüğü için silinmez, iptal +
    // kişisel metinler scrub edilir.
    const apptRes = await dbRun(
      `UPDATE appointments
         SET status = 'cancelled', title = '[silindi]', notes = '[silindi]'
       WHERE user_id = ? AND status = 'scheduled'`,
      [userId]
    );
    await dbRun(
      `UPDATE appointments SET title = '[silindi]', notes = '[silindi]'
       WHERE user_id = ?`,
      [userId]
    );
    const supportRes = await dbRun(`DELETE FROM support_requests WHERE user_id = ?`, [userId]);
    const hardwareRes = await dbRun(`DELETE FROM hardware_requests WHERE user_id = ?`, [userId]);
    // Üretilen görseller: DB satırını silmeden ÖNCE diskteki dosyaları da sil.
    // Aksi halde purge sonrası /api/public/visuals/:id/image ile baytlar hâlâ
    // servis edilebilir (KVKK sızıntısı). Disk silme BEST-EFFORT: olası IO
    // hatası purge transaction'ını durdurmaz, yalnız loglanır.
    const userVisuals = await dbAll(
      `SELECT id, image_url, variants FROM visuals WHERE user_id = ?`,
      [userId]
    ) as Array<{ id: string; image_url: string | null; variants: string | null }>;
    for (const v of userVisuals) {
      try {
        await deleteStoredFiles(v.id);
      } catch (err) {
        logger.error('purge_visual_file_delete_failed', { visualId: v.id, userId, error: String(err) });
      }
    }
    const visualsRes = await dbRun(`DELETE FROM visuals WHERE user_id = ?`, [userId]);
    // Profil görselleri/arkaplanları user satırında — adım 5'te NULL'lanır.

    // 5) User row → pseudonymize + status=3 (profil foto/arkaplanlar dahil)
    await dbRun(`UPDATE users
       SET email = ?,
           full_name = '[Silinen kullanıcı]',
           department = NULL,
           title = NULL,
           manager = NULL,
           phone = NULL,
           bio = NULL,
           project_idea = NULL,
           profile_photo = NULL,
           profile_background_url = NULL,
           chat_background_url = NULL,
           password_hash = '',
           status = 3,
           failed_login_count = 0,
           locked_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [`${pseudo}@purged.local`, userId]);

    return {
      deletedBookings: delRes.changes,
      pseudonymizedBookings: pseudonymizeRes.changes,
      cancelledWaitlist: waitlistRes.changes,
      revokedTokens: tokensRes.changes,
      deletedChatMessages: chatRes.changes,
      deletedComments: commentsRes.changes,
      deletedLikes: likesRes.changes,
      deletedNotifications: notifRes.changes,
      cancelledAppointments: apptRes.changes,
      deletedSupportRequests: supportRes.changes,
      deletedHardwareRequests: hardwareRes.changes,
      deletedVisuals: visualsRes.changes,
    };
  });

  // Auth cache: purge edilen kullanıcının token'ları anında geçersizleşsin.
  invalidateSubjectCache(userId);

  recordAudit({
    eventType: 'user.delete',
    subjectId: requestedBy.id,
    subjectType: requestedBy.type,
    success: true,
    details: {
      action: 'data_purge',
      targetUserId: userId,
      ...counts,
    },
  });

  logger.warn('user_data_purge', {
    targetUserId: userId,
    requestedBy: requestedBy.type,
    ...counts,
  });

  return {
    purgedUser: { id: userId, pseudonymizedAs: pseudo },
    ...counts,
  };
}
