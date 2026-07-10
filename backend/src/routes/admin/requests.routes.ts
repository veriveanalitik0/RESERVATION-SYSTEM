/**
 * Admin talep rotaları: bildirim merkezi, donanım talepleri review ve
 * destek talepleri.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAdmin } from '../../middleware/auth.middleware';
import {
  hardwareRequestsFilterSchema,
  reviewHardwareRequestSchema,
  supportRequestsFilterSchema,
} from '../../validators/schemas';
import {
  listAdminHardwareRequests,
  reviewHardwareRequest,
} from '../../services/hardware-request.service';
import {
  listAdminSupportRequests,
  resolveSupportRequest,
} from '../../services/support-request.service';
import { recordAudit } from '../../services/audit.service';
import { readId } from '../../utils/route-helpers';

const router = Router();

/* ============================================================
 * BİLDİRİM MERKEZİ — admin
 * ============================================================ */

router.get(
  '/notifications',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { listNotifications, countUnreadNotifications } = await import(
        '../../services/notification-center.service'
      );
      const aid = req.auth!.subjectId;
      res.json({
        items: await listNotifications(aid, 'admin'),
        unread: await countUnreadNotifications(aid, 'admin'),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/notifications/:id/read',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'bildirim id');
      const { markNotificationRead } = await import(
        '../../services/notification-center.service'
      );
      await markNotificationRead(req.auth!.subjectId, 'admin', id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/notifications/read-all',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { markAllNotificationsRead } = await import(
        '../../services/notification-center.service'
      );
      const changed = await markAllNotificationsRead(req.auth!.subjectId, 'admin');
      res.json({ marked: changed });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * DONANIM TALEPLERİ — admin review
 * ============================================================ */

router.get(
  '/hardware/requests',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = hardwareRequestsFilterSchema.parse(req.query);
      res.json({ items: await listAdminHardwareRequests(status) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/hardware/requests/:id/review',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const input = reviewHardwareRequestSchema.parse(req.body);
      const request = await reviewHardwareRequest(req.auth!.subjectId, id, input);
      recordAudit({
        eventType: 'hardware_request.reviewed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: request.id, action: input.action, status: request.status },
      });
      res.json({ request });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * DESTEK TALEPLERİ — admin
 * ============================================================ */

router.get(
  '/support/requests',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = supportRequestsFilterSchema.parse(req.query);
      res.json({ items: await listAdminSupportRequests(status) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/support/requests/:id/resolve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const request = await resolveSupportRequest(req.auth!.subjectId, id);
      recordAudit({
        eventType: 'support_request.resolved',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: request.id },
      });
      res.json({ request });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
