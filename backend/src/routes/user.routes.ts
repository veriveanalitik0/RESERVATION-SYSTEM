/**
 * User-facing routes: odalar + booking.
 * Path: /api/user/*
 *
 * COMPOSER — alan bazlı router modüllerini (routes/user/*) tek router'da birleştirir.
 */
import { Router } from 'express';
import { requireUser } from '../middleware/auth.middleware';
import { csrfProtection } from '../middleware/cookie-auth';
import profileRoutes from './user/profile.routes';
import roomRoutes from './user/room.routes';
import bookingRoutes from './user/booking.routes';
import discoveryRoutes from './user/discovery.routes';
import showcaseRoutes from './user/showcase.routes';
import licenseRoutes from './user/license.routes';
import notificationRoutes from './user/notification.routes';
import appointmentRoutes from './user/appointment.routes';
import requestRoutes from './user/request.routes';
import visualRoutes from './user/visual.routes';
import libraryRoutes from './user/library.routes';

const router = Router();

router.use(requireUser);

// CSRF — tüm state-changing endpoint'leri (POST/PUT/DELETE/PATCH) korur.
// GET/HEAD/OPTIONS csrf-csrf'in `ignoredMethods` config'i ile muaf.
// Frontend api.ts mutation isteklerinde X-CSRF-Token header'ını otomatik
// gönderir; CSRF rotasyonunda 403 alırsa fresh token ile retry yapar.
router.use(csrfProtection);

// Alan router'ları — orijinal dosyadaki ilk görünüm sırasıyla bağlanır.
router.use(profileRoutes); // /profile, /me
router.use(roomRoutes); // /rooms
router.use(bookingRoutes); // /bookings, /waitlist
router.use(discoveryRoutes); // /leaderboard
router.use(showcaseRoutes); // /showcase
router.use(licenseRoutes); // /licenses
router.use(notificationRoutes); // /notifications
router.use(appointmentRoutes); // /appointments
router.use(requestRoutes); // /hardware, /support
router.use(visualRoutes); // /visuals, /chat
router.use(libraryRoutes); // /books, /loans

export default router;
