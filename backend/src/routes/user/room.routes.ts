/**
 * Kullanıcı oda rotaları: /rooms (liste, müsaitlik, appointment ısı-haritası).
 * user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { listRooms, getRoomAvailability } from '../../services/room.service';
import { getRoomAppointmentHeatmap } from '../../services/appointment.service';

const router = Router();

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

export default router;
