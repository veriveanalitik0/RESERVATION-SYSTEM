/**
 * Admin kullanıcı yönetimi rotaları: liste/detay, güncelleme, silme/geri alma,
 * KVKK ihraç/purge ve parola sıfırlama.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  adminResetUserPasswordSchema,
  adminSetGovernanceRoleSchema,
  adminUserSearchSchema,
  adminUserUpdateSchema,
} from '../../validators/schemas';
import {
  adminDeleteUser,
  adminResetUserPassword,
  adminRestoreUser,
  adminUpdateUser,
  getUserByIdAdmin,
  listAllUsers,
  listDepartments,
  setUserGovernanceRole,
} from '../../services/user.service';
import { recordAudit } from '../../services/audit.service';
import { HttpError } from '../../middleware/error.middleware';
import { readId } from '../../utils/route-helpers';
import { requireAdminSubject } from './shared';

const router = Router();

/* ============ KULLANICI YÖNETİMİ ============ */

// Kullanıcı listesi/detayı tüm kullanıcıların e-posta/departman/hesap-durumu
// (PII) içerir — salt-okunur izleyici/danışman/arge bu veriye ihtiyaç duymaz.
// EN AZ YETKİ gereği yalnız admin'e açık (app_security §1 — A01).
router.get('/users', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = adminUserSearchSchema.safeParse(req.query);
    const filters = parsed.success ? parsed.data : {};
    res.json({ users: await listAllUsers(filters) });
  } catch (err) {
    next(err);
  }
});

router.get('/users/meta/departments', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ departments: await listDepartments() });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    res.json({ user: await getUserByIdAdmin(id) });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    const input = adminUserUpdateSchema.parse(req.body);
    const user = await adminUpdateUser(id, input);

    recordAudit({
      eventType: 'user.update',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { targetUserId: id, fields: Object.keys(input) },
    });

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

/**
 * Admin: kullanıcıya yönetişim rolü atar/kaldırır (null = normal kullanıcı).
 * Rol değişince kullanıcının tüm oturumları düşürülür — yeniden login gerekir.
 */
router.put('/users/:id/governance-role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    const { governanceRole } = adminSetGovernanceRoleSchema.parse(req.body);
    const { user, previousRole } = await setUserGovernanceRole(id, governanceRole);

    // No-op (rol zaten aynı) audit'lenmez — 'user.governance_role_changed' yalnız
    // GERÇEK yetki değişimlerini saysın; aksi halde denetim izi kirlenir.
    const changed = previousRole !== governanceRole;
    if (changed) {
      recordAudit({
        eventType: 'user.governance_role_changed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { targetUserId: id, previousRole, newRole: governanceRole },
      });
    }

    res.json({ user, changed });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    await adminDeleteUser(id);

    recordAudit({
      eventType: 'user.delete',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { targetUserId: id },
    });

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * KVKK — Admin tarafından user verisi ihracı.
 * Kullanım: kullanıcı manuel başvuru yapmış, admin onun adına çekiyor.
 */
router.get(
  '/users/:id/export',
  requireAdminSubject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'id');
      const { exportUserData } = await import('../../services/privacy.service');
      const data = await exportUserData(id);
      recordAudit({
        eventType: 'user.update',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { action: 'admin_data_export', targetUserId: id },
      });
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="klab-veri-${id}.json"`
      );
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(JSON.stringify(data, null, 2));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * KVKK — Admin tarafından user verisi tamamen silme.
 * Body: { confirmation: 'KALICI SİL' }
 */
router.post(
  '/users/:id/purge',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'id');
      const confirmation = req.body?.confirmation;
      if (confirmation !== 'KALICI SİL') {
        throw new HttpError(
          400,
          "Onay metni eksik. Lütfen 'KALICI SİL' yazın.",
          'VALIDATION'
        );
      }
      const { purgeUser } = await import('../../services/privacy.service');
      const result = await purgeUser(id, { id: req.auth!.subjectId, type: 'admin' });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/users/:id/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    const user = await adminRestoreUser(id);

    recordAudit({
      eventType: 'user.restore',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { targetUserId: id },
    });

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

/** Admin: bir kullanıcının parolasını sıfırlar. */
router.post(
  '/users/:id/reset-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'id');
      const { password } = adminResetUserPasswordSchema.parse(req.body);
      await adminResetUserPassword(id, password);
      recordAudit({
        eventType: 'admin.password_reset',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { targetUserId: id },
      });
      res.json({ message: 'Kullanıcının parolası sıfırlandı.' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
