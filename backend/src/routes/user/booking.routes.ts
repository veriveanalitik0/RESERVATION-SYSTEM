/**
 * Kullanıcı booking & waitlist rotaları: /bookings (CRUD, aşama, showcase izni,
 * randevu listesi) + /waitlist. user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { logger } from '../../utils/logger';
import {
  bookingProgressSchema,
  createBookingSchema,
  setShowcaseImageSchema,
  joinWaitlistSchema,
  stageAdvanceRequestSchema,
} from '../../validators/schemas';
import {
  createBooking,
  deleteBooking,
  getBookingByIdForUser,
  listUserBookings,
  requestStageAdvance,
  selfAdvanceBookingStage,
  updateBooking,
} from '../../services/booking.service';
import { listBookingAppointments } from '../../services/appointment.service';
import {
  cancelWaitlist,
  removeWaitlistEntry,
  joinWaitlist,
  listUserWaitlist,
} from '../../services/waitlist.service';
import {
  bookingTextForEmbedding,
  detectDuplicate,
} from '../../services/embedding.service';
import { setBookingShowcaseImage } from '../../services/visual.service';
import { recordAudit } from '../../services/audit.service';
import { HttpError } from '../../middleware/error.middleware';
import { readId } from '../../utils/route-helpers';
import { dbRun } from '../../db/schema';

const router = Router();

router.get('/bookings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bookings = await listUserBookings(req.auth!.subjectId);
    res.json({ bookings });
  } catch (err) {
    next(err);
  }
});

router.post('/bookings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createBookingSchema.parse(req.body);
    const booking = await createBooking(req.auth!.subjectId, input);

    recordAudit({
      eventType: 'booking.created',
      subjectId: req.auth!.subjectId,
      subjectType: 'user',
      ipAddress: req.ip,
      success: true,
      details: {
        bookingId: booking.id,
        roomCode: booking.roomCode,
        periodMonths: booking.periodMonths,
      },
    });

    // Otomatik duplicate-tespiti (#4) — best-effort, booking ZATEN oluştu (bloklamaz).
    // Çok benzer mevcut bir proje varsa kullanıcıya uyarı amaçlı döndürülür.
    let duplicateWarning = null;
    try {
      const embText = bookingTextForEmbedding({
        projectName: booking.projectName,
        projectDescription: booking.projectDescription,
        technologies: booking.technologies,
      });
      duplicateWarning = await detectDuplicate({
        queryText: embText,
        excludeBookingId: booking.id,
        userId: req.auth!.subjectId,
      });
    } catch {
      /* tespit best-effort — booking yine de döndürülür */
    }

    res.status(201).json({ booking, duplicateWarning });
  } catch (err) {
    next(err);
  }
});

