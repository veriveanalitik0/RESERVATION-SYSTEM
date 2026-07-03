/**
 * Genel rol-bağımsız 1:1 sohbet servisi.
 *
 * Katılımcılar: tüm users (kullanıcı + analitik danışman + yz/arge) + tüm admins.
 * Bir "aktör" = { id, kind } — kind yalnızca 'user' | 'admin' (danışman/arge
 * users tablosunda yaşar → 'user'). Rol etiketi governance_role'den türetilir.
 *
 * chat_messages tablosunda FK yok (katılımcı iki ayrı tabloda olabilir) —
 * bütünlük uygulama katmanında; id'ler nanoid, çakışma pratikte imkânsız.
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';

export type ChatKind = 'user' | 'admin';

export interface ChatActor {
  id: string;
  kind: ChatKind;
}

export interface ChatMessageDto {
  id: string;
  senderId: string;
  senderKind: ChatKind;
  recipientId: string;
  recipientKind: ChatKind;
  body: string;
  read: boolean;
  createdAt: string;
  /** Görüntüleyene göre — mesajı ben mi attım? */
  mine: boolean;
}

export interface ChatContact {
  id: string;
  kind: ChatKind;
  fullName: string;
  /** "Yönetici" | "Analitik Danışman" | "YZ / Ar-Ge" | "Kullanıcı" */
  roleLabel: string;
  /** Kullanıcı profil fotoğrafı (base64 data URL). admin'lerde null. */
  profilePhoto: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
}

interface MessageRow {
  id: string;
  sender_id: string;
  sender_kind: ChatKind;
  recipient_id: string;
  recipient_kind: ChatKind;
  body: string;
  read: number;
  created_at: string;
}

const MAX_BODY = 2000;

function roleLabelForUser(governanceRole: string | null): string {
  if (governanceRole === 'analitik_danisman') return 'Analitik Danışman';
  if (governanceRole === 'yz_arge') return 'YZ / Ar-Ge';
  if (governanceRole === 'izleyici') return 'İzleyici';
  return 'Kullanıcı';
}

function rowToDto(row: MessageRow, viewerId: string): ChatMessageDto {
  return {
    id: row.id,
    senderId: row.sender_id,
    senderKind: row.sender_kind,
    recipientId: row.recipient_id,
    recipientKind: row.recipient_kind,
    body: row.body,
    read: row.read === 1,
    createdAt: row.created_at,
    mine: row.sender_id === viewerId,
  };
}

/** Bir aktörün gerçekten var olduğunu doğrular (IDOR / hayalet alıcı koruması). */
export async function resolveActor(id: string, kind: ChatKind): Promise<ChatActor | null> {
  const table = kind === 'admin' ? 'admins' : 'users';
  const row = await dbOne(`SELECT id FROM ${table} WHERE id = ? AND status != 3`, [id]) as { id: string } | undefined;
  return row ? { id: row.id, kind } : null;
}

/**
 * Sohbet edilebilecek tüm kişiler — kendisi hariç. Her biri için son mesaj +
 * okunmamış sayısı. "Herkes herkesle" politikası: tüm aktif users + admins.
 */
