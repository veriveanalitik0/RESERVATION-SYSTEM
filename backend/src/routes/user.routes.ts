/**
 * User-facing routes: odalar + booking.
 * Path: /api/user/*
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireUser } from '../middleware/auth.middleware';
import { expensiveActionRateLimit } from '../middleware/security.middleware';
import { logger } from '../utils/logger';
import {
  createAppointmentSchema,
  bookingProgressSchema,
  createBookingSchema,
  createHardwareRequestSchema,
  createLicenseRequestSchema,
  createSupportRequestSchema,
  createVisualSchema,
  setShowcaseImageSchema,
  collaborationSchema,
  joinWaitlistSchema,
  profileUpdateSchema,
  similarSearchSchema,
  stageAdvanceRequestSchema,
  borrowBookSchema,
  requestExtensionSchema,
} from '../validators/schemas';
import { listRooms, getRoomAvailability } from '../services/room.service';
import {
  createBooking,
  deleteBooking,
  getBookingByIdForUser,
  listUserBookings,
  requestStageAdvance,
  selfAdvanceBookingStage,
  updateBooking,
} from '../services/booking.service';
import {
  cancelAppointment,
  createAppointment,
  getRoomAppointmentHeatmap,
  listBookingAppointments,
  listUserAppointments,
} from '../services/appointment.service';
import { getUserProfile, updateUserProfile } from '../services/user.service';
import {
  cancelWaitlist,
  removeWaitlistEntry,
  joinWaitlist,
  listUserWaitlist,
} from '../services/waitlist.service';
import {
  bookingTextForEmbedding,
  detectDuplicate,
  findSimilarBookings,
} from '../services/embedding.service';
import { getLeaderboard } from '../services/leaderboard.service';
import { exportUserData, purgeUser } from '../services/privacy.service';
import { getUserLicenseUsage } from '../services/license.service';
import {
  listAvailableBooks,
  borrowBook,
  listMyLoans,
  returnBook,
  requestExtension,
  cancelPendingLoan,
} from '../services/book.service';
import {
  createHardwareRequest,
  listUserHardwareRequests,
  updateHardwareRequest,
} from '../services/hardware-request.service';
import { createSupportRequest } from '../services/support-request.service';
import {
  createVisual,
  listMyVisuals,
  regenerateVisual,
  setBookingShowcaseImage,
  setProfileBackgroundImage,
  setChatBackgroundImage,
  deleteVisual,
} from '../services/visual.service';
import {
  clearUserProfilePhoto,
  setUserProfilePhoto,
} from '../services/profile-photo.service';
import {
  getLikeStatus,
  getShowcaseEngagement,
  listComments,
  postComment,
  toggleLike,
  deleteComment,
} from '../services/showcase.service';
import { recordAudit } from '../services/audit.service';
import { csrfProtection } from '../middleware/cookie-auth';
import { HttpError } from '../middleware/error.middleware';
import { readId } from '../utils/route-helpers';
import { dbOne, dbRun } from '../db/schema';

const router = Router();

router.use(requireUser);

// CSRF — tüm state-changing endpoint'leri (POST/PUT/DELETE/PATCH) korur.
// GET/HEAD/OPTIONS csrf-csrf'in `ignoredMethods` config'i ile muaf.
// Frontend api.ts mutation isteklerinde X-CSRF-Token header'ını otomatik
// gönderir; CSRF rotasyonunda 403 alırsa fresh token ile retry yapar.
router.use(csrfProtection);

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

router.get('/rooms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Opsiyonel tarih ARALIĞI filtresi: ?from=YYYY-MM-DD&to=YYYY-MM-DD → uygunluk
    // o aralığın tamamına göre. Geriye uyum: ?date= tek-gün (from=to=date).
    const q = req.query;
    const from = typeof q.from === 'string' ? q.from : (typeof q.date === 'string' ? q.date : undefined);
    const to = typeof q.to === 'string' ? q.to : undefined;
    res.json({ rooms: await listRooms(from, to) });
  } catch (err) {
    next(err);
  }
});

// Oda müsaitlik detayı (boş günler + dolu tarih aralıkları + dolu saatler).
// Kart açılınca "müsait vakitler" göstergesi için. PII döndürmez.
router.get('/rooms/:id/availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const avail = await getRoomAvailability(String(req.params.id ?? ''), { from, to });
    if (!avail) {
      res.status(404).json({ error: 'Oda bulunamadı.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    res.json(avail);
  } catch (err) {
    next(err);
  }
});

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
    const { updateBookingProgress } = await import('../services/booking.service');
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
    const { cancelApprovedBooking } = await import('../services/booking.service');
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
    void import('../services/waitlist.service')
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

/* ============ SEMANTIC SEARCH (Proje benzerlik) ============ */

