/**
 * In-app bildirim merkezi servisi.
 *
 * Uygulama içi kalıcı bildirimleri yönetir (header zil + popover).
 * Tüm kullanıcı/admin bildirimleri bu kanaldan gider (e-posta kanalı kaldırıldı).
 *
 * Tasarım:
 *  - SSE anlık iletim sağlar; bu tablo kalıcılık sağlar.
 *  - Her bildirim bir alıcıya (user/admin) aittir — IDOR: alıcı sadece
 *    kendi bildirimlerini görür/işaretler.
 *  - pushNotification best-effort: bildirim yazımı başarısız olsa bile
 *    asıl işlem (review, create vb.) etkilenmez.
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun } from '../db/schema';
import { logger } from '../utils/logger';

export type NotificationCategory =
  | 'booking'
  | 'license'
  | 'waitlist'
  | 'message'
  | 'system';

// Bildirim alıcı bağlamı. Rol-izolasyonu: her görüntüleme rolü YALNIZ kendi
// recipient_type'ındaki bildirimleri görür (danışman/arge user'ın kişisel
// bildirimlerini GÖRMEZ). NOT: şu an INSERT yalnız 'user'/'admin' için yapılır
// (schema CHECK); 'danisman'/'arge' okuma-kapsamı olarak kullanılır (izolasyon).
export type RecipientType = 'user' | 'admin' | 'danisman' | 'arge' | 'izleyici';

export interface Notification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface DbRow {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  read: number;
  created_at: string;
}

function rowToNotification(row: DbRow): Notification {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

export interface PushNotificationInput {
  recipientId: string;
  recipientType: RecipientType;
  category: NotificationCategory;
  title: string;
  body: string;
  link?: string | null;
}

/**
 * Tek bir alıcıya bildirim oluşturur. Best-effort — hata fırlatmaz.
 */
/**
 * Bildirim — BİLİNÇLİ fire-and-forget: yanıtı bloklamaz, hata içeride loglanır.
 * `void` döner; çağıranların await etmesi gerekmez.
 */
export function pushNotification(input: PushNotificationInput): void {
  void pushNotificationAsync(input);
}

export async function pushNotificationAsync(input: PushNotificationInput): Promise<void> {
  try {
    await dbRun(`INSERT INTO notifications
         (id, recipient_id, recipient_type, category, title, body, link)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [nanoid(),
      input.recipientId,
      input.recipientType,
      input.category,
      input.title.slice(0, 200),
      input.body.slice(0, 500),
      input.link ?? null]);
  } catch (err) {
    logger.error('notification_push_failed', { err: (err as Error).message });
  }
}

/**
 * Birden çok alıcıya aynı bildirimi gönderir (örn. tüm admin'ler).
 */
export function pushNotificationBulk(
  recipientIds: string[],
  recipientType: RecipientType,
  payload: Omit<PushNotificationInput, 'recipientId' | 'recipientType'>
): void {
  for (const id of recipientIds) {
    pushNotification({ ...payload, recipientId: id, recipientType });
  }
}

export async function listNotifications(
  recipientId: string,
  recipientType: RecipientType,
  limit = 30
): Promise<Notification[]> {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const rows = await dbAll(`SELECT id, category, title, body, link, read, created_at
       FROM notifications
       WHERE recipient_id = ? AND recipient_type = ?
       ORDER BY created_at DESC
       LIMIT ?`, [recipientId, recipientType, safeLimit]) as DbRow[];
  return rows.map(rowToNotification);
}

export async function countUnreadNotifications(
  recipientId: string,
  recipientType: RecipientType
): Promise<number> {
  const row = await dbOne(`SELECT COUNT(*) AS c FROM notifications
       WHERE recipient_id = ? AND recipient_type = ? AND read = 0`, [recipientId, recipientType]) as { c: number };
  return row.c;
}

/**
 * Tek bildirimi okundu işaretler. IDOR: sadece kendi bildirimini.
 */
export async function markNotificationRead(
  recipientId: string,
  recipientType: RecipientType,
  notificationId: string
): Promise<void> {
  await dbRun(`UPDATE notifications SET read = 1
     WHERE id = ? AND recipient_id = ? AND recipient_type = ?`, [notificationId, recipientId, recipientType]);
}

/**
 * Alıcının tüm bildirimlerini okundu işaretler.
 */
export async function markAllNotificationsRead(
  recipientId: string,
  recipientType: RecipientType
): Promise<number> {
  const res = await dbRun(`UPDATE notifications SET read = 1
       WHERE recipient_id = ? AND recipient_type = ? AND read = 0`, [recipientId, recipientType]);
  return res.changes;
}
