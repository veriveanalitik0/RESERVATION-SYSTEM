/**
 * Admin analitik rotaları: booking istatistikleri ve analytics raporu.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getAnalytics } from '../../services/analytics.service';
import { dbAll } from '../../db/schema';
import { requireAdminSubject } from './shared';

const router = Router();

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Tek GROUP BY — önceden tüm bookings tablosu (JOIN'li) çekilip JS'te sayılıyordu.
    const rows = await dbAll(
      `SELECT status, COUNT(*) AS c FROM bookings GROUP BY status`,
      []
    ) as Array<{ status: string; c: number }>;
    const byStatus = new Map(rows.map((r) => [r.status, Number(r.c)]));
    const stats = {
      total: rows.reduce((sum, r) => sum + Number(r.c), 0),
      pending: byStatus.get('pending') ?? 0,
      approved: byStatus.get('approved') ?? 0,
      rejected: byStatus.get('rejected') ?? 0,
      feedback_requested: byStatus.get('feedback_requested') ?? 0,
    };
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

/* ============ ANALYTICS ============ */

// requireAdminSubject: analytics yanıtı topUsers[].email (PII) içerir → salt-okunur
// governance rolleri (izleyici/danışman/arge) görmemeli; /users ile aynı kısıt (A01).
router.get('/analytics', requireAdminSubject, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getAnalytics());
  } catch (err) {
    next(err);
  }
});

export default router;
