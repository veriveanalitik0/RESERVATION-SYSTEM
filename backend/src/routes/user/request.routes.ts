/**
 * Kullanıcı talep rotaları: /hardware (donanım talepleri) + /support (destek talebi).
 * user.routes.ts composer'ı tarafından bağlanır.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  createHardwareRequestSchema,
  createSupportRequestSchema,
} from '../../validators/schemas';
import {
  createHardwareRequest,
  listUserHardwareRequests,
  updateHardwareRequest,
} from '../../services/hardware-request.service';
import { createSupportRequest } from '../../services/support-request.service';
import { recordAudit } from '../../services/audit.service';
import { readId } from '../../utils/route-helpers';

const router = Router();

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

export default router;
