/**
 * Admin lisans rotaları: lisans raporu/kataloğu, talep review + bütçe ve
 * yönetişim (yaşam döngüsü, kalite kapıları, insan onayları).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  requireAdmin,
  requireAdminRole,
  requireGovernanceRole,
} from '../../middleware/auth.middleware';
import {
  adminLicenseRequestsFilterSchema,
  advanceLifecycleSchema,
  assignEngineerSchema,
  decideApprovalSchema,
  gateResultSchema,
  reviewLicenseRequestSchema,
} from '../../validators/schemas';
import { getLicenseReport, LICENSE_CATALOG } from '../../services/license.service';
import { recordAudit } from '../../services/audit.service';
import { HttpError } from '../../middleware/error.middleware';
import { readId } from '../../utils/route-helpers';
import { dbAll } from '../../db/schema';
import { readPage } from './shared';

const router = Router();

/* ============ LİSANSLAR ============ */

router.get('/licenses', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLicenseReport());
  } catch (err) {
    next(err);
  }
});

router.get('/licenses/catalog', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // UI tarafında "tanınan teknolojiler" gösterimi için
    const list = Object.entries(LICENSE_CATALOG).map(([key, info]) => ({
      key,
      ...info,
    }));
    res.json({ catalog: list });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
 * LİSANSLAR — admin talep review
 * ============================================================ */

router.get(
  // Salt-okunur LİSTE: admin + danışman + arge görebilir (global GET→requireStaff
  // politikası geçerli). Önceki fazladan `requireAdmin`, arge/danışman'ı reddedip
  // "kimlik doğrulama başarısız" veriyordu. Mutasyonlar hâlâ requireAdmin.
  '/licenses/requests',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = adminLicenseRequestsFilterSchema.parse(req.query);
      const { listAdminLicenseRequests } = await import('../../services/license-request.service');
      const items = await listAdminLicenseRequests(status, readPage(req));
      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  // Salt-okunur bütçe raporu — staff (admin/danışman/arge) görebilir.
  '/licenses/budget',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { getLicenseBudgetReport } = await import('../../services/license-request.service');
      res.json(await getLicenseBudgetReport());
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/licenses/requests/:id/review',
  requireAdmin,
  requireAdminRole('admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const input = reviewLicenseRequestSchema.parse(req.body);
      const { reviewLicenseRequest } = await import('../../services/license-request.service');
      const updated = await reviewLicenseRequest(req.auth!.subjectId, id, input);
      recordAudit({
        eventType: 'license_request.reviewed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: updated.id, action: input.action, status: updated.status },
      });
      res.json({ request: updated });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * YÖNETİŞİM — yaşam döngüsü, kalite kapıları, onaylar
 * ============================================================ */

/** id parametresini doğrular. */
function readRequestId(req: Request): string {
  return readId(req, 'id', 'talep id');
}

/** Başvuru/proje detayı — yönetişim demeti dahil. */
router.get(
  '/licenses/requests/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const { getAdminLicenseRequestById } = await import(
        '../../services/license-request.service'
      );
      const request = await getAdminLicenseRequestById(id);
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

/** Yönetişim dashboard metrikleri. */
router.get(
  '/licenses/governance/dashboard',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { getGovernanceDashboard } = await import('../../services/governance.service');
      res.json(await getGovernanceDashboard());
    } catch (err) {
      next(err);
    }
  }
);

/** Lab Mühendisi atama için admin listesi. */
router.get(
  '/governance/admins',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await dbAll(`SELECT id, full_name, role, governance_role
           FROM admins WHERE status = 1 ORDER BY full_name`, []) as Array<{
        id: string;
        full_name: string;
        role: string;
        governance_role: string | null;
      }>;
      res.json({
        admins: rows.map((r) => ({
          id: r.id,
          fullName: r.full_name,
          role: r.role,
          governanceRole: r.governance_role,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Projeyi bir sonraki yaşam döngüsü aşamasına ilerlet. */
router.post(
  '/licenses/requests/:id/advance',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const input = advanceLifecycleSchema.parse(req.body);
      const { advanceLifecycle } = await import('../../services/governance.service');
      const { getAdminLicenseRequestById } = await import(
        '../../services/license-request.service'
      );
      const result = await advanceLifecycle(id, req.auth!.subjectId, input.note);
      const request = (await getAdminLicenseRequestById(id))!;

      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: id, action: 'advance', from: result.fromStage, to: result.toStage },
      });

      const { pushNotification } = await import('../../services/notification-center.service');
      const { STAGE_LABEL } = await import('../../services/governance-data');
      pushNotification({
        recipientId: request.userId,
        recipientType: 'user',
        category: 'license',
        title: `Projen ${STAGE_LABEL[result.toStage]} aşamasına geçti`,
        body: `"${request.requestTitle ?? request.licenseName}" — yaşam döngüsü ilerledi.`,
        link: '/licenses',
      });

      res.json({ request, transition: result });
    } catch (err) {
      next(err);
    }
  }
);

/** Lab Mühendisi ata. */
router.post(
  '/licenses/requests/:id/assign-engineer',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const input = assignEngineerSchema.parse(req.body);
      const { assignEngineer } = await import('../../services/governance.service');
      const { getAdminLicenseRequestById } = await import(
        '../../services/license-request.service'
      );
      await assignEngineer(id, input.engineerId);
      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: id, action: 'assign_engineer', engineerId: input.engineerId },
      });
      res.json({ request: await getAdminLicenseRequestById(id) });
    } catch (err) {
      next(err);
    }
  }
);

