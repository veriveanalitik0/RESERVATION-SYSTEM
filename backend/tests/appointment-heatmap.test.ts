/**
 * getRoomAppointmentHeatmap — ONAYLI BOOKING tabanlı doluluk ısı-haritası testleri.
 *
 * Doğrular:
 *  - Belirli tarih aralığında oda × gün rezervasyon sayıları doğru hesaplanır
 *    (booking [start_date, end_date] aralığındaki her günü doldurur).
 *  - Çakışan iki booking aynı günü sayar (count=2), slots proje + kullanıcı içerir.
 *  - weekday_mask kısıtı uygulanır (yalnız maskeye uyan günler dolu sayılır).
 *  - Aralık dışındaki booking'ler sayılmaz.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import { getRoomAppointmentHeatmap } from '../src/services/appointment.service';

const USER = nanoid();
const ROOM = nanoid();   // çakışan iki booking
const ROOM2 = nanoid();  // weekday_mask kısıtlı booking

async function insertBooking(
  roomId: string, start: string, end: string, mask: number, project: string
) {
  await dbRun(
    `INSERT INTO bookings
       (id, user_id, room_id, period_months, start_date, end_date, weekday_mask, status,
        project_name, project_description, help_needed, technologies)
     VALUES (?, ?, ?, 1, ?, ?, ?, 'approved', ?,
        'Isı haritası test açıklaması yeterli uzunlukta.', 'Hiçbiri', ?)`,
    [nanoid(), USER, roomId, start, end, mask, project, JSON.stringify(['Claude'])]
  );
}

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER, 'heatmap-user@test.local', hash, 'Heatmap User',
  ]);
  await dbRun(
    `INSERT INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, ?, ?, ?)`,
    [ROOM, 'HM-01', 'Heatmap · Oda', 'Test', 'Mahalle', 4]
  );
  await dbRun(
    `INSERT INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, ?, ?, ?)`,
    [ROOM2, 'HM-02', 'Heatmap · Oda 2', 'Test', 'Mahalle', 4]
  );

  // 2026-06-01 = Pazartesi, 2026-06-07 = Pazar (tam hafta).
  // ROOM: tüm haziran (mask 127) + 06-03..06-05 ek booking → Çar/Per/Cum count=2.
  await insertBooking(ROOM, '2026-06-01', '2026-06-30', 127, 'Proje A');
  await insertBooking(ROOM, '2026-06-03', '2026-06-05', 127, 'Proje B');
  // ROOM2: yalnız Pzt+Çar maskesi (mask 5 = bit0|bit2) — Sal dolu olmamalı.
  await insertBooking(ROOM2, '2026-06-01', '2026-06-07', 5, 'Proje C');
  // Aralık dışı (sayılmamalı): start_date > to.
  await insertBooking(ROOM, '2026-07-10', '2026-07-20', 127, 'Temmuz');
});

afterAll(async () => {
  await closeDb();
});

describe('getRoomAppointmentHeatmap (bookings tabanlı)', () => {
  it('tarih aralığında oda × gün rezervasyonları sayar; çakışan booking count=2', async () => {
    const res = await getRoomAppointmentHeatmap({ from: '2026-06-01', to: '2026-06-07' });
    expect(res.from).toBe('2026-06-01');
    expect(res.to).toBe('2026-06-07');
    expect(res.maxCount).toBe(2); // Çar/Per/Cum'da 2 booking çakışır

    const room = res.rooms.find((r) => r.roomId === ROOM);
    expect(room).toBeDefined();
    expect(room!.days).toHaveLength(7); // Pzt..Paz

    const wed = room!.days.find((d) => d.date === '2026-06-03');
    expect(wed?.weekday).toBe(3); // Çarşamba
    expect(wed?.count).toBe(2);
    expect(wed?.slots).toHaveLength(2);
    expect(wed?.slots.map((s) => s.title).sort()).toEqual(['Proje A', 'Proje B']);
    expect(wed?.slots[0].user).toBe('Heatmap User');

    const mon = room!.days.find((d) => d.date === '2026-06-01');
    expect(mon?.count).toBe(1); // yalnız Proje A

    // total = 7 gün (A) + 3 gün (B: Çar/Per/Cum) = 10.
    expect(room!.total).toBe(10);
  });

  it('weekday_mask kısıtı uygulanır (Sal dolu sayılmaz)', async () => {
    const res = await getRoomAppointmentHeatmap({ from: '2026-06-01', to: '2026-06-07' });
    const room2 = res.rooms.find((r) => r.roomId === ROOM2);
    expect(room2).toBeDefined();
    expect(room2!.days.find((d) => d.date === '2026-06-01')?.count).toBe(1); // Pzt — maskede
    expect(room2!.days.find((d) => d.date === '2026-06-02')?.count).toBe(0); // Sal — maskede değil
    expect(room2!.days.find((d) => d.date === '2026-06-03')?.count).toBe(1); // Çar — maskede
  });

  it('aralık dışındaki booking sayılmaz (Temmuz görünmez)', async () => {
    const res = await getRoomAppointmentHeatmap({ from: '2026-06-01', to: '2026-06-07' });
    const room = res.rooms.find((r) => r.roomId === ROOM);
    const hasJuly = room!.days.some((d) => d.date.startsWith('2026-07'));
    expect(hasJuly).toBe(false);
  });
});
