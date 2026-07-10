/**
 * Admin analitik rotaları: booking istatistikleri, analytics raporu ve
 * embedding tabanlı semantik benzerlik araması.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { similarSearchSchema } from '../../validators/schemas';
import { getBookingByIdAdmin } from '../../services/booking.service';
import { getAnalytics } from '../../services/analytics.service';
import {
  backfillEmbeddings,
  bookingTextForEmbedding,
  currentModelId,
  findSimilarBookings,
  isMLAvailable,
} from '../../services/embedding.service';
import { HttpError } from '../../middleware/error.middleware';
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

/* ============ SEMANTIC SEARCH (admin tarafından bütün booking'lerde) ============ */

router.get('/embedding/status', (_req: Request, res: Response) => {
  res.json({ mlAvailable: isMLAvailable(), model: currentModelId() });
});

router.post('/embedding/backfill', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await backfillEmbeddings();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/similar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = similarSearchSchema.parse(req.body);
    let queryText = '';
    let excludeBookingId: string | undefined;

    if (input.bookingId) {
      const booking = await getBookingByIdAdmin(input.bookingId);
      if (!booking) throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
      queryText = bookingTextForEmbedding({
        projectName: booking.projectName,
        projectDescription: booking.projectDescription,
        technologies: booking.technologies,
      });
      excludeBookingId = booking.id;
    } else {
      queryText = bookingTextForEmbedding({
        projectName: input.projectName ?? '',
        projectDescription: input.projectDescription ?? '',
        technologies: input.technologies ?? [],
      });
    }

    // Admin: full visibility
    const results = await findSimilarBookings({
      queryText,
      limit: input.limit ?? 8,
      excludeBookingId,
      minSimilarity: input.minSimilarity ?? 0.25,
      visibility: 'admin',
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

export default router;
