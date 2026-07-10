/**
 * Kullanıcı bildirim merkezi rotaları: /notifications (liste + okundu işaretleme).
 * user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireUser } from '../../middleware/auth.middleware';
import { readId } from '../../utils/route-helpers';

const router = Router();

/* ============ BİLDİRİM MERKEZİ ============ */

router.get(
  '/notifications',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { listNotifications, countUnreadNotifications } = await import(
        '../../services/notification-center.service'
      );
      const uid = req.auth!.subjectId;
      res.json({
        items: await listNotifications(uid, 'user'),
        unread: await countUnreadNotifications(uid, 'user'),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/notifications/:id/read',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'bildirim id');
      const { markNotificationRead } = await import(
        '../../services/notification-center.service'
      );
      await markNotificationRead(req.auth!.subjectId, 'user', id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/notifications/read-all',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { markAllNotificationsRead } = await import(
        '../../services/notification-center.service'
      );
      const changed = await markAllNotificationsRead(req.auth!.subjectId, 'user');
      res.json({ marked: changed });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
