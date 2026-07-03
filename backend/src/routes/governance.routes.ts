/**
 * Kullanıcı yönetişim rolleri için route'lar.
 *
 *  /governance/danisman/* → Analitik Danışman (RACI: R/A "Başvuru değerlendirme")
 *    - License request + booking inbox + approve/reject/feedback/SWAT aksiyonları
 *  /governance/arge/*      → YZ/Ar-Ge Mühendisi (RACI: R/A "Stage onayı / Production onayı / Rollback")
 *    - Onaylı projeler + advance/regress stage + advance request yönetimi
 *
 * Tüm endpoint'ler:
 *  - requireUser → kullanıcı JWT zorunlu
 *  - csrfProtection → state-changing mutations CSRF token zorunlu
 *  - requireUserGovernanceRole → ilgili rol yetkisi zorunlu
 *
 * Mevcut admin service fonksiyonları yeniden kullanılır — yetki ek olarak rol
 * tabanlı; davranış, ses ve audit aynı kalır (subjectId = user id).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireArge, requireDanisman, requireIzleyici } from '../middleware/auth.middleware';
import { csrfProtection } from '../middleware/cookie-auth';
import { HttpError } from '../middleware/error.middleware';
import { readId } from '../utils/route-helpers';
import {
  reviewLicenseRequestSchema,
} from '../validators/schemas';
import {
  advanceBookingLifecycle,
  getBookingByIdAdmin,
  listAllBookings,
  regressBookingLifecycle,
  rejectStageAdvanceRequest,
} from '../services/booking.service';
import {
  listAdminLicenseRequests,
  reviewLicenseRequest,
} from '../services/license-request.service';

const router = Router();
router.use(csrfProtection);

/* ============================================================
 * ANALITIK DANIŞMAN — Başvuru değerlendirme inbox
 * Tüm danisman endpoint'leri kind='danisman' token bekler (ayrı audience).
 * ============================================================ */

const danismanGuard = requireDanisman;

/** Danışmanın inbox'ı — license_requests + pending/feedback booking'ler. */
router.get('/danisman/inbox', danismanGuard, async (_req, res, next) => {
  try {
    const licenseRequests = await listAdminLicenseRequests();
    const bookings = await listAllBookings();
    // Danışman için anlamlı durumlar: pending + feedback_requested.
    const pendingBookings = bookings.filter(
      (b) => b.status === 'pending' || b.status === 'feedback_requested'
    );
    res.json({
      licenseRequests,
      bookings: pendingBookings,
      counts: {
        licenseRequestsPending: licenseRequests.filter((r) => r.status === 'pending').length,
        bookingsPending: pendingBookings.filter((b) => b.status === 'pending').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// NOT: Danışmanın booking review endpoint'i KALDIRILDI — randevu taleplerini
// yalnız admin onaylar/reddeder; danışman inbox'tan salt-görüntüler.

/** Danışman: license request review (approve / reject / feedback / swat). */
router.post(
  '/danisman/license-requests/:id/review',
  danismanGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'license id');
      const input = reviewLicenseRequestSchema.parse(req.body);
      const updated = await reviewLicenseRequest(req.auth!.subjectId, id, input, 'danisman');
      res.json({ request: updated });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * YZ / Ar-Ge — Stage + Production onayları
 * ============================================================ */

const argeGuard = requireArge;
/** İzleyici — salt-okunur; yalnız bildirim/destek uçları için kullanılır. */
const izleyiciGuard = requireIzleyici;

/** Ar-Ge dashboard — onaylı projeler (özellikle advance request veya stage/production'da olanlar). */
router.get('/arge/projects', argeGuard, async (_req, res, next) => {
  try {
    const bookings = await listAllBookings({ status: 'approved' });
    res.json({
      projects: bookings,
      counts: {
        total: bookings.length,
        withAdvanceRequest: bookings.filter((b) => !!b.stageAdvanceRequestedAt).length,
        inStage: bookings.filter((b) => b.lifecycleStage === 'stage').length,
        inProduction: bookings.filter((b) => b.lifecycleStage === 'production').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Ar-Ge: bir projeyi bir sonraki aşamaya ilerlet. */
router.post(
  '/arge/bookings/:id/advance-stage',
  argeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const booking = await advanceBookingLifecycle(req.auth!.subjectId, id, 'arge');
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Ar-Ge: bir projeyi bir önceki aşamaya geri al (rollback). */
router.post(
  '/arge/bookings/:id/regress-stage',
  argeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const booking = await regressBookingLifecycle(req.auth!.subjectId, id, 'arge');
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Ar-Ge: kullanıcının aşama ilerletme talebini reddet. */
router.delete(
  '/arge/bookings/:id/advance-request',
  argeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const booking = await rejectStageAdvanceRequest(req.auth!.subjectId, id);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Ar-Ge: tek booking detay (modal için). */
router.get('/arge/bookings/:id', argeGuard, async (req, res, next) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const booking = await getBookingByIdAdmin(id);
    if (!booking) throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
 * BİLDİRİM MERKEZİ — Danışman & Ar-Ge
 * Danışman/Ar-Ge subject'i users tablosunda yaşar → recipient_type 'user'.
 * NotificationCenter `/{kind}/notifications` çağırır; user/admin için doğrudan
 * route var, danisman/arge için bu governance-prefixed eşdeğerleri kullanılır.
 * ============================================================ */
const GOVERNANCE_ROLES: ReadonlyArray<{ prefix: 'danisman' | 'arge' | 'izleyici'; guard: typeof danismanGuard }> = [
  { prefix: 'danisman', guard: danismanGuard },
  { prefix: 'arge', guard: argeGuard },
  { prefix: 'izleyici', guard: izleyiciGuard },
];

for (const { prefix, guard } of GOVERNANCE_ROLES) {
  router.get(
    `/${prefix}/notifications`,
    guard,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { listNotifications, countUnreadNotifications } = await import(
          '../services/notification-center.service'
        );
        const uid = req.auth!.subjectId;
        // Rol-izolasyonu: danışman/arge KENDİ recipient_type'ını görür, user'ın
        // kişisel bildirimlerini DEĞİL (önceki 'user' kapsamı sızıntıydı).
        res.json({
          items: await listNotifications(uid, prefix),
          unread: await countUnreadNotifications(uid, prefix),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    `/${prefix}/notifications/:id/read`,
    guard,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = readId(req, 'id', 'bildirim id');
        const { markNotificationRead } = await import(
          '../services/notification-center.service'
        );
        await markNotificationRead(req.auth!.subjectId, prefix, id);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    `/${prefix}/notifications/read-all`,
    guard,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { markAllNotificationsRead } = await import(
          '../services/notification-center.service'
        );
        const marked = await markAllNotificationsRead(req.auth!.subjectId, prefix);
        res.json({ marked });
      } catch (err) {
        next(err);
      }
    }
  );

  // Destek talebi — danışman/ar-ge de (subject = user) destek isteyebilsin.
  router.post(
    `/${prefix}/support/requests`,
    guard,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { createSupportRequestSchema } = await import('../validators/schemas');
        const { createSupportRequest } = await import('../services/support-request.service');
        const { recordAudit } = await import('../services/audit.service');
        const input = createSupportRequestSchema.parse(req.body);
        const request = await createSupportRequest(req.auth!.subjectId, input.description);
        recordAudit({
          eventType: 'support_request.created',
          subjectId: req.auth!.subjectId,
          subjectType: 'user',
          ipAddress: req.ip,
          success: true,
          details: { requestId: request.id, via: prefix },
        });
        res.status(201).json({ request });
      } catch (err) {
        next(err);
      }
    }
  );
}

export default router;
