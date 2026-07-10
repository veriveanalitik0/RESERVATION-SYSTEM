/**
 * Kullanıcı görsel üretimi rotaları: /visuals (gorsel_uretim entegrasyonu) +
 * /chat/background. user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { expensiveActionRateLimit } from '../../middleware/security.middleware';
import {
  createVisualSchema,
  setShowcaseImageSchema,
} from '../../validators/schemas';
import {
  createVisual,
  listMyVisuals,
  regenerateVisual,
  setChatBackgroundImage,
  deleteVisual,
} from '../../services/visual.service';
import { readId } from '../../utils/route-helpers';

const router = Router();

/* ============================================================
 * GÖRSEL ÜRETİMİ — kullanıcı (gorsel_uretim entegrasyonu)
 * ============================================================ */

router.post('/visuals', expensiveActionRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createVisualSchema.parse(req.body);
    const visual = await createVisual(req.auth!.subjectId, input);
    res.status(201).json({ visual });
  } catch (err) {
    next(err);
  }
});

router.get('/visuals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ visuals: await listMyVisuals(req.auth!.subjectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/visuals/:id/regenerate', expensiveActionRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'görsel id');
    const visual = await regenerateVisual(req.auth!.subjectId, id);
    res.json({ visual });
  } catch (err) {
    next(err);
  }
});

router.delete('/visuals/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'görsel id');
    res.json(await deleteVisual(req.auth!.subjectId, id));
  } catch (err) {
    next(err);
  }
});

// Sohbet ekranı arka plan temasını ata / kaldır.
router.put('/chat/background', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = setShowcaseImageSchema.parse(req.body);
    const result = await setChatBackgroundImage(req.auth!.subjectId, input.visualId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
