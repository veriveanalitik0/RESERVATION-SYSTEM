/**
 * Bildirim merkezi (in-app) servisi — oluşturma, listeleme, okundu, sayım testleri.
 *
 * Kapsam:
 *  - pushNotificationAsync ile kalıcı kayıt.
 *  - listNotifications: alıcının bildirimleri (DESC, IDOR izolasyonu).
 *  - markNotificationRead / markAllNotificationsRead.
 *  - countUnreadNotifications.
 *
 * NOT: schema CHECK gereği INSERT yalnız recipient_type 'user'/'admin' için yapılır.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { initSchema, closeDb } from '../src/db/schema';
import {
  pushNotificationAsync,
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../src/services/notification-center.service';

// İzole alıcılar (nanoid) — başka testlerin verisinden etkilenmesin.
const USER_A = nanoid();
const USER_B = nanoid();
const ADMIN = nanoid();

beforeAll(async () => {
  await initSchema();
});

afterAll(async () => {
  await closeDb();
});

describe('pushNotificationAsync + listNotifications', () => {
  it('bildirim oluşturur ve alıcının listesinde görünür', async () => {
    await pushNotificationAsync({
      recipientId: USER_A,
      recipientType: 'user',
      category: 'booking',
      title: 'Randevu onaylandı',
      body: 'Talebiniz onaylandı.',
      link: '/bookings/1',
    });

    const list = await listNotifications(USER_A, 'user');
    expect(list).toHaveLength(1);
    expect(list[0].category).toBe('booking');
    expect(list[0].title).toBe('Randevu onaylandı');
    expect(list[0].link).toBe('/bookings/1');
    expect(list[0].read).toBe(false);
  });

  it('ikinci bildirim listeye eklenir (created_at DESC sıralı)', async () => {
    await pushNotificationAsync({
      recipientId: USER_A, recipientType: 'user', category: 'system',
      title: 'İkinci bildirim', body: 'Daha yeni.',
    });
    const list = await listNotifications(USER_A, 'user');
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.map((n) => n.title)).toContain('İkinci bildirim');
    // created_at azalan (DESC) olmalı — saniye granülaritesinde eşit olabilir, < değil <=.
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].createdAt >= list[i].createdAt).toBe(true);
    }
  });

  it('IDOR: alıcı yalnız kendi bildirimlerini görür', async () => {
    await pushNotificationAsync({
      recipientId: USER_B, recipientType: 'user', category: 'message',
      title: 'B için özel', body: 'Sadece B görmeli.',
    });
    const listB = await listNotifications(USER_B, 'user');
    const listA = await listNotifications(USER_A, 'user');
    expect(listB.map((n) => n.title)).toContain('B için özel');
    expect(listA.map((n) => n.title)).not.toContain('B için özel');
  });

  it('rol izolasyonu: aynı id farklı recipient_type bildirimleri ayrışır', async () => {
    await pushNotificationAsync({
      recipientId: ADMIN, recipientType: 'admin', category: 'license',
      title: 'Admin lisans', body: 'Admin görünümü.',
    });
    const asAdmin = await listNotifications(ADMIN, 'admin');
    const asUser = await listNotifications(ADMIN, 'user');
    expect(asAdmin.map((n) => n.title)).toContain('Admin lisans');
    expect(asUser).toHaveLength(0);
  });
});

describe('countUnreadNotifications', () => {
  it('okunmamış bildirim sayısını döner', async () => {
    const count = await countUnreadNotifications(USER_A, 'user');
    expect(count).toBeGreaterThanOrEqual(2); // A'nın 2 bildirimi var, hiçbiri okunmadı
  });

  it('bildirimi olmayan alıcı için 0 döner', async () => {
    const count = await countUnreadNotifications(nanoid(), 'user');
    expect(count).toBe(0);
  });
});

describe('markNotificationRead', () => {
  it('tek bildirimi okundu işaretler ve okunmamış sayımı azalır', async () => {
    const before = await countUnreadNotifications(USER_A, 'user');
    const list = await listNotifications(USER_A, 'user');
    const target = list[0];

    await markNotificationRead(USER_A, 'user', target.id);

    const after = await countUnreadNotifications(USER_A, 'user');
    expect(after).toBe(before - 1);

    const updated = (await listNotifications(USER_A, 'user')).find((n) => n.id === target.id);
    expect(updated!.read).toBe(true);
  });

  it('IDOR: başka alıcının bildirimini okundu yapamaz', async () => {
    const bList = await listNotifications(USER_B, 'user');
    const bNotif = bList[0];

    // USER_A, USER_B'nin bildirimini işaretlemeye çalışır — etkisiz olmalı.
    await markNotificationRead(USER_A, 'user', bNotif.id);

    const stillUnread = (await listNotifications(USER_B, 'user')).find((n) => n.id === bNotif.id);
    expect(stillUnread!.read).toBe(false);
  });
});

describe('markAllNotificationsRead', () => {
  it('tüm okunmamışları işaretler ve sayıyı döner; sayım 0 olur', async () => {
    const unreadBefore = await countUnreadNotifications(USER_A, 'user');
    const changed = await markAllNotificationsRead(USER_A, 'user');
    expect(changed).toBe(unreadBefore);

    const after = await countUnreadNotifications(USER_A, 'user');
    expect(after).toBe(0);
  });

  it('okunmamış kalmamışsa 0 döner (idempotent)', async () => {
    const changed = await markAllNotificationsRead(USER_A, 'user');
    expect(changed).toBe(0);
  });
});
