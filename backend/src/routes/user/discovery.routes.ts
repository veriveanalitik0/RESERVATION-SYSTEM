/**
 * Kullanıcı keşif rotaları: /leaderboard. user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getLeaderboard } from '../../services/leaderboard.service';

const router = Router();

/* ============ LEADERBOARD / SIRALAMA (#5a) ============ */

router.get('/leaderboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLeaderboard());
  } catch (err) {
    next(err);
  }
});

export default router;