/** Proje türünü Kuruma Entegre'ye yükselt. */
router.post(
  '/licenses/requests/:id/upgrade-type',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const { upgradeProjectType } = await import('../../services/governance.service');
      const { getAdminLicenseRequestById } = await import(
        '../../services/license-request.service'
      );
      await upgradeProjectType(id, req.auth!.subjectId);
      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: id, action: 'upgrade_type' },
      });
      res.json({ request: await getAdminLicenseRequestById(id) });
    } catch (err) {
      next(err);
    }
  }
);

/** Kalite kapısı sonucunu kaydet/güncelle. */
router.put(
  '/licenses/requests/:id/gates',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const input = gateResultSchema.parse(req.body);
      const { setGateResult } = await import('../../services/quality-gate.service');
      // Varlık kontrolü: yoksa öksüz quality_gates satırı + sahte 'updated' audit'i oluşuyordu.
      const { getAdminLicenseRequestById: getReq } = await import('../../services/license-request.service');
      if (!(await getReq(id))) {
        throw new HttpError(404, 'Talep bulunamadı.', 'LICENSE_REQUEST_NOT_FOUND');
      }
      const gate = await setGateResult(id, input.gateKey, {
        status: input.status,
        score: input.score ?? null,
        detail: input.detail ?? null,
      });
      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: id, action: 'gate_result', gate: input.gateKey, status: input.status },
      });
      res.json({ gate });
    } catch (err) {
      next(err);
    }
  }
);

/** Stage / Production insan onayı kararı — YZ/Ar-Ge Mühendisi yetkisi. */
router.post(
  '/licenses/requests/:id/approval',
  requireGovernanceRole('yz_arge'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const input = decideApprovalSchema.parse(req.body);
      const { decideApproval } = await import('../../services/human-approval.service');
      const { getAdminLicenseRequestById } = await import(
        '../../services/license-request.service'
      );
      const approval = await decideApproval(id, input.approvalType, req.auth!.subjectId, {
        decision: input.decision,
        releaseNote: input.releaseNote,
        riskAssessment: input.riskAssessment,
      });
      const request = (await getAdminLicenseRequestById(id))!;

      recordAudit({
        eventType: 'license_request.reviewed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: {
          requestId: id,
          action: 'approval',
          approvalType: input.approvalType,
          decision: input.decision,
        },
      });

      const { pushNotification } = await import('../../services/notification-center.service');
      const typeLabel = input.approvalType === 'stage' ? 'Stage' : 'Production';
      pushNotification({
        recipientId: request.userId,
        recipientType: 'user',
        category: 'license',
        title: `${typeLabel} onayı ${input.decision === 'approved' ? 'verildi' : 'reddedildi'}`,
        body: `"${request.requestTitle ?? request.licenseName}" — ${typeLabel} insan onay noktası.`,
        link: '/licenses',
      });

      res.json({ request, approval });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