export async function listContacts(me: ChatActor): Promise<ChatContact[]> {

  // Fotoğraf base64 yerine URL — kişi listesi yanıtı MB'lara şişmesin.
  const users = await dbAll(`SELECT id, full_name, governance_role, (profile_photo IS NOT NULL) AS has_photo FROM users WHERE status != 3`, []) as Array<{ id: string; full_name: string; governance_role: string | null; has_photo: boolean }>;
  const admins = await dbAll(`SELECT id, full_name FROM admins WHERE status != 3`, []) as Array<{ id: string; full_name: string }>;

  const contacts: ChatContact[] = [
    ...users.map((u) => ({
      id: u.id,
      kind: 'user' as ChatKind,
      fullName: u.full_name,
      roleLabel: roleLabelForUser(u.governance_role),
      profilePhoto: u.has_photo ? `/api/public/users/${u.id}/photo` : null,
      lastMessage: null as string | null,
      lastMessageAt: null as string | null,
      unread: 0,
    })),
    ...admins.map((a) => ({
      id: a.id,
      kind: 'admin' as ChatKind,
      fullName: a.full_name,
      roleLabel: 'Yönetici',
      profilePhoto: null,
      lastMessage: null as string | null,
      lastMessageAt: null as string | null,
      unread: 0,
    })),
  ].filter((c) => !(c.id === me.id && c.kind === me.kind));

  // Önceden kişi başına 2 ayrı sorgu (2N+2 roundtrip) çalışıyordu; 200 kişide
  // istek başına 400+ sorgu. İki toplu sorguya indirildi:
  //  1) Karşı taraf bazında SON mesaj (DISTINCT ON)
  //  2) Karşı taraf bazında okunmamış sayısı (GROUP BY)
  const lastRows = await dbAll(
    `SELECT DISTINCT ON (peer_id) peer_id, body, created_at FROM (
       SELECT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS peer_id,
              body, created_at
       FROM chat_messages
       WHERE sender_id = ? OR recipient_id = ?
     ) m
     ORDER BY peer_id, created_at DESC`,
    [me.id, me.id, me.id]
  ) as Array<{ peer_id: string; body: string; created_at: string }>;
  const lastByPeer = new Map(lastRows.map((r) => [r.peer_id, r]));

  const unreadRows = await dbAll(
    `SELECT sender_id, COUNT(*) AS c FROM chat_messages
     WHERE recipient_id = ? AND read = 0
     GROUP BY sender_id`,
    [me.id]
  ) as Array<{ sender_id: string; c: number }>;
  const unreadByPeer = new Map(unreadRows.map((r) => [r.sender_id, Number(r.c)]));

  for (const c of contacts) {
    const last = lastByPeer.get(c.id);
    if (last) {
      c.lastMessage = last.body;
      c.lastMessageAt = last.created_at;
    }
    c.unread = unreadByPeer.get(c.id) ?? 0;
  }

  // Son mesajı olanlar üstte (en yeni), sonra alfabetik.
  contacts.sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) {
      return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    }
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.fullName.localeCompare(b.fullName, 'tr');
  });

  return contacts;
}

/** İki kişi arasındaki mesaj geçmişi (kronolojik). */
export async function listConversation(
  me: ChatActor,
  peerId: string,
  limit = 200
): Promise<ChatMessageDto[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const rows = await dbAll(`SELECT * FROM chat_messages
       WHERE (sender_id = ? AND recipient_id = ?)
          OR (sender_id = ? AND recipient_id = ?)
       ORDER BY created_at ASC
       LIMIT ?`, [me.id, peerId, peerId, me.id, safeLimit]) as MessageRow[];
  return rows.map((r) => rowToDto(r, me.id));
}

/** peer → me yönündeki okunmamış mesajları okundu işaretler. Döner: işaretlenen adet. */
export async function markConversationRead(me: ChatActor, peerId: string): Promise<number> {
  const res = await dbRun(`UPDATE chat_messages SET read = 1
       WHERE sender_id = ? AND recipient_id = ? AND read = 0`, [peerId, me.id]);
  return res.changes;
}

/** Görüntüleyenin tüm sohbetlerindeki toplam okunmamış — bildirim rozeti için. */
export async function countUnreadTotal(me: ChatActor): Promise<number> {
  const row = await dbOne(`SELECT COUNT(*) AS c FROM chat_messages WHERE recipient_id = ? AND read = 0`, [me.id]) as { c: number };
  return row.c;
}

export interface SendResult {
  message: ChatMessageDto;
  /** Alıcının güncel toplam okunmamış sayısı (SSE payload'ı için). */
  recipientUnreadTotal: number;
}

/** Mesaj gönder. Alıcının gerçekten var olduğu doğrulanır. */
export async function sendMessage(
  sender: ChatActor,
  recipientId: string,
  recipientKind: ChatKind,
  body: string
): Promise<SendResult> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new HttpError(400, 'Mesaj boş olamaz.', 'CHAT_EMPTY');
  }
  if (trimmed.length > MAX_BODY) {
    throw new HttpError(400, `Mesaj en fazla ${MAX_BODY} karakter olabilir.`, 'CHAT_TOO_LONG');
  }
  const recipient = await resolveActor(recipientId, recipientKind);
  if (!recipient) {
    throw new HttpError(404, 'Alıcı bulunamadı.', 'CHAT_RECIPIENT_NOT_FOUND');
  }
  if (recipient.id === sender.id && recipient.kind === sender.kind) {
    throw new HttpError(400, 'Kendinize mesaj gönderemezsiniz.', 'CHAT_SELF');
  }

  const id = nanoid();
  await dbRun(`INSERT INTO chat_messages
       (id, sender_id, sender_kind, recipient_id, recipient_kind, body)
     VALUES (?, ?, ?, ?, ?, ?)`, [id, sender.id, sender.kind, recipient.id, recipient.kind, trimmed]);

  const row = await dbOne(`SELECT * FROM chat_messages WHERE id = ?`, [id]) as MessageRow;

  return {
    message: rowToDto(row, sender.id),
    recipientUnreadTotal: await countUnreadTotal(recipient),
  };
}
