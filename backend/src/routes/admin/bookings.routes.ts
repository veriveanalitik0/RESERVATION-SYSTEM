/**
 * Admin booking rotaları: odalar/doluluk, booking onay/red/feedback, yaşam
 * döngüsü, randevular, bekleme listesi ve showcase etiketleme.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { logger } from '../../utils/logger';
import {
  reassignRoomSchema,
  reassignUserSchema,
  rejectStageAdvanceSchema,
  reviewBookingSchema,
  setReviewTrackSchema,
  waitlistMoveSchema,
} from '../../validators/schemas';
import {
  getBookingByIdAdmin,
  listAllBookings,
  reassignBookingRoom,
  reassignBookingUser,
  adminDeleteBooking,
  reviewBooking,
  advanceBookingLifecycle,
  regressBookingLifecycle,
  setBookingReviewTrack,
  rejectStageAdvanceRequest,
} from '../../services/booking.service';
import {
  cancelAppointment as adminCancelAppointment,
  listAllAppointments,
  listBookingAppointments,
} from '../../services/appointment.service';
import { listRooms, getRoomsWithOccupancy } from '../../services/room.service';
import { listAllWaitlist, moveWaitlistEntry } from '../../services/waitlist.service';
import { recordAudit } from '../../services/audit.service';
import { HttpError } from '../../middleware/error.middleware';
import { readId } from '../../utils/route-helpers';
import { dbRun } from '../../db/schema';
import { readPage } from './shared';

const router = Router();

router.get('/rooms', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ rooms: await listRooms() });
  } catch (err) {
    next(err);
  }
});

router.get('/bookings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const allowed = ['pending', 'approved', 'rejected', 'feedback_requested'];
    const filter = status && allowed.includes(status)
      ? (status as 'pending' | 'approved' | 'rejected' | 'feedback_requested')
      : undefined;
    res.json({ bookings: await listAllBookings({ status: filter, ...readPage(req) }) });
  } catch (err) {
    next(err);
  }
});

router.get('/bookings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const booking = await getBookingByIdAdmin(id);
    if (!booking) throw new HttpError(404, 'Booking bulunamadı.', 'NOT_FOUND');
    // Yaşam döngüsü zaman çizelgesi — modal "Geçmiş" tab'ında gösterilir.
    const { listStageEvents } = await import('../../services/governance.service');
    res.json({ booking, stageEvents: await listStageEvents(id) });
  } catch (err) {
    next(err);
  }
});

router.post('/bookings/:id/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const input = reviewBookingSchema.parse(req.body);
    const result = await reviewBooking(req.auth!.subjectId, id, input);
    // Onay/red galeri içeriğini/sırasını değiştirebilir → showcase feed cache'ini tazele.
    void import('../../services/showcase-feed.service')
      .then((m) => m.invalidateShowcaseFeed())
      .catch((err) => logger.warn('showcase_feed_invalidate_failed', { err: (err as Error).message }));

    recordAudit({
      eventType: 'booking.reviewed',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: {
        bookingId: result.booking.id,
        action: input.action,
        newStatus: result.booking.status,
        autoWaitlisted: result.autoWaitlisted ?? false,
      },
    });

    res.json({
      booking: result.booking,
      autoWaitlisted: result.autoWaitlisted ?? false,
      waitlistPosition: result.waitlistPosition,
      approvalState: result.approvalState,
    });
  } catch (err) {
    next(err);
  }
});

/** Admin: onaylı rezervasyonu iptal et (kullanıcı adına). */
router.post('/bookings/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const { cancelApprovedBooking } = await import('../../services/booking.service');
    const booking = await cancelApprovedBooking(id, { id: req.auth!.subjectId, type: 'admin' });
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

/* ============ ODALAR — doluluk + atama ============ */

/** Admin "Odalar" görünümü — her oda + içindeki kullanıcılar. */
router.get('/rooms/occupancy', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ rooms: await getRoomsWithOccupancy() });
  } catch (err) {
    next(err);
  }
});

