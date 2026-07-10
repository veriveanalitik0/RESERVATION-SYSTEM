/**
 * Admin güvenlik/sistem rotaları: admin parola değişimi, audit log görüntüleme
 * ve CSV ihracı, DB yedekleri, admin MFA yönetimi.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { changeAdminPasswordSchema, mfaVerifySchema } from '../../validators/schemas';
import { changeAdminPassword } from '../../services/auth.service';
import {
  disableMfa,
  enrollMfa,
  getMfaStatus,
  verifyMfaCode,
} from '../../services/mfa.service';
import { recordAudit } from '../../services/audit.service';
import {
  distinctEventTypes,
  exportAuditCsv,
  listAuditLog,
} from '../../services/audit-viewer.service';
import { listBackups, runBackupOnce } from '../../services/backup.service';
import { HttpError } from '../../middleware/error.middleware';
import { requireAdminSubject } from './shared';

const router = Router();

/**
 * Admin kendi parolasını değiştirir.
 * Tam yol: POST /api/admin/auth/change-password — '/auth' öneki bu router'ın
 * /api/admin mount'undan gelir; ayrı bir admin-auth router'ı YOKTUR (kaldırıldı).
 */
router.post(
  '/auth/change-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = changeAdminPasswordSchema.parse(req.body);
      await changeAdminPassword(
        req.auth!.subjectId,
        input.currentPassword,
        input.newPassword
      );
      recordAudit({
        eventType: 'admin.password_changed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
      });
      res.json({ message: 'Parolan güncellendi.' });
    } catch (err) {
      next(err);
    }
  }
);

/* ============ AUDIT LOG VIEWER ============ */

router.get('/audit', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query;
    const filters: Parameters<typeof listAuditLog>[0] = {
      eventType: typeof q.eventType === 'string' ? q.eventType : undefined,
      subjectType:
        q.subjectType === 'user' || q.subjectType === 'admin' || q.subjectType === 'anonymous'
          ? (q.subjectType as 'user' | 'admin' | 'anonymous')
          : undefined,
      subjectId: typeof q.subjectId === 'string' ? q.subjectId : undefined,
      success: q.success === 'true' ? true : q.success === 'false' ? false : undefined,
      ipAddress: typeof q.ipAddress === 'string' ? q.ipAddress : undefined,
      since: typeof q.since === 'string' ? q.since : undefined,
      until: typeof q.until === 'string' ? q.until : undefined,
      q: typeof q.q === 'string' ? q.q : undefined,
      limit: typeof q.limit === 'string' ? Math.min(parseInt(q.limit, 10) || 50, 500) : undefined,
      offset: typeof q.offset === 'string' ? Math.max(parseInt(q.offset, 10) || 0, 0) : undefined,
    };
    res.json(await listAuditLog(filters));
  } catch (err) {
    next(err);
  }
});

router.get('/audit/event-types', requireAdminSubject, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ eventTypes: await distinctEventTypes() });
  } catch (err) {
    next(err);
  }
});

router.get('/audit/export', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query;
    const csv = await exportAuditCsv({
      eventType: typeof q.eventType === 'string' ? q.eventType : undefined,
      subjectType:
        q.subjectType === 'user' || q.subjectType === 'admin' || q.subjectType === 'anonymous'
          ? (q.subjectType as 'user' | 'admin' | 'anonymous')
          : undefined,
      since: typeof q.since === 'string' ? q.since : undefined,
      until: typeof q.until === 'string' ? q.until : undefined,
    });
    recordAudit({
      eventType: 'user.update',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { action: 'audit_csv_export' },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="klab-audit-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

/* ============ DB BACKUP ============ */

router.get('/backup', requireAdminSubject, (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ backups: listBackups() });
  } catch (err) {
    next(err);
  }
});

router.post('/backup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runBackupOnce();
    recordAudit({
      eventType: 'user.update',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { action: 'manual_backup', sizeBytes: result.sizeBytes },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ============ ADMIN MFA ============ */

router.get('/mfa/status', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getMfaStatus(req.auth!.subjectId));
  } catch (err) {
    next(err);
  }
});

router.post('/mfa/enroll', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await enrollMfa(req.auth!.subjectId);
    recordAudit({
      eventType: 'auth.mfa.enroll',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
    });
    // QR + secret döner; verify sonrası enrollment tamamlanır
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/mfa/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = mfaVerifySchema.parse(req.body);
    const result = await verifyMfaCode(req.auth!.subjectId, input.code);
    recordAudit({
      eventType: result.valid ? 'auth.mfa.verify.success' : 'auth.mfa.verify.failure',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: result.valid,
      details: { usedBackupCode: result.usedBackupCode },
    });
    if (!result.valid) {
      throw new HttpError(401, 'MFA kodu geçersiz.', 'MFA_INVALID');
    }
    res.json({ verified: true, usedBackupCode: result.usedBackupCode });
  } catch (err) {
    next(err);
  }
});

router.post('/mfa/disable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = mfaVerifySchema.parse(req.body); // Disable için 1 doğru kod zorunlu
    const verify = await verifyMfaCode(req.auth!.subjectId, input.code);
    if (!verify.valid) {
      throw new HttpError(401, 'MFA kodu geçersiz.', 'MFA_INVALID');
    }
    await disableMfa(req.auth!.subjectId);
    recordAudit({
      eventType: 'auth.mfa.disabled',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
    });
    res.json({ disabled: true });
  } catch (err) {
    next(err);
  }
});

export default router;
