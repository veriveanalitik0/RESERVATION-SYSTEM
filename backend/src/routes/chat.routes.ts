/**
 * Genel sohbet route'ları — `/api/chat/*`.
 *
 * Rol-bağımsız: user / admin / danisman / arge — hepsi katılabilir
 * (requireAnySubject). "Herkes herkesle" 1:1 mesajlaşma.
 *
 *  GET  /chat/contacts                    → sohbet edilebilecek kişiler + son mesaj
 *  GET  /chat/unread                      → toplam okunmamış (nav rozeti)
 *  GET  /chat/conversations/:peerId       → bir kişiyle mesaj geçmişi (peerKind query)
 *  POST /chat/conversations/:peerId/read  → o sohbeti okundu işaretle
 *  POST /chat/messages                    → mesaj gönder
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAnySubject } from '../middleware/auth.middleware';
import { csrfProtection } from '../middleware/cookie-auth';
import {
  listContacts,
  listConversation,
  markConversationRead,
  countUnreadTotal,
  sendMessage,
  type ChatActor,
  type ChatKind,
} from '../services/chat.service';
import { broadcastToSubject } from '../services/sse.service';
import { readId } from '../utils/route-helpers';

const router = Router();
router.use(csrfProtection);
router.use(requireAnySubject);

/** req.auth → ChatActor. danışman/arge users tablosunda → chat kind 'user'. */
function actorFromReq(req: Request): ChatActor {
  const kind: ChatKind = req.auth!.subjectType === 'admin' ? 'admin' : 'user';
  return { id: req.auth!.subjectId, kind };
}

const sendSchema = z.object({
  recipientId: z.string().min(8).max(40),
  recipientKind: z.enum(['user', 'admin']),
  body: z.string().trim().min(1, 'Mesaj boş olamaz.').max(2000),
});

/** Sohbet edilebilecek kişiler — son mesaj + okunmamış sayısıyla. */
router.get('/contacts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ contacts: await listContacts(actorFromReq(req)) });
  } catch (err) {
    next(err);
  }
});

/** Toplam okunmamış mesaj sayısı — nav rozeti için. */
router.get('/unread', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ unread: await countUnreadTotal(actorFromReq(req)) });
  } catch (err) {
    next(err);
  }
});

/** Bir kişiyle mesaj geçmişi. Açılışta o sohbet okundu işaretlenir. */
router.get(
  '/conversations/:peerId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = actorFromReq(req);
      const peerId = readId(req, 'peerId', 'kişi id');
      const messages = await listConversation(me, peerId);
      const marked = await markConversationRead(me, peerId);
      res.json({ messages, markedRead: marked });
    } catch (err) {
      next(err);
    }
  }
);

/** Bir sohbeti okundu işaretle (mesaj geçmişini yeniden çekmeden). */
router.post(
  '/conversations/:peerId/read',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = actorFromReq(req);
      const peerId = readId(req, 'peerId', 'kişi id');
      const marked = await markConversationRead(me, peerId);
      res.json({ markedRead: marked });
    } catch (err) {
      next(err);
    }
  }
);

/** Mesaj gönder + alıcıya realtime SSE bildirimi. */
router.post('/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = actorFromReq(req);
    const input = sendSchema.parse(req.body);
    const result = await sendMessage(me, input.recipientId, input.recipientKind, input.body);

    // Realtime: alıcıya yeni mesaj + güncel okunmamış toplamı.
    broadcastToSubject(input.recipientId, {
      type: 'chat.message',
      data: {
        message: { ...result.message, mine: false },
        unreadTotal: result.recipientUnreadTotal,
        peerId: me.id,
      },
    });

    res.status(201).json({ message: result.message });
  } catch (err) {
    next(err);
  }
});

export default router;
