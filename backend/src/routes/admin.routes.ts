/**
 * Admin routes: tüm booking'leri görme + onay/red/feedback.
 * Path: /api/admin/*
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  requireAdmin,
  requireAdminRole,
  requireGovernanceRole,
  requireStaff,
} from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import {
  adminLicenseRequestsFilterSchema,
  adminResetUserPasswordSchema,
  adminUserSearchSchema,
  adminUserUpdateSchema,
  advanceLifecycleSchema,
  assignEngineerSchema,
  changeAdminPasswordSchema,
  decideApprovalSchema,
  gateResultSchema,
  hardwareRequestsFilterSchema,
  mfaVerifySchema,
  reassignRoomSchema,
  reassignUserSchema,
  rejectStageAdvanceSchema,
  reviewBookingSchema,
  reviewHardwareRequestSchema,
  reviewLicenseRequestSchema,
  setReviewTrackSchema,
  similarSearchSchema,
  supportRequestsFilterSchema,
  waitlistMoveSchema,
  createBookSchema,
  updateBookSchema,
} from '../validators/schemas';
import {
  listAllBooks,
  getBookByIdAdmin,
  createBook,
  updateBook,
  deleteBook,
  listAllLoans,
  approveLoan,
  rejectLoan,
  approveExtension,
  rejectExtension,
} from '../services/book.service';
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
} from '../services/booking.service';
import {
  cancelAppointment as adminCancelAppointment,
  listAllAppointments,
  listBookingAppointments,
} from '../services/appointment.service';
import { listRooms, getRoomsWithOccupancy } from '../services/room.service';
import {
  adminDeleteUser,
  adminResetUserPassword,
  adminRestoreUser,
  adminUpdateUser,
  getUserByIdAdmin,
  listAllUsers,
  listDepartments,
} from '../services/user.service';
import { changeAdminPassword } from '../services/auth.service';
import { listAllWaitlist, moveWaitlistEntry } from '../services/waitlist.service';
import { getAnalytics } from '../services/analytics.service';
import {
  backfillEmbeddings,
  bookingTextForEmbedding,
  currentModelId,
  findSimilarBookings,
  isMLAvailable,
} from '../services/embedding.service';
import {
  disableMfa,
  enrollMfa,
  getMfaStatus,
  verifyMfaCode,
} from '../services/mfa.service';
import { recordAudit } from '../services/audit.service';
import {
  distinctEventTypes,
  exportAuditCsv,
  listAuditLog,
} from '../services/audit-viewer.service';
import { getLicenseReport, LICENSE_CATALOG } from '../services/license.service';
import {
  listAdminHardwareRequests,
  reviewHardwareRequest,
} from '../services/hardware-request.service';
import {
  listAdminSupportRequests,
  resolveSupportRequest,
} from '../services/support-request.service';
import { listBackups, runBackupOnce } from '../services/backup.service';
import { csrfProtection } from '../middleware/cookie-auth';
import { HttpError } from '../middleware/error.middleware';
import { readId } from '../utils/route-helpers';
import { dbAll, dbRun } from '../db/schema';

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

/**
 * Hassas GET'ler için ek katman: blanket requireStaff governance rollerini
 * (danışman/arge) içeri alır; güvenlik audit logları, KVKK veri ihracı ve
 * yedek listesi gibi uçlar EN AZ YETKİ gereği yalnız admin'e açık kalmalı.
 */
function requireAdminSubject(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.subjectType !== 'admin') {
    recordAudit({
      eventType: 'authz.denied',
      subjectId: req.auth?.subjectId,
      subjectType: req.auth?.subjectType,
      ipAddress: req.ip,
      success: false,
      details: { path: req.path, reason: 'admin_only_resource' },
    });
    next(new HttpError(403, 'Bu kaynağa yalnız admin erişebilir.', 'FORBIDDEN'));
    return;
  }
  next();
}

/** ?limit & ?offset parse — route katmanında clamp + servislerde de sınır. */
function readPage(req: Request): { limit?: number; offset?: number } {
  const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
  const rawOffset = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : undefined;
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit as number, 1), 200) : undefined,
    offset: Number.isFinite(rawOffset) ? Math.max(rawOffset as number, 0) : undefined,
  };
}

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
    const { listStageEvents } = await import('../services/governance.service');
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
    void import('../services/showcase-feed.service')
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
    const { cancelApprovedBooking } = await import('../services/booking.service');
    const booking = await cancelApprovedBooking(id, { id: req.auth!.subjectId, type: 'admin' });
    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

