/**
 * Periyodik (gün-bazlı) booking çakışması (#6).
 *
 * Booking GÜN-BAZLI: bookings.weekday_mask bitmask. Çakışma = oda + tarih aralığı
 * örtüşmesi VE haftanın günü kesişimi (weekday_mask & weekday_mask) != 0.
 *
 * Test alanı:
 *  - Aynı oda + örtüşen tarih + AYRIK günler → çakışma YOK (ikisi de oluşur).
 *  - Aynı oda + örtüşen tarih + KESİŞEN gün → çakışma (reddedilir).
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import { createBooking } from '../src/services/booking.service';
import { HttpError } from '../src/middleware/error.middleware';

const USER_A = nanoid();
const USER_B = nanoid();
const ROOM = nanoid();

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER_A, 'pa@test.local', hash, 'Periyodik A',
  ]);
  await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER_B, 'pb@test.local', hash, 'Periyodik B',
  ]);
  await dbRun(
    `INSERT INTO rooms (id, code, name, district, neighborhood, capacity)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ROOM, 'PX-01', 'Periyodik · Oda', 'Test', 'Mahalle', 4]
  );
});

afterAll(async () => {
  await closeDb();
});

const futureDate = (daysFromNow: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
};

const baseInput = (startDays: number, weekdays: number[]) => ({
  roomId: ROOM,
  period: '1w' as const,
  weekdays,
  startDate: futureDate(startDays),
  projectName: 'Periyodik Test',
  projectDescription: 'Gün-bazlı çakışma testi için yeterli uzunlukta açıklama.',
  helpNeeded: 'Hiçbiri',
  technologies: ['Claude'],
});

describe('Periyodik (gün-bazlı) booking çakışması', () => {
  it('A: Pzt+Çar günleri için booking oluşturur', async () => {
    const r = await createBooking(USER_A, baseInput(10, [1, 3]));
    expect(r.status).toBe('pending');
    expect(r.weekdays).toEqual([1, 3]);
  });

  it('B: AYNI oda + örtüşen tarih + AYRIK günler (Sal+Per) → çakışma YOK', async () => {
    const r = await createBooking(USER_B, baseInput(10, [2, 4]));
    expect(r.status).toBe('pending');
    expect(r.weekdays).toEqual([2, 4]);
  });

  it('B: AYNI oda + örtüşen tarih + KESİŞEN gün (Çar+Cum) → çakışma (reddedilir)', async () => {
    await expect(createBooking(USER_B, baseInput(10, [3, 5]))).rejects.toThrow(HttpError);
    await expect(createBooking(USER_B, baseInput(10, [3, 5]))).rejects.toThrow(/dolu|ROOM_NOT_AVAILABLE/i);
  });

  it('B: AYNI oda + örtüşen tarih + tek kesişen gün (Pzt) → çakışma', async () => {
    await expect(createBooking(USER_B, baseInput(12, [1]))).rejects.toThrow(HttpError);
  });

  it('B: AYNI gün ama ÖRTÜŞMEYEN tarih (çok ileride) → çakışma YOK', async () => {
    const r = await createBooking(USER_B, baseInput(200, [1, 3]));
    expect(r.status).toBe('pending');
  });
});
