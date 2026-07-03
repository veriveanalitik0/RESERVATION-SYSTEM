/**
 * Envanter (showcase) okuma route'ları — `/api/showcase/*`.
 *
 * Rol-bağımsız (requireAnySubject): user / admin / danisman / arge — HEPSİ
 * beğeni sayısını ve yorumları GÖREBİLİR. (Önceden bu uçlar yalnız `/api/user`
 * altında requireUser ile kapalıydı → admin envanterde yorum/beğeni göremiyor,
 * "giriş yap" diyordu.)
 *
 * NOT: Beğenme/yorum YAZMA hâlâ yalnız kullanıcılarda (`/api/user/showcase/*`),
 * çünkü showcase_likes/comments.user_id → users(id) FK'sı admin'i kabul etmez.
 * Bu router salt-okunurdur.
 *
 *  GET /showcase/:id/likes     → beğeni sayısı + (kullanıcıysa) beğendi mi
 *  GET /showcase/:id/comments  → yorum listesi
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAnySubject } from '../middleware/auth.middleware';
import { getLikeStatus, listComments } from '../services/showcase.service';

const router = Router();
router.use(requireAnySubject);

router.get('/:id/likes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id ?? '');
    // Beğeni durumu users(id) FK'sına bağlı. user/danisman/arge subject'leri
    // gerçek bir users kaydıdır (subjectId = users.id) → kendi durumlarını görür.
    // Yalnız admin ayrı tabloda → null (liked=false), sayı yine doğru gelir.
    const userId = req.auth?.subjectType === 'admin' ? null : (req.auth?.subjectId ?? null);
    res.json(await getLikeStatus(id, userId));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id ?? '');
    res.json({ comments: await listComments(id) });
  } catch (err) {
    next(err);
  }
});

export default router;
