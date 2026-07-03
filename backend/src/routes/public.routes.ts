/**
 * Public (auth gerektirmeyen) endpoint'ler.
 *
 * Kullanım amacı: Vibe coding showcase galerisi — onaylanan ve `showcase_visible=1`
 * olan projeler herkese (giriş yapmadan) gösterilebilir.
 *
 * Güvenlik:
 * - Sadece `status='approved' AND showcase_visible=1` döner.
 * - PII (kullanıcı e-postası) ASLA dönmez; sadece full_name (kullanıcı opt-in varsayılır
 *   demo için; production'da showcase_visible kullanıcı consent ile bağlanmalı).
 * - Read-only; herhangi bir mutation yok.
 * - Rate limit globalde uygulanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { dbOne } from '../db/schema';
import { getPublicProfile } from '../services/public-profile.service';
import { getShowcaseEngagement } from '../services/showcase.service';
import {
  getShowcaseFeed,
  getShowcaseItems,
  getShowcaseTechnologies,
} from '../services/showcase-feed.service';
import {
  isSafeVisualId,
  safeSeed,
  serveStoredImage,
} from '../services/visual-store.service';
import { getRoomKiosk, listKioskRooms } from '../services/kiosk.service';
import { HttpError } from '../middleware/error.middleware';
import { readId } from '../utils/route-helpers';

const router = Router();

/**
 * Showcase FEED — galeri verisini TEK çağrıda toplar (#3): items + technologies
 * + engagement. Frontend Showcase.tsx artık 3 yerine 1 istek atar. Server-side
 * cache showcase-feed.service'te (items/technologies 30s TTL, engagement taze).
 */
router.get('/showcase/feed', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getShowcaseFeed());
  } catch (err) {
    next(err);
  }
});

// Eski tekil endpoint'ler — geriye uyum (aynı cache'li servisi kullanır).
router.get('/showcase', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getShowcaseItems());
  } catch (err) {
    next(err);
  }
});

/** Showcase için top teknolojiler (etiket bulutu). */
router.get('/showcase/technologies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ technologies: await getShowcaseTechnologies() });
  } catch (err) {
    next(err);
  }
});

/* ============ PUBLIC USER PROFILE ============ */

router.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    res.json({ profile: await getPublicProfile(id) });
  } catch (err) {
    next(err);
  }
});

/* ============ SHOWCASE ENGAGEMENT (public) ============ */

router.get('/showcase/engagement', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ engagement: await getShowcaseEngagement() });
  } catch (err) {
    next(err);
  }
});

/* ============ GÖRSEL PROXY (saklanan baytlar) ============ */

/**
 * Saklanan görsel baytlarını serve eder (veri-yönetişimi: prompt URL'de DEĞİL +
 * provider uptime'ından bağımsız). `?v=<seed>` verilirse o varyant; verilmezse
 * görselin güncel seed'i (DB'den). Saklanan dosya yoksa 404 — bu durumda görselin
 * image_url'i zaten dış URL'dedir (graceful fallback), bu route hiç çağrılmaz.
 *
 * Public: showcase galerisi (auth'suz) arkaplan görsellerini bu URL'den yükler.
 * id nanoid (tahmin edilemez); IDOR riski yok — yalnız saklanan görsel serve edilir.
 */
router.get('/visuals/:id/image', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id ?? '');
    if (!isSafeVisualId(id)) {
      throw new HttpError(400, 'Geçersiz görsel id.', 'INVALID_ID');
    }
    let seed = safeSeed(req.query.v);
    if (seed === null) {
      // ?v yoksa görselin güncel seed'ini DB'den çöz.
      const row = await dbOne('SELECT seed FROM visuals WHERE id = ?', [id]) as
        | { seed: number | null }
        | undefined;
      seed = row?.seed ?? null;
    }
    if (seed === null) {
      res.status(404).end();
      return;
    }
    const served = await serveStoredImage(res, id, seed);
    if (!served) res.status(404).end();
  } catch (err) {
    next(err);
  }
});

/**
 * Profil fotoğrafı — binary servis.
 *
 * Fotoğraflar DB'de base64 data URL olarak durur; önceden tüm liste
 * yanıtlarına gömülüyordu (payload şişmesi: 60 kartlık public feed ~16MB).
 * Artık listeler bu URL'i döner; tarayıcı cache'ler (1 saat).
 * Public maruziyet yeni değil: aynı fotoğraflar public showcase feed'de
 * zaten auth'suz servis ediliyordu. id nanoid — enumere edilemez.
 */
router.get('/users/:id/photo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    const row = await dbOne(
      'SELECT profile_photo FROM users WHERE id = ? AND status != 3',
      [id]
    ) as { profile_photo: string | null } | undefined;

    const dataUrl = row?.profile_photo;
    const JPEG_PREFIX = 'data:image/jpeg;base64,';
    if (!dataUrl || !dataUrl.startsWith(JPEG_PREFIX)) {
      res.status(404).end();
      return;
    }
    const buf = Buffer.from(dataUrl.slice(JPEG_PREFIX.length), 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

/* ============ KIOSK — oda ekranı (#5b) ============ */

/** Kiosk seçici için aktif odaların minimal listesi. */
router.get('/rooms', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ rooms: await listKioskRooms() });
  } catch (err) {
    next(err);
  }
});

/**
 * Bir odanın kiosk verisi: oda + son üretilen 'ready' görsel (yoksa idle screen).
 * Public (oda ekranı); yalnız görsel iç URL'i + zaman + oda bilgisi (PII yok).
 */
router.get('/rooms/:id/kiosk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'oda id');
    const data = await getRoomKiosk(id);
    if (!data) {
      throw new HttpError(404, 'Oda bulunamadı.', 'ROOM_NOT_FOUND');
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
