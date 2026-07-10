/**
 * Kullanıcı keşif rotaları: /similar (semantic search), /collaborations (iş birliği
 * önerisi), /leaderboard. user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  collaborationSchema,
  similarSearchSchema,
} from '../../validators/schemas';
import { getBookingByIdForUser } from '../../services/booking.service';
import {
  bookingTextForEmbedding,
  findSimilarBookings,
} from '../../services/embedding.service';
import { getLeaderboard } from '../../services/leaderboard.service';
import { HttpError } from '../../middleware/error.middleware';

const router = Router();

/* ============ SEMANTIC SEARCH (Proje benzerlik) ============ */

router.post('/similar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = similarSearchSchema.parse(req.body);

    let queryText = '';
    let excludeBookingId: string | undefined;

    if (input.bookingId) {
      // Var olan bir booking'in benzerlerini bul — IDOR koruması:
      // user yalnızca kendi booking'ini referans alabilir
      const own = await getBookingByIdForUser(req.auth!.subjectId, input.bookingId);
      if (!own) {
        throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
      }
      queryText = bookingTextForEmbedding({
        projectName: own.projectName,
        projectDescription: own.projectDescription,
        technologies: own.technologies,
      });
      excludeBookingId = own.id;
    } else {
      queryText = bookingTextForEmbedding({
        projectName: input.projectName ?? '',
        projectDescription: input.projectDescription ?? '',
        technologies: input.technologies ?? [],
      });
    }

    // PRIVACY: user-tarafı yalnız opt-in showcase görür + kendi geçmişi
    const results = await findSimilarBookings({
      queryText,
      limit: input.limit ?? 5,
      excludeBookingId,
      minSimilarity: input.minSimilarity ?? 0.3,
      visibility: 'showcase',
      includeOwner: req.auth!.subjectId,
    });

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

/**
 * İŞ BİRLİĞİ ÖNERİSİ (#4) — kullanıcının kendi booking'ine benzer, BAŞKA
 * kullanıcıların PUBLIC (opt-in showcase) projelerini yazarıyla birlikte döner.
 * Amaç: benzer iş yapan ekiplerle bağlantı kurma (authorId → /u/:id, sohbet).
 * IDOR: yalnız kendi booking'i referans alınabilir. Privacy: yalnız showcase.
 */
router.post('/collaborations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = collaborationSchema.parse(req.body);
    const own = await getBookingByIdForUser(req.auth!.subjectId, input.bookingId);
    if (!own) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    const queryText = bookingTextForEmbedding({
      projectName: own.projectName,
      projectDescription: own.projectDescription,
      technologies: own.technologies,
    });
    const results = await findSimilarBookings({
      queryText,
      excludeBookingId: own.id,
      excludeUserId: req.auth!.subjectId, // iş birliği = BAŞKA ekiplerle
      limit: input.limit ?? 6,
      minSimilarity: input.minSimilarity ?? 0.3,
      visibility: 'collaboration', // yalnız public showcase, yazar ifşalı
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

/* ============ LEADERBOARD / SIRALAMA (#5a) ============ */

router.get('/leaderboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLeaderboard());
  } catch (err) {
    next(err);
  }
});

export default router;
