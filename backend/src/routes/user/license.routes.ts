/**
 * Kullanıcı lisans rotaları: /licenses (katalog + talep CRUD + yönetişim detayı).
 * user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireUser } from '../../middleware/auth.middleware';
import { createLicenseRequestSchema } from '../../validators/schemas';
import { recordAudit } from '../../services/audit.service';
import { HttpError } from '../../middleware/error.middleware';
import { readId } from '../../utils/route-helpers';

const router = Router();

/* ============================================================
 * LİSANSLAR — kullanıcı katalog & talep
 * ============================================================ */

router.get(
  '/licenses/catalog',
  requireUser,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { getLicenseCatalog } = await import('../../services/license-request.service');
      res.json({ items: getLicenseCatalog() });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/licenses/requests',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { listUserLicenseRequests } = await import('../../services/license-request.service');
      const items = await listUserLicenseRequests(req.auth!.subjectId);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/licenses/requests',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createLicenseRequestSchema.parse(req.body);
      const { createLicenseRequest } = await import('../../services/license-request.service');
      const created = await createLicenseRequest(req.auth!.subjectId, input);

      recordAudit({
        eventType: 'license_request.created',
        subjectId: req.auth!.subjectId,
        subjectType: 'user',
        ipAddress: req.ip,
        success: true,
        details: {
          requestId: created.id,
          requestTitle: created.requestTitle,
          itemCount: created.items.length,
          durationMonths: created.durationMonths,
        },
      });

      // Admin'lere yeni başvuru in-app bildirimi — otomatik reddedilen başvurular hariç.
      if (created.status !== 'rejected') {
        void (async () => {
          try {
            const { notifyAdminsLicenseRequested } = await import(
              '../../services/license-request.service'
            );
            await notifyAdminsLicenseRequested(created);
          } catch {
            /* bildirim best-effort — talep yine de oluşturuldu */
          }
        })();
      }

      res.status(201).json({ request: created });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/licenses/requests/:id',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const input = createLicenseRequestSchema.parse(req.body);
      const { updateLicenseRequest } = await import('../../services/license-request.service');
      const updated = await updateLicenseRequest(req.auth!.subjectId, id, input);

      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'user',
        ipAddress: req.ip,
        success: true,
        details: { requestId: updated.id, status: updated.status },
      });

      res.json({ request: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Başvuru/proje detayı — yönetişim demeti dahil (kalite kapıları,
 * insan onayları, yaşam döngüsü zaman çizelgesi). IDOR: sadece kendi.
 */
router.get(
  '/licenses/requests/:id',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const { getUserLicenseRequestById } = await import(
        '../../services/license-request.service'
      );
      const request = await getUserLicenseRequestById(req.auth!.subjectId, id);
      if (!request) {
        throw new HttpError(404, 'Talep bulunamadı.', 'LICENSE_REQUEST_NOT_FOUND');
      }
      const { listGatesForRequest } = await import('../../services/quality-gate.service');
      const { listApprovalsForRequest } = await import('../../services/human-approval.service');
      const { listStageEvents } = await import('../../services/governance.service');
      res.json({
        request,
        gates: await listGatesForRequest(id),
        approvals: await listApprovalsForRequest(id),
        stageEvents: await listStageEvents(id),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
