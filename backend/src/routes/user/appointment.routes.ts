/**
 * Kullanıcı randevu rotaları: /appointments (liste, oluştur, iptal).
 * user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { createAppointmentSchema } from '../../validators/schemas';
import {
  cancelAppointment,
  createAppointment,
  listUserAppointments,
} from '../../services/appointment.service';
import { readId } from '../../utils/route-helpers';

const router = Router();

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

export default router;