router.get('/bookings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const booking = await getBookingByIdForUser(req.auth!.subjectId, id);
    if (!booking) throw new HttpError(404, 'Booking bulunamadı.', 'NOT_FOUND');
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

/**
 * Booking düzenle (PUT) — yalnızca kullanıcının kendi pending/feedback_requested talepleri.
 * Düzenleme sonrası status → 'pending' (admin tekrar incelesin).
 */
router.put('/bookings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const input = createBookingSchema.parse(req.body);
    const booking = await updateBooking(req.auth!.subjectId, id, input);

    recordAudit({
      eventType: 'booking.updated',
      subjectId: req.auth!.subjectId,
      subjectType: 'user',
      ipAddress: req.ip,
      success: true,
      details: {
        bookingId: booking.id,
        roomCode: booking.roomCode,
        periodMonths: booking.periodMonths,
      },
    });

    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

/**
 * İlerleme notu güncelle — kullanıcı dashboard'unun "ne üzerinde çalışıyorum"
 * alanı. Yalnız sahibi, yalnız onaylı booking.
 */
router.put('/bookings/:id/progress', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const input = bookingProgressSchema.parse(req.body);
    const { updateBookingProgress } = await import('../../services/booking.service');
    const booking = await updateBookingProgress(req.auth!.subjectId, id, input.progressNote);
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

/**
 * ONAYLI rezervasyonu iptal et — kayıt silinmez, 'cancelled' olur; oda
 * kapasitesi serbest kalır ve waitlist promotion tetiklenir.
 */
router.post('/bookings/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const { cancelApprovedBooking } = await import('../../services/booking.service');
    const booking = await cancelApprovedBooking(id, { id: req.auth!.subjectId, type: 'user' });
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

/**
 * Booking geri çek (DELETE) — yalnızca pending/feedback_requested.
 */
router.delete('/bookings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const result = await deleteBooking(req.auth!.subjectId, id);

    recordAudit({
      eventType: 'booking.withdrawn',
      subjectId: req.auth!.subjectId,
      subjectType: 'user',
      ipAddress: req.ip,
      success: true,
      details: { bookingId: id, roomId: result.roomId },
    });

    // Waitlist promote (async, fire-and-forget)
    void import('../../services/waitlist.service')
      .then((m) => m.tryPromoteForRoom(result.roomId))
      .catch((err) => logger.warn('waitlist_promote_failed', { err: (err as Error).message }));

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/* ============ WAITLIST ============ */

router.get('/waitlist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ entries: await listUserWaitlist(req.auth!.subjectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/waitlist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = joinWaitlistSchema.parse(req.body);
    const entry = await joinWaitlist(req.auth!.subjectId, input);
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

router.delete('/waitlist/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    await cancelWaitlist(req.auth!.subjectId, id);
    res.json({ cancelled: true });
  } catch (err) {
    next(err);
  }
});

// Geçmiş kaydı (iptal/süresi geçmiş) kalıcı kaldır.
router.delete('/waitlist/:id/remove', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    res.json(await removeWaitlistEntry(req.auth!.subjectId, id));
  } catch (err) {
    next(err);
  }
});

/* ============ SHOWCASE PERMISSION (kendi booking'i) ============ */

router.put(
  '/bookings/:id/showcase',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const visible = req.body?.visible;
      if (typeof visible !== 'boolean') {
        throw new HttpError(400, "'visible' boolean olmalı.", 'VALIDATION');
      }
      const own = await getBookingByIdForUser(req.auth!.subjectId, id);
      if (!own) throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
      await dbRun(`UPDATE bookings SET showcase_visible = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`, [visible ? 1 : 0, id, req.auth!.subjectId]);
      // Galeri içeriği değişti (proje eklendi/çıkarıldı) → showcase feed cache'ini tazele.
      void import('../../services/showcase-feed.service')
        .then((m) => m.invalidateShowcaseFeed())
        .catch((err) => logger.warn('showcase_feed_invalidate_failed', { err: (err as Error).message }));
      const updated = await getBookingByIdForUser(req.auth!.subjectId, id);
      res.json({ booking: updated });
    } catch (err) {
      next(err);
    }
  }
);

/** Kullanıcı: aşamayı KENDİSİ ilerletir (canlıya kadar — canlı geçişi onaylıdır). */
router.post(
  '/bookings/:id/advance-stage',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const booking = await selfAdvanceBookingStage(req.auth!.subjectId, id);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Kullanıcı: CANLIYA geçiş için onay talebi oluştur (admin'den onay bekler). */
router.post(
  '/bookings/:id/request-advance',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const { note } = stageAdvanceRequestSchema.parse(req.body ?? {});
      const booking = await requestStageAdvance(req.auth!.subjectId, id, note);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Bir booking'in randevuları (sahibi görür). */
router.get(
  '/bookings/:id/appointments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      // IDOR koruması: booking sahibi mi?
      const booking = await getBookingByIdForUser(req.auth!.subjectId, id);
      if (!booking) {
        throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
      }
      const appointments = await listBookingAppointments(id);
      res.json({ appointments });
    } catch (err) {
      next(err);
    }
  }
);

// Proje (booking) kartına görsel arkaplan ata / kaldır.
router.put('/bookings/:id/showcase-image', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'proje id');
    const input = setShowcaseImageSchema.parse(req.body);
    const result = await setBookingShowcaseImage(req.auth!.subjectId, id, input.visualId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
