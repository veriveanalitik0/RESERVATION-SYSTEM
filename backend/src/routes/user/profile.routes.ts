/**
 * Kullanıcı profil & hesap rotaları: /profile, /me (fotoğraf, lisans kullanımı, KVKK).
 * user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  profileUpdateSchema,
  setShowcaseImageSchema,
} from '../../validators/schemas';
import { getUserProfile, updateUserProfile } from '../../services/user.service';
import { exportUserData, purgeUser } from '../../services/privacy.service';
import { getUserLicenseUsage } from '../../services/license.service';
import { setProfileBackgroundImage } from '../../services/visual.service';
import {
  clearUserProfilePhoto,
  setUserProfilePhoto,
} from '../../services/profile-photo.service';
import { HttpError } from '../../middleware/error.middleware';

const router = Router();

/* ============ PROFİL ============ */

router.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await getUserProfile(req.auth!.subjectId);
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

router.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = profileUpdateSchema.parse(req.body);
    const profile = await updateUserProfile(req.auth!.subjectId, input);
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

/* ============ PROFİL FOTOĞRAFI ============ */

router.put('/me/photo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dataUrl = req.body?.dataUrl;
    if (typeof dataUrl !== 'string') {
      throw new HttpError(400, 'dataUrl eksik.', 'VALIDATION');
    }
    await setUserProfilePhoto(req.auth!.subjectId, dataUrl);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/me/photo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await clearUserProfilePhoto(req.auth!.subjectId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ============ KENDİ LİSANS KULLANIMI ============ */

router.get('/me/licenses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const usage = await getUserLicenseUsage(req.auth!.subjectId);
    if (!usage) {
      // Aktif booking yok → boş response
      res.json({
        userId: req.auth!.subjectId,
        userFullName: '',
        userEmail: '',
        department: null,
        licenses: [],
        totalMonthlyUsd: 0,
        activeBookingCount: 0,
      });
      return;
    }
    res.json(usage);
  } catch (err) {
    next(err);
  }
});

/* ============ KVKK — Veri ihracı + Right to be Forgotten ============ */

/** Kullanıcı kendi verilerini JSON olarak indirir. */
router.get('/me/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await exportUserData(req.auth!.subjectId);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="klab-veri-${req.auth!.subjectId}.json"`
    );
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    next(err);
  }
});

/**
 * Kullanıcı kendi hesabını ve verilerini siler.
 * Body: { confirmation: 'HESABIMI SİL' } (yanlışlıkla çağrı koruması)
 */
router.post('/me/purge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const confirmation = req.body?.confirmation;
    if (confirmation !== 'HESABIMI SİL') {
      throw new HttpError(
        400,
        "Onay metni eksik. Lütfen 'HESABIMI SİL' yazın.",
        'VALIDATION'
      );
    }
    const result = await purgeUser(req.auth!.subjectId, {
      id: req.auth!.subjectId,
      type: 'user',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Kullanıcının kişisel profil arka planı görselini ata / kaldır (leaderboard + public profil).
router.put('/profile/background', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = setShowcaseImageSchema.parse(req.body);
    const result = await setProfileBackgroundImage(req.auth!.subjectId, input.visualId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