router.post('/similar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = similarSearchSchema.parse(req.body);

    let queryText = '';
    let excludeBookingId: string | undefined;

    if (input.bookingId) {
      // Var olan bir booking'in benzerlerini bul — IDOR koruması:
      // user yalnızca kendi booking'ini referans alabilir
      const own = await getBookingByIdForUser(req.auth!.subjectId, input.bookingId);
      if (!own) {
        throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
      }
      queryText = bookingTextForEmbedding({
        projectName: own.projectName,
        projectDescription: own.projectDescription,
        technologies: own.technologies,
      });
      excludeBookingId = own.id;
    } else {
      queryText = bookingTextForEmbedding({
        projectName: input.projectName ?? '',
        projectDescription: input.projectDescription ?? '',
        technologies: input.technologies ?? [],
      });
    }

    // PRIVACY: user-tarafı yalnız opt-in showcase görür + kendi geçmişi
    const results = await findSimilarBookings({
      queryText,
      limit: input.limit ?? 5,
      excludeBookingId,
      minSimilarity: input.minSimilarity ?? 0.3,
      visibility: 'showcase',
      includeOwner: req.auth!.subjectId,
    });

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

/**
 * İŞ BİRLİĞİ ÖNERİSİ (#4) — kullanıcının kendi booking'ine benzer, BAŞKA
 * kullanıcıların PUBLIC (opt-in showcase) projelerini yazarıyla birlikte döner.
 * Amaç: benzer iş yapan ekiplerle bağlantı kurma (authorId → /u/:id, sohbet).
 * IDOR: yalnız kendi booking'i referans alınabilir. Privacy: yalnız showcase.
 */
router.post('/collaborations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = collaborationSchema.parse(req.body);
    const own = await getBookingByIdForUser(req.auth!.subjectId, input.bookingId);
    if (!own) {
      throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
    }
    const queryText = bookingTextForEmbedding({
      projectName: own.projectName,
      projectDescription: own.projectDescription,
      technologies: own.technologies,
    });
    const results = await findSimilarBookings({
      queryText,
      excludeBookingId: own.id,
      excludeUserId: req.auth!.subjectId, // iş birliği = BAŞKA ekiplerle
      limit: input.limit ?? 6,
      minSimilarity: input.minSimilarity ?? 0.3,
      visibility: 'collaboration', // yalnız public showcase, yazar ifşalı
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

/* ============ LEADERBOARD / SIRALAMA (#5a) ============ */

router.get('/leaderboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLeaderboard());
  } catch (err) {
    next(err);
  }
});

/* ===== ODA × GÜN APPOINTMENT (SAATLİ) ISI-HARİTASI (#5) ===== */

router.get('/rooms/appointment-heatmap', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    res.json(await getRoomAppointmentHeatmap({ from, to }));
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
      void import('../services/showcase-feed.service')
        .then((m) => m.invalidateShowcaseFeed())
        .catch((err) => logger.warn('showcase_feed_invalidate_failed', { err: (err as Error).message }));
      const updated = await getBookingByIdForUser(req.auth!.subjectId, id);
      res.json({ booking: updated });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * LİSANSLAR — kullanıcı katalog & talep
 * ============================================================ */

router.get(
  '/licenses/catalog',
  requireUser,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { getLicenseCatalog } = await import('../services/license-request.service');
      res.json({ items: getLicenseCatalog() });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/licenses/requests',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { listUserLicenseRequests } = await import('../services/license-request.service');
      const items = await listUserLicenseRequests(req.auth!.subjectId);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/licenses/requests',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createLicenseRequestSchema.parse(req.body);
      const { createLicenseRequest } = await import('../services/license-request.service');
      const created = await createLicenseRequest(req.auth!.subjectId, input);

      recordAudit({
        eventType: 'license_request.created',
        subjectId: req.auth!.subjectId,
        subjectType: 'user',
        ipAddress: req.ip,
        success: true,
        details: {
          requestId: created.id,
          requestTitle: created.requestTitle,
          itemCount: created.items.length,
          durationMonths: created.durationMonths,
        },
      });

      // Admin'lere yeni başvuru in-app bildirimi — otomatik reddedilen başvurular hariç.
      if (created.status !== 'rejected') {
        void (async () => {
          try {
            const { notifyAdminsLicenseRequested } = await import(
              '../services/license-request.service'
            );
            await notifyAdminsLicenseRequested(created);
          } catch {
            /* bildirim best-effort — talep yine de oluşturuldu */
          }
        })();
      }

      res.status(201).json({ request: created });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/licenses/requests/:id',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const input = createLicenseRequestSchema.parse(req.body);
      const { updateLicenseRequest } = await import('../services/license-request.service');
      const updated = await updateLicenseRequest(req.auth!.subjectId, id, input);

      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'user',
        ipAddress: req.ip,
        success: true,
        details: { requestId: updated.id, status: updated.status },
      });

      res.json({ request: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Başvuru/proje detayı — yönetişim demeti dahil (kalite kapıları,
 * insan onayları, yaşam döngüsü zaman çizelgesi). IDOR: sadece kendi.
 */
router.get(
  '/licenses/requests/:id',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const { getUserLicenseRequestById } = await import(
        '../services/license-request.service'
      );
      const request = await getUserLicenseRequestById(req.auth!.subjectId, id);
      if (!request) {
        throw new HttpError(404, 'Talep bulunamadı.', 'LICENSE_REQUEST_NOT_FOUND');
      }
      const { listGatesForRequest } = await import('../services/quality-gate.service');
      const { listApprovalsForRequest } = await import('../services/human-approval.service');
      const { listStageEvents } = await import('../services/governance.service');
      res.json({
        request,
        gates: await listGatesForRequest(id),
        approvals: await listApprovalsForRequest(id),
        stageEvents: await listStageEvents(id),
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ============ BİLDİRİM MERKEZİ ============ */

router.get(
  '/notifications',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { listNotifications, countUnreadNotifications } = await import(
        '../services/notification-center.service'
      );
      const uid = req.auth!.subjectId;
      res.json({
        items: await listNotifications(uid, 'user'),
        unread: await countUnreadNotifications(uid, 'user'),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/notifications/:id/read',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'bildirim id');
      const { markNotificationRead } = await import(
        '../services/notification-center.service'
      );
      await markNotificationRead(req.auth!.subjectId, 'user', id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/notifications/read-all',
  requireUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { markAllNotificationsRead } = await import(
        '../services/notification-center.service'
      );
      const changed = await markAllNotificationsRead(req.auth!.subjectId, 'user');
      res.json({ marked: changed });
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

/* ============ APPOINTMENTS — günlük randevular ============ */

/** Kullanıcının kendi randevuları (varsayılan: scheduled, opsiyonel tarih aralığı). */
router.get('/appointments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fromRaw = req.query.from;
    const toRaw = req.query.to;
    const includeCancelled = req.query.includeCancelled === 'true';
    const from = typeof fromRaw === 'string' ? fromRaw : undefined;
    const to = typeof toRaw === 'string' ? toRaw : undefined;
    const appointments = await listUserAppointments(req.auth!.subjectId, {
      from,
      to,
      includeCancelled,
    });
    res.json({ appointments });
  } catch (err) {
    next(err);
  }
});

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

/** Yeni randevu oluştur. */
router.post('/appointments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createAppointmentSchema.parse(req.body);
    const appointment = await createAppointment(req.auth!.subjectId, input);
    res.status(201).json({ appointment });
  } catch (err) {
    next(err);
  }
});

/** Randevu iptal et (kendi randevusu olmalı). */
router.delete(
  '/appointments/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'randevu id');
      const result = await cancelAppointment(req.auth!.subjectId, id, {
        ownerCheck: true,
        callerType: 'user',
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * DONANIM TALEPLERİ — kullanıcı
 * ============================================================ */

router.get('/hardware/requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ items: await listUserHardwareRequests(req.auth!.subjectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/hardware/requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createHardwareRequestSchema.parse(req.body);
    const request = await createHardwareRequest(req.auth!.subjectId, input);

    recordAudit({
      eventType: 'hardware_request.created',
      subjectId: req.auth!.subjectId,
      subjectType: 'user',
      ipAddress: req.ip,
      success: true,
      details: {
        requestId: request.id,
        equipmentType: request.equipmentType,
        quantity: request.quantity,
      },
    });

    res.status(201).json({ request });
  } catch (err) {
    next(err);
  }
});

router.put('/hardware/requests/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'talep id');
    const input = createHardwareRequestSchema.parse(req.body);
    const request = await updateHardwareRequest(req.auth!.subjectId, id, input);
    res.json({ request });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
 * DESTEK TALEBİ — kullanıcı
 * ============================================================ */

router.post('/support/requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createSupportRequestSchema.parse(req.body);
    const request = await createSupportRequest(req.auth!.subjectId, input.description);

    recordAudit({
      eventType: 'support_request.created',
      subjectId: req.auth!.subjectId,
      subjectType: 'user',
      ipAddress: req.ip,
      success: true,
      details: { requestId: request.id },
    });

    res.status(201).json({ request });
  } catch (err) {
    next(err);
  }
});

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

/* ============ KÜTÜPHANE (kitap ödünç alma/iade) ============ */

// Ödünç alınabilir (aktif) kitaplar + bu kullanıcının halen ödüncte tuttukları (borrowedByMe).
router.get('/books', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ books: await listAvailableBooks(req.auth!.subjectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/books/:id/borrow', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'kitap id');
    const input = borrowBookSchema.parse(req.body ?? {});
    const loan = await borrowBook(req.auth!.subjectId, id, input.periodDays);
    res.status(201).json({ loan });
  } catch (err) {
    next(err);
  }
});

// Kullanıcının ödünç geçmişi (aktif/gecikmiş + iade edilmiş).
router.get('/loans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ loans: await listMyLoans(req.auth!.subjectId) });
  } catch (err) {
    next(err);
  }
});

router.post('/loans/:id/return', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    const loan = await returnBook(req.auth!.subjectId, id);
    res.json({ loan });
  } catch (err) {
    next(err);
  }
});

// Süre uzatma talebi (admin onayına gider).
router.post('/loans/:id/extend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    const input = requestExtensionSchema.parse(req.body);
    const loan = await requestExtension(req.auth!.subjectId, id, input.days);
    res.json({ loan });
  } catch (err) {
    next(err);
  }
});

// Bekleyen ödünç talebini iptal et — rezerve edilen kopya geri yüklenir (son-kopya
// süresiz kilidi çözülür). Yalnız status='pending' ve sahibi olan kullanıcı.
router.post('/loans/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    const loan = await cancelPendingLoan(req.auth!.subjectId, id);
    res.json({ loan });
  } catch (err) {
    next(err);
  }
});

export default router;
