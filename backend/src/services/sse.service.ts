/**
 * Server-Sent Events (SSE) servisi.
 *
 * Kullanım amacı:
 * - Booking state değişikliklerinde (created/approved/rejected) frontend'i anlık bilgilendir.
 * - Admin paneli: yeni booking gelince pending sayısı artar.
 * - User paneli: kendi booking'i status değiştirince UI güncellenir.
 *
 * Güvenlik:
 * - Bağlantı access_token (Authorization veya `?access_token=` query) ile doğrulanır.
 *   Sadece bearer JWT validate edilir; SSE state-changing değildir, CSRF korumadan muaf.
 * - Yalnızca subject'in görme yetkisi olan event'ler gönderilir (user → kendi, admin → tümü).
 * - Browser EventSource Authorization header destekleyemediği için query string desteği var;
 *   token URL'ye access logging'de görünebilir → production'da reverse proxy log filtresi.
 */
import type { Express, Request, Response } from 'express';
import { verifyAccessToken } from './token.service';
import { logger } from '../utils/logger';
import type { SubjectKind } from '../types/auth.types';

interface SseClient {
  id: string;
  res: Response;
  subjectId: string;
  subjectType: SubjectKind;
  /** Heartbeat timer — her silme noktasında clearInterval şart (sızıntı). */
  ping?: NodeJS.Timeout;
}

const clients = new Map<string, SseClient>();
let clientCounter = 0;

export type SseEventType =
  | 'booking.created'
  | 'booking.updated'
  | 'booking.reviewed'
  | 'booking.withdrawn'
  | 'waitlist.changed'
  | 'appointment.changed'
  | 'chat.message'
  | 'hardware_request.created'
  | 'hardware_request.reviewed'
  | 'support_request.created'
  | 'visual.updated'
  | 'ping';

export interface SsePayload {
  type: SseEventType;
  data: Record<string, unknown>;
}

/**
 * Tüm bağlı client'lara filter ile yayın yap.
 * Filter: predicate fonksiyonu — hangi client'lara gidecek.
 */
/** Client'ı kayıttan düşür + heartbeat timer'ını temizle (sızıntı önleme). */
function dropClient(id: string): void {
  const c = clients.get(id);
  if (!c) return;
  if (c.ping) clearInterval(c.ping);
  clients.delete(id);
}

export function broadcast(
  payload: SsePayload,
  filter: (client: SseClient) => boolean = () => true
): void {
  const data = `event: ${payload.type}\ndata: ${JSON.stringify(payload.data)}\n\n`;
  for (const client of clients.values()) {
    if (!filter(client)) continue;
    try {
      // write() ölü sokete senkron throw etmez; destroyed/writable kontrolü
      // half-open bağlantıları da yakalar. Hata yolunda ping interval'i de
      // temizlenir — önceden timer + Response referansı sızıyordu.
      if (client.res.destroyed || !client.res.writable) {
        dropClient(client.id);
        continue;
      }
      client.res.write(data);
    } catch (err) {
      logger.warn('sse_write_failed', { clientId: client.id, err: (err as Error).message });
      dropClient(client.id);
    }
  }
}

/** Admin'lere broadcast et. */
export function broadcastToAdmins(payload: SsePayload): void {
  broadcast(payload, (c) => c.subjectType === 'admin');
}

/** Belirli user'a broadcast et. */
export function broadcastToUser(userId: string, payload: SsePayload): void {
  broadcast(payload, (c) => c.subjectType === 'user' && c.subjectId === userId);
}

/** Hem belirli user'a hem tüm admin'lere broadcast et. */
export function broadcastBooking(payload: SsePayload, userId: string): void {
  broadcast(
    payload,
    (c) => c.subjectType === 'admin' || (c.subjectType === 'user' && c.subjectId === userId)
  );
}

/**
 * Belirli bir kişiye broadcast et — subjectId bazlı (kind'tan bağımsız).
 * Bir kişi tek seferde tek kind ile bağlı olur (user/admin/danisman/arge);
 * chat mesajları kişiye gider, hangi rolle bağlı olduğuna bakılmaz.
 */
export function broadcastToSubject(subjectId: string, payload: SsePayload): void {
  broadcast(payload, (c) => c.subjectId === subjectId);
}

function extractToken(req: Request): { kind: SubjectKind; token: string } | null {
  const header = req.get('authorization');
  if (header) {
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token) {
      return { kind: 'user', token: token.trim() }; // kind unknown — try both below
    }
  }
  const q = req.query.access_token;
  if (typeof q === 'string' && q.length > 20) {
    return { kind: 'user', token: q };
  }
  return null;
}

/**
 * Token'ı bilinen tüm kind audience'larına karşı dener. user/admin'in yanı sıra
 * danisman/arge (governance rolleri) da ayrı audience'lı token taşır — hepsi
 * denenmezse governance dashboard'ları realtime stream alamaz (401).
 */
function verifyAny(token: string): { kind: SubjectKind; sub: string } | null {
  const KINDS: SubjectKind[] = ['user', 'admin', 'danisman', 'arge', 'izleyici'];
  for (const kind of KINDS) {
    try {
      const decoded = verifyAccessToken(kind, token);
      return { kind, sub: decoded.sub };
    } catch {
      /* sıradaki kind'ı dene */
    }
  }
  return null;
}

export function initSseRoutes(app: Express): void {
  app.get('/api/events', (req: Request, res: Response) => {
    const tokenInfo = extractToken(req);
    if (!tokenInfo) {
      res.status(401).json({ error: 'Yetkilendirme gerekli.', code: 'AUTH_REQUIRED' });
      return;
    }

    const verified = verifyAny(tokenInfo.token);
    if (!verified) {
      res.status(401).json({ error: 'Token geçersiz.', code: 'AUTH_INVALID' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx için
    res.flushHeaders();

    const id = `sse-${++clientCounter}`;
    const client: SseClient = {
      id,
      res,
      subjectId: verified.sub,
      subjectType: verified.kind,
    };
    clients.set(id, client);
    res.on('error', () => dropClient(id));

    // Hello mesajı
    res.write(`event: hello\ndata: ${JSON.stringify({ id, kind: verified.kind })}\n\n`);

    // Her 25 saniyede ping (load balancer timeout korunması)
    const ping = setInterval(() => {
      try {
        if (res.destroyed || !res.writable) {
          dropClient(id);
          return;
        }
        res.write(`event: ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
      } catch {
        dropClient(id);
      }
    }, 25_000);
    client.ping = ping;

    req.on('close', () => {
      dropClient(id);
      logger.info('sse_client_disconnected', { id, total: clients.size });
    });

    logger.info('sse_client_connected', {
      id,
      kind: verified.kind,
      total: clients.size,
    });
  });
}

export function activeClientCount(): number {
  return clients.size;
}

/**
 * Graceful shutdown: tüm açık SSE bağlantılarını kapatır. Uzun-ömürlü SSE
 * stream'leri server.close()'u sonsuza dek bloklayabildiğinden, SIGTERM'de
 * bunlar elle sonlandırılmalı.
 */
export function closeAllSse(): void {
  for (const client of clients.values()) {
    if (client.ping) clearInterval(client.ping);
    try {
      client.res.end();
    } catch {
      /* zaten kapanmış olabilir */
    }
  }
  clients.clear();
}
