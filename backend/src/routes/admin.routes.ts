/**
 * Admin routes (composer): tüm booking'leri görme + onay/red/feedback.
 * Alan modülleri ./admin/*.routes.ts altında; bu dosya router-seviyesi
 * guard'ları uygular ve modülleri tek Router üzerinde birleştirir.
 * Path: /api/admin/*
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  requireAdmin,
  requireAdminRole,
  requireStaff,
} from '../middleware/auth.middleware';
import { csrfProtection } from '../middleware/cookie-auth';
import bookingsRouter from './admin/bookings.routes';
import usersRouter from './admin/users.routes';
import analyticsRouter from './admin/analytics.routes';
import securityRouter from './admin/security.routes';
import licensesRouter from './admin/licenses.routes';
import requestsRouter from './admin/requests.routes';
import libraryRouter from './admin/library.routes';

const router = Router();

// Erişim politikası:
//  - GET (read-only) → requireStaff: admin + Analitik Danışman + YZ/Ar-Ge.
//    Governance rolleri admin panel sayfalarını (oda, takvim, proje, kullanıcı,
//    lisans) görüntüleyebilir ama değiştiremez.
//  - Mutasyonlar (POST/PUT/PATCH/DELETE) → requireAdmin + admin rol kontrolü.
router.use((req: Request, res: Response, next: NextFunction) => {
  // Guard'lar async ama tüm hata yolları içeride next()'e bağlanır — reddetme
  // promise üzerinden değil next ile akar (bilinçli fire-and-forget).
  if (req.method === 'GET') {
    void requireStaff(req, res, next);
    return;
  }
  void requireAdmin(req, res, next);
});
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET') {
    next(); // GET zaten requireStaff'tan geçti — admin rol kontrolü atlanır
    return;
  }
  requireAdminRole('admin', 'super_admin')(req, res, next);
});

// CSRF — tüm admin state-changing endpoint'leri korur (booking review,
// user update/restore/purge, MFA, license review, backup, vb.).
// GET'ler csrf-csrf `ignoredMethods` ile muaf.
router.use(csrfProtection);

// Alan modülleri — mount sırası orijinal tanım sırasını izler; modüllerin ilk
// path segmentleri ayrık olduğundan Express eşleşme davranışı değişmez.
router.use(bookingsRouter);
router.use(usersRouter);
router.use(analyticsRouter);
router.use(securityRouter);
router.use(licensesRouter);
router.use(requestsRouter);
router.use(libraryRouter);

export default router;