/** Admin: bir booking'i başka odaya taşır. */
router.post('/bookings/:id/reassign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const { roomId } = reassignRoomSchema.parse(req.body);
    const booking = await reassignBookingRoom(req.auth!.subjectId, id, roomId);
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

/** Admin: bir booking'in kullanıcısını değiştirir (oda kullanıcısını "değiştir"). */
router.post(
  '/bookings/:id/reassign-user',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const { userId } = reassignUserSchema.parse(req.body);
      const booking = await reassignBookingUser(req.auth!.subjectId, id, userId);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Admin: bir booking'i tamamen siler (oda kullanıcısını "çıkar"). */
router.delete('/bookings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'booking id');
    const result = await adminDeleteBooking(req.auth!.subjectId, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Admin: bir booking'i yaşam döngüsünde bir sonraki aşamaya ilerlet. */
router.post(
  '/bookings/:id/advance-stage',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const booking = await advanceBookingLifecycle(req.auth!.subjectId, id);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Admin: bir booking'i yaşam döngüsünde bir önceki aşamaya geri al. */
router.post(
  '/bookings/:id/regress-stage',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const booking = await regressBookingLifecycle(req.auth!.subjectId, id);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Admin: SWAT (fast-track) inceleme akışına al/çıkar. */
router.post(
  '/bookings/:id/review-track',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const { track } = setReviewTrackSchema.parse(req.body);
      const booking = await setBookingReviewTrack(req.auth!.subjectId, id, track);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/** Admin: kullanıcının aşama ilerletme talebini reddet (ilerletmeden iptal). */
router.delete(
  '/bookings/:id/advance-request',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      // Body opsiyonel — DELETE üzerinde JSON body olabilir/olmayabilir.
      const note = rejectStageAdvanceSchema.parse(req.body ?? {}).note;
      const booking = await rejectStageAdvanceRequest(req.auth!.subjectId, id, note);
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

/* ============ APPOINTMENTS (admin) ============ */

/** Admin: tüm randevuları listele (yönetim takvimi). */
router.get('/appointments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fromRaw = req.query.from;
    const toRaw = req.query.to;
    const includeCancelled = req.query.includeCancelled === 'true';
    const appointments = await listAllAppointments({
      from: typeof fromRaw === 'string' ? fromRaw : undefined,
      to: typeof toRaw === 'string' ? toRaw : undefined,
      includeCancelled,
      ...readPage(req),
    });
    res.json({ appointments });
  } catch (err) {
    next(err);
  }
});

/** Admin: bir booking'in randevuları. */
router.get(
  '/bookings/:id/appointments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const appointments = await listBookingAppointments(id, { includeCancelled: true });
      res.json({ appointments });
    } catch (err) {
      next(err);
    }
  }
);

/** Admin: bir randevuyu iptal et. */
router.delete(
  '/appointments/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'randevu id');
      const result = await adminCancelAppointment(req.auth!.subjectId, id, {
        ownerCheck: false,
        callerType: 'admin',
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/** Admin: waitlist sırası değiştirme (öncelik verme). */
router.post('/waitlist/:id/move', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'waitlist id');
    const { move } = waitlistMoveSchema.parse(req.body);
    await moveWaitlistEntry(id, move);
    res.json({ entries: await listAllWaitlist() });
  } catch (err) {
    next(err);
  }
});

/* ============ WAITLIST (admin görünüm) ============ */

router.get('/waitlist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ entries: await listAllWaitlist(readPage(req)) });
  } catch (err) {
    next(err);
  }
});

/* ============ SHOWCASE (admin etiketleme — highlight) ============ */

router.put(
  '/bookings/:id/showcase',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'booking id');
      const visible = typeof req.body?.visible === 'boolean' ? req.body.visible : undefined;
      const highlight =
        typeof req.body?.highlight === 'boolean' ? req.body.highlight : undefined;
      if (visible === undefined && highlight === undefined) {
        throw new HttpError(
          400,
          "'visible' veya 'highlight' alanlarından en az biri gönderilmeli.",
          'VALIDATION'
        );
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      if (visible !== undefined) {
        sets.push('showcase_visible = ?');
        params.push(visible ? 1 : 0);
      }
      if (highlight !== undefined) {
        sets.push('showcase_highlight = ?');
        params.push(highlight ? 1 : 0);
      }
      sets.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id);
      await dbRun(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`, [...params]);
      // Galeri görünürlüğü/highlight değişti → showcase feed cache'ini tazele.
      void import('../../services/showcase-feed.service')
        .then((m) => m.invalidateShowcaseFeed())
        .catch((err) => logger.warn('showcase_feed_invalidate_failed', { err: (err as Error).message }));
      const updated = await getBookingByIdAdmin(id);
      res.json({ booking: updated });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
