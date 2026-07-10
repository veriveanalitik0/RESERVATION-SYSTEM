/**
 * Kullanıcı showcase etkileşim rotaları: /showcase (like & comment & engagement).
 * user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  getLikeStatus,
  getShowcaseEngagement,
  listComments,
  postComment,
  toggleLike,
  deleteComment,
} from '../../services/showcase.service';
import { dbOne } from '../../db/schema';

const router = Router();

/* ============ SHOWCASE — LIKE & COMMENT ============ */

router.get(
  '/showcase/:id/likes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id ?? '');
      res.json(await getLikeStatus(id, req.auth!.subjectId));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/showcase/:id/like',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id ?? '');
      res.json(await toggleLike(id, req.auth!.subjectId));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/showcase/:id/comments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id ?? '');
      res.json({ comments: await listComments(id) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/showcase/:id/comments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id ?? '');
      const body = String(req.body?.body ?? '');
      const profile = await dbOne('SELECT full_name FROM users WHERE id = ?', [req.auth!.subjectId]) as { full_name: string } | undefined;
      const comment = await postComment({
        bookingId: id,
        userId: req.auth!.subjectId,
        userFullName: profile?.full_name ?? 'Kullanıcı',
        body,
      });
      res.status(201).json({ comment });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/showcase/comments/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id ?? '');
      res.json(await deleteComment(id, req.auth!.subjectId));
    } catch (err) {
      next(err);
    }
  }
);

router.get('/showcase/engagement', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ engagement: await getShowcaseEngagement() });
  } catch (err) {
    next(err);
  }
});

export default router;
