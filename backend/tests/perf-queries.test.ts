/**
 * Performans/verimlilik testleri — kritik agregasyon sorguları gerçekçi veri
 * altında bir EŞİK süre içinde tamamlanmalı. Amaç: katastrofik regresyonları
 * (eksik index, kazara N+1, tablo taraması) yakalamak. Eşikler bilinçli GENİŞ
 * tutuldu (CI donanım değişkenliğine karşı flaky olmasın); darboğaz büyük
 * sapma yaratır, marjinal gürültü değil.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun, dbTx } from '../src/db/schema';
import { getAnalytics } from '../src/services/analytics.service';
import { getRoomAppointmentHeatmap } from '../src/services/appointment.service';
import { getLeaderboard } from '../src/services/leaderboard.service';

const ROOMS = 25;
const USERS = 60;
const BOOKINGS = 250;
const APPTS = 400;

/** Eşik (ms) — geniş; sadece ciddi darboğazı yakalar. */
const THRESHOLD_MS = 1500;

const dateStr = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const isoAt = (offsetDays: number, hour: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const roomIds: string[] = [];
const userIds: string[] = [];
const bookingIds: string[] = [];

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });

  // Tek transaction'da toplu seed — testi hızlı tutar.
  await dbTx(async () => {
    for (let i = 0; i < ROOMS; i++) {
      const id = nanoid();
      roomIds.push(id);
      await dbRun(
        `INSERT INTO rooms (id, code, name, district, neighborhood, capacity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, `PF-${i}`, `Perf Oda ${i}`, 'Test', 'Mahalle', 4]
      );
    }
    for (let i = 0; i < USERS; i++) {
      const id = nanoid();
      userIds.push(id);
      await dbRun(
        `INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`,
        [id, `perf-${i}@test.local`, hash, `Perf User ${i}`]
      );
    }
    for (let i = 0; i < BOOKINGS; i++) {
      const id = nanoid();
      bookingIds.push(id);
      const status = i % 5 === 0 ? 'pending' : 'approved';
      await dbRun(
        `INSERT INTO bookings
           (id, user_id, room_id, period_months, start_date, end_date, status,
            project_name, project_description, help_needed, technologies, reviewed_at, lifecycle_stage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, userIds[i % USERS], roomIds[i % ROOMS], 1,
          dateStr(-30 + (i % 20)), dateStr(60 + (i % 20)), status,
          `Perf Proje ${i}`, 'Performans testi için yeterli uzunlukta açıklama metni.',
          'Hiçbiri', JSON.stringify(['Claude', 'React']),
          status === 'approved' ? isoAt(-5, 10) : null,
          status === 'approved' ? 'development' : 'application',
        ]
      );
    }
    for (let i = 0; i < APPTS; i++) {
      await dbRun(
        `INSERT INTO appointments
           (id, booking_id, user_id, room_id, start_at, end_at, title, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', 'scheduled')`,
        [
          nanoid(), bookingIds[i % BOOKINGS], userIds[i % USERS], roomIds[i % ROOMS],
          isoAt(i % 7, 9 + (i % 8)), isoAt(i % 7, 10 + (i % 8)), `Randevu ${i}`,
        ]
      );
    }
  });
});

afterAll(async () => {
  // Paylaşılan klab_test DB'sini kirletmemek için perf verisini temizle (bu test
  // bulk veri enjekte eder; diğer test dosyalarının global agregat assertion'larını
  // bozmasın). Sıra: bookings (appointments'ı cascade siler) → users → rooms.
  await dbRun("DELETE FROM bookings WHERE project_name LIKE ?", ['Perf Proje %']);
  await dbRun("DELETE FROM users WHERE email LIKE ?", ['perf-%@test.local']);
  await dbRun("DELETE FROM rooms WHERE code LIKE ?", ['PF-%']);
  await closeDb();
});

async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const start = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - start) / 1e6; // ms
}

describe(`Performans (≈${ROOMS} oda / ${USERS} kullanıcı / ${BOOKINGS} booking / ${APPTS} randevu)`, () => {
  it(`getAnalytics ${THRESHOLD_MS}ms altında`, async () => {
    const ms = await timed(() => getAnalytics());
    // eslint-disable-next-line no-console
    console.log(`  getAnalytics: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(THRESHOLD_MS);
  });

  it(`getRoomAppointmentHeatmap ${THRESHOLD_MS}ms altında`, async () => {
    const ms = await timed(() => getRoomAppointmentHeatmap({ from: dateStr(0), to: dateStr(6) }));
    // eslint-disable-next-line no-console
    console.log(`  getRoomAppointmentHeatmap: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(THRESHOLD_MS);
  });

  it(`getLeaderboard ${THRESHOLD_MS}ms altında`, async () => {
    const ms = await timed(() => getLeaderboard(20));
    // eslint-disable-next-line no-console
    console.log(`  getLeaderboard: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(THRESHOLD_MS);
  });
});
