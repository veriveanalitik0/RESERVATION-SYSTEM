/**
 * Analytics servisi — admin dashboard regresyon testleri.
 *
 * Regresyon: getAnalytics() içindeki top-user sorgusu `HAVING total > 0`
 * (SQLite alias HAVING) kullanıyordu → PostgreSQL'de "column total does not
 * exist" ile 500 fırlatıyordu. Düzeltildi: `HAVING COUNT(b.id) > 0`.
 * Bu test getAnalytics()'in pg'de hatasız çalıştığını ve top-user agregasyonunun
 * doğru veri döndürdüğünü güvence altına alır.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import { getAnalytics } from '../src/services/analytics.service';

const USER = nanoid();
const ROOM = nanoid();
const BOOKING = nanoid();

const dateStr = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  await initSchema();
  // İZOLASYON: testler tek paylaşılan pg DB'sinde sıralı koşar (fileParallelism:false)
  // ve dosyalar arası temizlik yoktur. getAnalytics topUsers'ı GLOBAL agregasyondur
  // (LIMIT 8); diğer dosyaların biriken booking'leri bu testin tek-booking'li
  // kullanıcısını top-8 dışına itip flaky yapıyordu. Bu testin doğrulamaları kendi
  // verisine bağlı olduğundan booking'leri temizleyip deterministik kılıyoruz
  // (FK'ler ON DELETE CASCADE/SET NULL — appointments/likes cascade olur).
  await dbRun('DELETE FROM bookings', []);
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER, 'analytics-user@test.local', hash, 'Analytics User',
  ]);
  await dbRun(
    `INSERT INTO rooms (id, code, name, district, neighborhood, capacity)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ROOM, 'AN-01', 'Analytics · Oda', 'Test', 'Mahalle', 4]
  );
  // approved booking → top-user + room-usage + utilization yollarını tetikler.
  await dbRun(
    `INSERT INTO bookings
       (id, user_id, room_id, period_months, start_date, end_date, status,
        project_name, project_description, help_needed, technologies, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
    [
      BOOKING, USER, ROOM, 1, dateStr(1), dateStr(8),
      'Analytics Proje', 'Analytics test booking açıklaması yeterli uzunlukta.',
      'Hiçbiri', JSON.stringify(['Claude', 'React']), new Date().toISOString(),
    ]
  );
});

afterAll(async () => {
  await closeDb();
});

describe('getAnalytics', () => {
  it('pg üzerinde hatasız çalışır ve beklenen şekli döndürür (HAVING regresyonu)', async () => {
    const result = await getAnalytics();

    expect(result.generatedAt).toBeTruthy();
    expect(result.dailyBookings).toHaveLength(30); // son 30 gün
    expect(Array.isArray(result.roomUsage)).toBe(true);
    expect(Array.isArray(result.topUsers)).toBe(true);
    expect(Array.isArray(result.statusBreakdown)).toBe(true);
    expect(result.totals.bookings).toBeGreaterThanOrEqual(1);
    expect(result.totals.approved).toBeGreaterThanOrEqual(1);
  });

  it('top-user agregasyonu booking olan kullanıcıyı içerir', async () => {
    const result = await getAnalytics();
    const me = result.topUsers.find((u) => u.userId === USER);
    expect(me).toBeDefined();
    expect(me?.bookingCount).toBeGreaterThanOrEqual(1);
    expect(me?.approvedCount).toBeGreaterThanOrEqual(1);
  });

  it('oda kullanımı approved booking için utilization gün hesaplar', async () => {
    const result = await getAnalytics();
    const room = result.roomUsage.find((r) => r.roomId === ROOM);
    expect(room).toBeDefined();
    expect(room?.approvedBookings).toBeGreaterThanOrEqual(1);
    expect(room?.utilizationDays).toBeGreaterThanOrEqual(1); // start..end dahil
  });
});
