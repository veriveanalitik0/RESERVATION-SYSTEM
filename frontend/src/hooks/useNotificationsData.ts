/**
 * Bildirim verisi — tek kaynak.
 *
 * NotificationCenter (header zil) ile AppShell (menü rozetleri) aynı veriyi
 * kullansın diye fetch/SSE/state buraya toplandı. AppShell bu hook'u BİR kez
 * çağırır; veriyi NotificationCenter'a prop olarak geçer ve nav rozetlerini
 * hesaplar — böylece çift fetch olmaz.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRealtimeEvents } from './useRealtimeEvents';
import { api } from '../services/api';
import type { AppNotification, SubjectKind } from '../types';

/**
 * Modül-seviyesi kısa ömürlü cache — AppShell her sayfa geçişinde remount
 * olduğundan hook her navigasyonda sıfırdan fetch atıyordu. 15sn'lik cache
 * navigasyonlar arası veriyi taşır; SSE event'i gelirse zaten tazelenir.
 */
const NOTIF_CACHE_TTL_MS = 15_000;
const notifCache = new Map<
  SubjectKind,
  { items: AppNotification[]; unread: number; messageUnread: number; at: number }
>();

export interface NotificationsData {
  items: AppNotification[];
  /** Okunmamış kalıcı bildirim sayısı. */
  unread: number;
  /** Okunmamış sohbet mesajı sayısı. */
  messageUnread: number;
  reload: () => void;
  markAllRead: () => Promise<void>;
  markItemRead: (item: AppNotification) => Promise<void>;
}

export function useNotificationsData(kind: SubjectKind): NotificationsData {
  const cached = notifCache.get(kind);
  const fresh = !!cached && Date.now() - cached.at < NOTIF_CACHE_TTL_MS;
  const [items, setItems] = useState<AppNotification[]>(fresh ? cached.items : []);
  const [unread, setUnread] = useState(fresh ? cached.unread : 0);
  const [messageUnread, setMessageUnread] = useState(fresh ? cached.messageUnread : 0);

  const load = useCallback(async () => {
    try {
      const [notif, chat] = await Promise.all([
        api.listNotifications(kind),
        api.chatUnread(kind).catch(() => ({ unread: 0 })),
      ]);
      setItems(notif.items);
      setUnread(notif.unread);
      setMessageUnread(chat.unread);
      notifCache.set(kind, {
        items: notif.items,
        unread: notif.unread,
        messageUnread: chat.unread,
        at: Date.now(),
      });
    } catch {
      // sessiz — bildirim merkezi kritik yol değil
    }
  }, [kind]);

  useEffect(() => {
    // Cache tazeyse mount'ta yeniden fetch etme (navigasyonlar arası).
    const c = notifCache.get(kind);
    if (!c || Date.now() - c.at >= NOTIF_CACHE_TTL_MS) void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load, kind]);

  // Real-time: İLGİLİ bir event gelince tazele — ping/hello kalp atışları
  // değil (önceden her 25sn'lik ping'de tam refetch tetikleniyordu).
  useRealtimeEvents(kind, (type) => {
    if (type === 'ping' || type === 'hello') return;
    void load();
  });

  const markAllRead = useCallback(async () => {
    try {
      await api.markAllNotificationsRead(kind);
      setItems((curr) => curr.map((i) => ({ ...i, read: true })));
      setUnread(0);
    } catch {
      /* ignore */
    }
  }, [kind]);

  const markItemRead = useCallback(
    async (item: AppNotification) => {
      if (item.read) return;
      setItems((curr) =>
        curr.map((i) => (i.id === item.id ? { ...i, read: true } : i))
      );
      setUnread((u) => Math.max(0, u - 1));
      try {
        await api.markNotificationRead(kind, item.id);
      } catch {
        /* ignore */
      }
    },
    [kind]
  );

  return { items, unread, messageUnread, reload: load, markAllRead, markItemRead };
}