/* ============ KULLANICI YÖNETİMİ ============ */

// Kullanıcı listesi/detayı tüm kullanıcıların e-posta/departman/hesap-durumu
// (PII) içerir — salt-okunur izleyici/danışman/arge bu veriye ihtiyaç duymaz.
// EN AZ YETKİ gereği yalnız admin'e açık (app_security §1 — A01).
router.get('/users', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = adminUserSearchSchema.safeParse(req.query);
    const filters = parsed.success ? parsed.data : {};
    res.json({ users: await listAllUsers(filters) });
  } catch (err) {
    next(err);
  }
});

router.get('/users/meta/departments', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ departments: await listDepartments() });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    res.json({ user: await getUserByIdAdmin(id) });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    const input = adminUserUpdateSchema.parse(req.body);
    const user = await adminUpdateUser(id, input);

    recordAudit({
      eventType: 'user.update',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { targetUserId: id, fields: Object.keys(input) },
    });

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    await adminDeleteUser(id);

    recordAudit({
      eventType: 'user.delete',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { targetUserId: id },
    });

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * KVKK — Admin tarafından user verisi ihracı.
 * Kullanım: kullanıcı manuel başvuru yapmış, admin onun adına çekiyor.
 */
router.get(
  '/users/:id/export',
  requireAdminSubject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'id');
      const { exportUserData } = await import('../services/privacy.service');
      const data = await exportUserData(id);
      recordAudit({
        eventType: 'user.update',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { action: 'admin_data_export', targetUserId: id },
      });
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="klab-veri-${id}.json"`
      );
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(JSON.stringify(data, null, 2));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * KVKK — Admin tarafından user verisi tamamen silme.
 * Body: { confirmation: 'KALICI SİL' }
 */
router.post(
  '/users/:id/purge',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'id');
      const confirmation = req.body?.confirmation;
      if (confirmation !== 'KALICI SİL') {
        throw new HttpError(
          400,
          "Onay metni eksik. Lütfen 'KALICI SİL' yazın.",
          'VALIDATION'
        );
      }
      const { purgeUser } = await import('../services/privacy.service');
      const result = await purgeUser(id, { id: req.auth!.subjectId, type: 'admin' });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/users/:id/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'id');
    const user = await adminRestoreUser(id);

    recordAudit({
      eventType: 'user.restore',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { targetUserId: id },
    });

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Tek GROUP BY — önceden tüm bookings tablosu (JOIN'li) çekilip JS'te sayılıyordu.
    const rows = await dbAll(
      `SELECT status, COUNT(*) AS c FROM bookings GROUP BY status`,
      []
    ) as Array<{ status: string; c: number }>;
    const byStatus = new Map(rows.map((r) => [r.status, Number(r.c)]));
    const stats = {
      total: rows.reduce((sum, r) => sum + Number(r.c), 0),
      pending: byStatus.get('pending') ?? 0,
      approved: byStatus.get('approved') ?? 0,
      rejected: byStatus.get('rejected') ?? 0,
      feedback_requested: byStatus.get('feedback_requested') ?? 0,
    };
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

/** Admin: bir kullanıcının parolasını sıfırlar. */
router.post(
  '/users/:id/reset-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'id');
      const { password } = adminResetUserPasswordSchema.parse(req.body);
      await adminResetUserPassword(id, password);
      recordAudit({
        eventType: 'admin.password_reset',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { targetUserId: id },
      });
      res.json({ message: 'Kullanıcının parolası sıfırlandı.' });
    } catch (err) {
      next(err);
    }
  }
);

/** Admin kendi parolasını değiştirir. */
router.post(
  '/auth/change-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = changeAdminPasswordSchema.parse(req.body);
      await changeAdminPassword(
        req.auth!.subjectId,
        input.currentPassword,
        input.newPassword
      );
      recordAudit({
        eventType: 'admin.password_changed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
      });
      res.json({ message: 'Parolan güncellendi.' });
    } catch (err) {
      next(err);
    }
  }
);

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

/* ============ AUDIT LOG VIEWER ============ */

router.get('/audit', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query;
    const filters: Parameters<typeof listAuditLog>[0] = {
      eventType: typeof q.eventType === 'string' ? q.eventType : undefined,
      subjectType:
        q.subjectType === 'user' || q.subjectType === 'admin' || q.subjectType === 'anonymous'
          ? (q.subjectType as 'user' | 'admin' | 'anonymous')
          : undefined,
      subjectId: typeof q.subjectId === 'string' ? q.subjectId : undefined,
      success: q.success === 'true' ? true : q.success === 'false' ? false : undefined,
      ipAddress: typeof q.ipAddress === 'string' ? q.ipAddress : undefined,
      since: typeof q.since === 'string' ? q.since : undefined,
      until: typeof q.until === 'string' ? q.until : undefined,
      q: typeof q.q === 'string' ? q.q : undefined,
      limit: typeof q.limit === 'string' ? Math.min(parseInt(q.limit, 10) || 50, 500) : undefined,
      offset: typeof q.offset === 'string' ? Math.max(parseInt(q.offset, 10) || 0, 0) : undefined,
    };
    res.json(await listAuditLog(filters));
  } catch (err) {
    next(err);
  }
});

router.get('/audit/event-types', requireAdminSubject, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ eventTypes: await distinctEventTypes() });
  } catch (err) {
    next(err);
  }
});

router.get('/audit/export', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query;
    const csv = await exportAuditCsv({
      eventType: typeof q.eventType === 'string' ? q.eventType : undefined,
      subjectType:
        q.subjectType === 'user' || q.subjectType === 'admin' || q.subjectType === 'anonymous'
          ? (q.subjectType as 'user' | 'admin' | 'anonymous')
          : undefined,
      since: typeof q.since === 'string' ? q.since : undefined,
      until: typeof q.until === 'string' ? q.until : undefined,
    });
    recordAudit({
      eventType: 'user.update',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { action: 'audit_csv_export' },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="klab-audit-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

/* ============ DB BACKUP ============ */

router.get('/backup', requireAdminSubject, (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ backups: listBackups() });
  } catch (err) {
    next(err);
  }
});

router.post('/backup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runBackupOnce();
    recordAudit({
      eventType: 'user.update',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
      details: { action: 'manual_backup', sizeBytes: result.sizeBytes },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ============ LİSANSLAR ============ */

router.get('/licenses', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getLicenseReport());
  } catch (err) {
    next(err);
  }
});

router.get('/licenses/catalog', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // UI tarafında "tanınan teknolojiler" gösterimi için
    const list = Object.entries(LICENSE_CATALOG).map(([key, info]) => ({
      key,
      ...info,
    }));
    res.json({ catalog: list });
  } catch (err) {
    next(err);
  }
});

/* ============ ANALYTICS ============ */

// requireAdminSubject: analytics yanıtı topUsers[].email (PII) içerir → salt-okunur
// governance rolleri (izleyici/danışman/arge) görmemeli; /users ile aynı kısıt (A01).
router.get('/analytics', requireAdminSubject, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getAnalytics());
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

/* ============ SEMANTIC SEARCH (admin tarafından bütün booking'lerde) ============ */

router.get('/embedding/status', (_req: Request, res: Response) => {
  res.json({ mlAvailable: isMLAvailable(), model: currentModelId() });
});

router.post('/embedding/backfill', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await backfillEmbeddings();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/similar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = similarSearchSchema.parse(req.body);
    let queryText = '';
    let excludeBookingId: string | undefined;

    if (input.bookingId) {
      const booking = await getBookingByIdAdmin(input.bookingId);
      if (!booking) throw new HttpError(404, 'Booking bulunamadı.', 'BOOKING_NOT_FOUND');
      queryText = bookingTextForEmbedding({
        projectName: booking.projectName,
        projectDescription: booking.projectDescription,
        technologies: booking.technologies,
      });
      excludeBookingId = booking.id;
    } else {
      queryText = bookingTextForEmbedding({
        projectName: input.projectName ?? '',
        projectDescription: input.projectDescription ?? '',
        technologies: input.technologies ?? [],
      });
    }

    // Admin: full visibility
    const results = await findSimilarBookings({
      queryText,
      limit: input.limit ?? 8,
      excludeBookingId,
      minSimilarity: input.minSimilarity ?? 0.25,
      visibility: 'admin',
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

/* ============ ADMIN MFA ============ */

router.get('/mfa/status', requireAdminSubject, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getMfaStatus(req.auth!.subjectId));
  } catch (err) {
    next(err);
  }
});

router.post('/mfa/enroll', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await enrollMfa(req.auth!.subjectId);
    recordAudit({
      eventType: 'auth.mfa.enroll',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
    });
    // QR + secret döner; verify sonrası enrollment tamamlanır
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/mfa/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = mfaVerifySchema.parse(req.body);
    const result = await verifyMfaCode(req.auth!.subjectId, input.code);
    recordAudit({
      eventType: result.valid ? 'auth.mfa.verify.success' : 'auth.mfa.verify.failure',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: result.valid,
      details: { usedBackupCode: result.usedBackupCode },
    });
    if (!result.valid) {
      throw new HttpError(401, 'MFA kodu geçersiz.', 'MFA_INVALID');
    }
    res.json({ verified: true, usedBackupCode: result.usedBackupCode });
  } catch (err) {
    next(err);
  }
});

router.post('/mfa/disable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = mfaVerifySchema.parse(req.body); // Disable için 1 doğru kod zorunlu
    const verify = await verifyMfaCode(req.auth!.subjectId, input.code);
    if (!verify.valid) {
      throw new HttpError(401, 'MFA kodu geçersiz.', 'MFA_INVALID');
    }
    await disableMfa(req.auth!.subjectId);
    recordAudit({
      eventType: 'auth.mfa.disabled',
      subjectId: req.auth!.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
    });
    res.json({ disabled: true });
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
      void import('../services/showcase-feed.service')
        .then((m) => m.invalidateShowcaseFeed())
        .catch((err) => logger.warn('showcase_feed_invalidate_failed', { err: (err as Error).message }));
      const updated = await getBookingByIdAdmin(id);
      res.json({ booking: updated });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * LİSANSLAR — admin talep review
 * ============================================================ */

router.get(
  // Salt-okunur LİSTE: admin + danışman + arge görebilir (global GET→requireStaff
  // politikası geçerli). Önceki fazladan `requireAdmin`, arge/danışman'ı reddedip
  // "kimlik doğrulama başarısız" veriyordu. Mutasyonlar hâlâ requireAdmin.
  '/licenses/requests',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = adminLicenseRequestsFilterSchema.parse(req.query);
      const { listAdminLicenseRequests } = await import('../services/license-request.service');
      const items = await listAdminLicenseRequests(status, readPage(req));
      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  // Salt-okunur bütçe raporu — staff (admin/danışman/arge) görebilir.
  '/licenses/budget',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { getLicenseBudgetReport } = await import('../services/license-request.service');
      res.json(await getLicenseBudgetReport());
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/licenses/requests/:id/review',
  requireAdmin,
  requireAdminRole('admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const input = reviewLicenseRequestSchema.parse(req.body);
      const { reviewLicenseRequest } = await import('../services/license-request.service');
      const updated = await reviewLicenseRequest(req.auth!.subjectId, id, input);
      recordAudit({
        eventType: 'license_request.reviewed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: updated.id, action: input.action, status: updated.status },
      });
      res.json({ request: updated });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * YÖNETİŞİM — yaşam döngüsü, kalite kapıları, onaylar
 * ============================================================ */

/** id parametresini doğrular. */
function readRequestId(req: Request): string {
  return readId(req, 'id', 'talep id');
}

/** Başvuru/proje detayı — yönetişim demeti dahil. */
router.get(
  '/licenses/requests/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const { getAdminLicenseRequestById } = await import(
        '../services/license-request.service'
      );
      const request = await getAdminLicenseRequestById(id);
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

/** Yönetişim dashboard metrikleri. */
router.get(
  '/licenses/governance/dashboard',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { getGovernanceDashboard } = await import('../services/governance.service');
      res.json(await getGovernanceDashboard());
    } catch (err) {
      next(err);
    }
  }
);

/** Lab Mühendisi atama için admin listesi. */
router.get(
  '/governance/admins',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await dbAll(`SELECT id, full_name, role, governance_role
           FROM admins WHERE status = 1 ORDER BY full_name`, []) as Array<{
        id: string;
        full_name: string;
        role: string;
        governance_role: string | null;
      }>;
      res.json({
        admins: rows.map((r) => ({
          id: r.id,
          fullName: r.full_name,
          role: r.role,
          governanceRole: r.governance_role,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Projeyi bir sonraki yaşam döngüsü aşamasına ilerlet. */
router.post(
  '/licenses/requests/:id/advance',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const input = advanceLifecycleSchema.parse(req.body);
      const { advanceLifecycle } = await import('../services/governance.service');
      const { getAdminLicenseRequestById } = await import(
        '../services/license-request.service'
      );
      const result = await advanceLifecycle(id, req.auth!.subjectId, input.note);
      const request = (await getAdminLicenseRequestById(id))!;

      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: id, action: 'advance', from: result.fromStage, to: result.toStage },
      });

      const { pushNotification } = await import('../services/notification-center.service');
      const { STAGE_LABEL } = await import('../services/governance-data');
      pushNotification({
        recipientId: request.userId,
        recipientType: 'user',
        category: 'license',
        title: `Projen ${STAGE_LABEL[result.toStage]} aşamasına geçti`,
        body: `"${request.requestTitle ?? request.licenseName}" — yaşam döngüsü ilerledi.`,
        link: '/licenses',
      });

      res.json({ request, transition: result });
    } catch (err) {
      next(err);
    }
  }
);

/** Lab Mühendisi ata. */
router.post(
  '/licenses/requests/:id/assign-engineer',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const input = assignEngineerSchema.parse(req.body);
      const { assignEngineer } = await import('../services/governance.service');
      const { getAdminLicenseRequestById } = await import(
        '../services/license-request.service'
      );
      await assignEngineer(id, input.engineerId);
      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: id, action: 'assign_engineer', engineerId: input.engineerId },
      });
      res.json({ request: await getAdminLicenseRequestById(id) });
    } catch (err) {
      next(err);
    }
  }
);

/** Proje türünü Kuruma Entegre'ye yükselt. */
router.post(
  '/licenses/requests/:id/upgrade-type',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const { upgradeProjectType } = await import('../services/governance.service');
      const { getAdminLicenseRequestById } = await import(
        '../services/license-request.service'
      );
      await upgradeProjectType(id, req.auth!.subjectId);
      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: id, action: 'upgrade_type' },
      });
      res.json({ request: await getAdminLicenseRequestById(id) });
    } catch (err) {
      next(err);
    }
  }
);

/** Kalite kapısı sonucunu kaydet/güncelle. */
router.put(
  '/licenses/requests/:id/gates',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const input = gateResultSchema.parse(req.body);
      const { setGateResult } = await import('../services/quality-gate.service');
      // Varlık kontrolü: yoksa öksüz quality_gates satırı + sahte 'updated' audit'i oluşuyordu.
      const { getAdminLicenseRequestById: getReq } = await import('../services/license-request.service');
      if (!(await getReq(id))) {
        throw new HttpError(404, 'Talep bulunamadı.', 'LICENSE_REQUEST_NOT_FOUND');
      }
      const gate = await setGateResult(id, input.gateKey, {
        status: input.status,
        score: input.score ?? null,
        detail: input.detail ?? null,
      });
      recordAudit({
        eventType: 'license_request.updated',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: id, action: 'gate_result', gate: input.gateKey, status: input.status },
      });
      res.json({ gate });
    } catch (err) {
      next(err);
    }
  }
);

/** Stage / Production insan onayı kararı — YZ/Ar-Ge Mühendisi yetkisi. */
router.post(
  '/licenses/requests/:id/approval',
  requireGovernanceRole('yz_arge'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readRequestId(req);
      const input = decideApprovalSchema.parse(req.body);
      const { decideApproval } = await import('../services/human-approval.service');
      const { getAdminLicenseRequestById } = await import(
        '../services/license-request.service'
      );
      const approval = await decideApproval(id, input.approvalType, req.auth!.subjectId, {
        decision: input.decision,
        releaseNote: input.releaseNote,
        riskAssessment: input.riskAssessment,
      });
      const request = (await getAdminLicenseRequestById(id))!;

      recordAudit({
        eventType: 'license_request.reviewed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: {
          requestId: id,
          action: 'approval',
          approvalType: input.approvalType,
          decision: input.decision,
        },
      });

      const { pushNotification } = await import('../services/notification-center.service');
      const typeLabel = input.approvalType === 'stage' ? 'Stage' : 'Production';
      pushNotification({
        recipientId: request.userId,
        recipientType: 'user',
        category: 'license',
        title: `${typeLabel} onayı ${input.decision === 'approved' ? 'verildi' : 'reddedildi'}`,
        body: `"${request.requestTitle ?? request.licenseName}" — ${typeLabel} insan onay noktası.`,
        link: '/licenses',
      });

      res.json({ request, approval });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * BİLDİRİM MERKEZİ — admin
 * ============================================================ */

router.get(
  '/notifications',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { listNotifications, countUnreadNotifications } = await import(
        '../services/notification-center.service'
      );
      const aid = req.auth!.subjectId;
      res.json({
        items: await listNotifications(aid, 'admin'),
        unread: await countUnreadNotifications(aid, 'admin'),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/notifications/:id/read',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'bildirim id');
      const { markNotificationRead } = await import(
        '../services/notification-center.service'
      );
      await markNotificationRead(req.auth!.subjectId, 'admin', id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/notifications/read-all',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { markAllNotificationsRead } = await import(
        '../services/notification-center.service'
      );
      const changed = await markAllNotificationsRead(req.auth!.subjectId, 'admin');
      res.json({ marked: changed });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * DONANIM TALEPLERİ — admin review
 * ============================================================ */

router.get(
  '/hardware/requests',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = hardwareRequestsFilterSchema.parse(req.query);
      res.json({ items: await listAdminHardwareRequests(status) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/hardware/requests/:id/review',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const input = reviewHardwareRequestSchema.parse(req.body);
      const request = await reviewHardwareRequest(req.auth!.subjectId, id, input);
      recordAudit({
        eventType: 'hardware_request.reviewed',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: request.id, action: input.action, status: request.status },
      });
      res.json({ request });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
 * DESTEK TALEPLERİ — admin
 * ============================================================ */

router.get(
  '/support/requests',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = supportRequestsFilterSchema.parse(req.query);
      res.json({ items: await listAdminSupportRequests(status) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/support/requests/:id/resolve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readId(req, 'id', 'talep id');
      const request = await resolveSupportRequest(req.auth!.subjectId, id);
      recordAudit({
        eventType: 'support_request.resolved',
        subjectId: req.auth!.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: true,
        details: { requestId: request.id },
      });
      res.json({ request });
    } catch (err) {
      next(err);
    }
  }
);

/* ============ KÜTÜPHANE (kitap envanteri + ödünçler) ============ */
// GET'ler requireStaff (izleyici/danışman/arge salt-okunur görebilir); mutasyonlar
// router-seviyesi requireAdmin guard'ı ile yalnız admin'e açıktır.

router.get('/books', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ books: await listAllBooks() });
  } catch (err) {
    next(err);
  }
});

router.get('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'kitap id');
    const book = await getBookByIdAdmin(id);
    if (!book) throw new HttpError(404, 'Kitap bulunamadı.', 'BOOK_NOT_FOUND');
    res.json({ book });
  } catch (err) {
    next(err);
  }
});

router.post('/books', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createBookSchema.parse(req.body);
    const book = await createBook(req.auth!.subjectId, input);
    res.status(201).json({ book });
  } catch (err) {
    next(err);
  }
});

router.put('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'kitap id');
    const input = updateBookSchema.parse(req.body);
    const book = await updateBook(req.auth!.subjectId, id, input);
    res.json({ book });
  } catch (err) {
    next(err);
  }
});

router.delete('/books/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'kitap id');
    await deleteBook(req.auth!.subjectId, id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// Tüm ödünç kayıtları (opsiyonel ?status=pending|active|returned|overdue|rejected).
router.get('/loans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const allowed = ['pending', 'active', 'returned', 'overdue', 'rejected'];
    const filter =
      status && allowed.includes(status)
        ? (status as 'pending' | 'active' | 'returned' | 'overdue' | 'rejected')
        : undefined;
    res.json({ loans: await listAllLoans({ status: filter }) });
  } catch (err) {
    next(err);
  }
});

// Bekleyen ödünç talebini onayla / reddet.
router.post('/loans/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    res.json({ loan: await approveLoan(req.auth!.subjectId, id) });
  } catch (err) {
    next(err);
  }
});

router.post('/loans/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    res.json({ loan: await rejectLoan(req.auth!.subjectId, id) });
  } catch (err) {
    next(err);
  }
});

// Bekleyen süre-uzatma talebini onayla / reddet.
router.post('/loans/:id/extend/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    res.json({ loan: await approveExtension(req.auth!.subjectId, id) });
  } catch (err) {
    next(err);
  }
});

router.post('/loans/:id/extend/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = readId(req, 'id', 'ödünç id');
    res.json({ loan: await rejectExtension(req.auth!.subjectId, id) });
  } catch (err) {
    next(err);
  }
});

export default router;
