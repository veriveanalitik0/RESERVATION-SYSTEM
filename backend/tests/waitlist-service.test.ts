/**
 * Waitlist servisi — sıraya yazılma + promote akışı testleri.
 *
 * Kapsam:
 *  - Müsait odaya sıraya yazılamaz (WAITLIST_ROOM_AVAILABLE)
 *  - Aynı user aynı oda+tarih için 1 entry (idempotent koruma)
 *  - Çatışma kaldırıldığında auto-promote → pending booking oluşturur
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun, dbOne } from '../src/db/schema';
import {
  joinWaitlist,
  tryPromoteForRoom,
  listUserWaitlist,
} from '../src/services/waitlist.service';
import { periodEndDate } from '../src/utils/dates';
import { HttpError } from '../src/middleware/error.middleware';

const USER_A = nanoid();
const USER_B = nanoid();
const ROOM = nanoid();
const BLOCKING_BOOKING = nanoid();

const futureDate = (daysFromNow: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(`INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [USER_A, 'wa-a@test.local', hash, 'WL User A']);
  await dbRun(`INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [USER_B, 'wa-b@test.local', hash, 'WL User B']);
  await dbRun(`INSERT OR IGNORE INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, ?, ?, ?)`, [ROOM, 'WL-01', 'WL Oda', 'Test', 'Mahalle', 4]);

  // Bloklayıcı booking — 7 gün sonra başlar, ~37 gün sonra biter
  await dbRun(
    `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
       project_name, project_description, help_needed, technologies, status)
     VALUES (?, ?, ?, 1, ?, ?, 'Blok', 'Bloklayıcı booking — waitlist test için.', 'yok', '["X"]', 'approved')`,
    [BLOCKING_BOOKING, USER_A, ROOM, futureDate(7), futureDate(36)]
  );
});

afterAll(async () => {
  await closeDb();
});

describe('joinWaitlist', () => {
  it('müsait olan oda için sıraya yazılamaz (room available)', async () => {
    await expect(joinWaitlist(USER_B, {
        roomId: ROOM,
        period: '1w',
        desiredStartDate: futureDate(120), // tamamen boş zaman aralığı
        projectName: 'Waitlist test boş',
        projectDescription: 'Bu istek başarısız olmalı çünkü tarih aralığı boş.',
        helpNeeded: 'Yok',
        technologies: ['Claude'],
      })).rejects.toThrow(/ROOM_AVAILABLE|müsait/i);
  });

  it('dolu zaman aralığı için kullanıcı sıraya yazılır (position 1)', async () => {
    const entry = await joinWaitlist(USER_B, {
      roomId: ROOM,
      period: '1w',
      desiredStartDate: futureDate(10), // bloklayıcı booking ile çakışır
      projectName: 'Waitlist test dolu',
      projectDescription: 'Bu istek başarılı olmalı — oda dolu, sıraya gir.',
      helpNeeded: 'Yok',
      technologies: ['GPT'],
    });
    expect(entry.status).toBe('waiting');
    expect(entry.position).toBe(1);
    expect(entry.userId).toBe(USER_B);
  });

  it('entry desiredEndDate = istenen başlangıç + periyot (türetilmiş, başlangıçtan sonra)', async () => {
    const entries = await listUserWaitlist(USER_B);
    const e = entries.find((x) => x.roomCode === 'WL-01' && x.status === 'waiting');
    expect(e).toBeDefined();
    expect(e!.desiredEndDate).toBe(periodEndDate(e!.desiredStartDate, e!.period!));
    expect(e!.desiredEndDate > e!.desiredStartDate).toBe(true);
  });

  it('aynı user aynı oda+tarih için ikinci entry açamaz', async () => {
    await expect(joinWaitlist(USER_B, {
        roomId: ROOM,
        period: '1w',
        desiredStartDate: futureDate(10),
        projectName: 'Duplicate',
        projectDescription: 'İkinci kez sıraya yazılma denemesi — başarısız olmalı.',
        helpNeeded: 'Yok',
        technologies: ['GPT'],
      })).rejects.toThrow(/ALREADY_JOINED|zaten/i);
  });
});

describe('weekday_mask', () => {
  it('yalnız farklı günlerde çakışan booking varsa sıraya yazılma reddedilir (oda o günler müsait)', async () => {
    // Bloklayıcı booking yalnız Pzt-Cum (mask 31) — Cmt+Paz (weekdays 6,7) boş.
    await dbRun('UPDATE bookings SET weekday_mask = 31 WHERE id = ?', [BLOCKING_BOOKING]);
    await expect(joinWaitlist(USER_B, {
        roomId: ROOM,
        period: '1w',
        desiredStartDate: futureDate(10),
        projectName: 'Haftasonu boş',
        projectDescription: 'Cmt+Paz boş olduğu için sıraya değil booking akışına gitmeli.',
        helpNeeded: 'Yok',
        technologies: ['Claude'],
        weekdays: [6, 7],
      })).rejects.toThrow(/ROOM_AVAILABLE|müsait/i);
    await dbRun('UPDATE bookings SET weekday_mask = 127 WHERE id = ?', [BLOCKING_BOOKING]);
  });
});

describe('tryPromoteForRoom', () => {
  it('bloklayıcı booking silinirse waitlist head promote olur ve weekday_mask korunur', async () => {
    // Entry'nin gün seçimini daralt (Pzt+Çar = mask 5) — promote edilen booking
    // bu maskeyle açılmalı (önceki bug: DEFAULT 127 ile tüm haftaya yayılıyordu).
    await dbRun(`UPDATE waitlist SET weekday_mask = 5 WHERE user_id = ? AND room_id = ?`, [USER_B, ROOM]);

    // Bloklayıcı booking'i sil
    await dbRun('DELETE FROM bookings WHERE id = ?', [BLOCKING_BOOKING]);

    const promoted = await tryPromoteForRoom(ROOM);
    expect(promoted.length).toBeGreaterThanOrEqual(1);

    // User B'nin waitlist entry'si artık 'promoted'
    const entries = await listUserWaitlist(USER_B);
    const myEntry = entries.find((e) => e.roomCode === 'WL-01');
    expect(myEntry?.status).toBe('promoted');
    expect(myEntry?.promotedBookingId).toBeTruthy();

    // Yeni booking gerçekten oluştu mu? weekday_mask taşındı mı?
    const newBooking = (await dbOne(
      `SELECT id, user_id, status, weekday_mask FROM bookings WHERE id = ?`,
      [myEntry!.promotedBookingId!]
    )) as { id: string; user_id: string; status: string; weekday_mask: number } | undefined;
    expect(newBooking).toBeDefined();
    expect(newBooking?.user_id).toBe(USER_B);
    expect(newBooking?.status).toBe('pending');
    expect(newBooking?.weekday_mask).toBe(5);
  });
});

describe('manuel bitiş tarihi (desiredEndDate)', () => {
  const ROOM2 = nanoid();
  const BLOCK2 = nanoid();

  beforeAll(async () => {
    await dbRun(`INSERT OR IGNORE INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, ?, ?, ?)`, [ROOM2, 'WL-02', 'WL Oda 2', 'Test', 'Mahalle', 4]);
    // Geniş bloklayıcı booking — manuel bitiş testleri için oda dolu kalsın.
    await dbRun(
      `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
         project_name, project_description, help_needed, technologies, status)
       VALUES (?, ?, ?, 3, ?, ?, 'Blok2', 'Bloklayıcı — manuel bitiş testi.', 'yok', '["X"]', 'approved')`,
      [BLOCK2, USER_A, ROOM2, futureDate(7), futureDate(160)]
    );
  });

  it('periyottan kısa manuel bitiş kabul edilir ve saklanır', async () => {
    const start = futureDate(10);
    const manualEnd = futureDate(25); // 1 ay periyottan belirgin kısa
    const entry = await joinWaitlist(USER_A, {
      roomId: ROOM2,
      period: '1m',
      desiredStartDate: start,
      desiredEndDate: manualEnd,
      projectName: 'Manuel bitiş kısa',
      projectDescription: 'Kullanıcı periyottan kısa bir bitiş tarihi seçiyor.',
      helpNeeded: 'Yok',
      technologies: ['Claude'],
    });
    expect(entry.desiredEndDate).toBe(manualEnd);
    // Periyot-türevinden kısa olmalı.
    expect(entry.desiredEndDate < periodEndDate(start, '1m')).toBe(true);
  });

  it('periyodu aşan manuel bitiş reddedilir', async () => {
    await expect(joinWaitlist(USER_B, {
      roomId: ROOM2,
      period: '1m',
      desiredStartDate: futureDate(11),
      desiredEndDate: futureDate(200), // periyot sonunu aşıyor
      projectName: 'Manuel bitiş uzun',
      projectDescription: 'Bu bitiş tarihi periyodun ötesinde olduğu için reddedilmeli.',
      helpNeeded: 'Yok',
      technologies: ['GPT'],
    })).rejects.toThrow(/periyod|INVALID_END_DATE/i);
  });

  it('başlangıçtan önceki manuel bitiş reddedilir', async () => {
    await expect(joinWaitlist(USER_B, {
      roomId: ROOM2,
      period: '1m',
      desiredStartDate: futureDate(20),
      desiredEndDate: futureDate(15), // başlangıçtan önce
      projectName: 'Manuel bitiş ters',
      projectDescription: 'Bitiş başlangıçtan önce olduğu için reddedilmeli.',
      helpNeeded: 'Yok',
      technologies: ['GPT'],
    })).rejects.toThrow(HttpError);
  });

  it('manuel bitiş verilmezse periyottan türetilir', async () => {
    const start = futureDate(12);
    const entry = await joinWaitlist(USER_B, {
      roomId: ROOM2,
      period: '2w',
      desiredStartDate: start,
      projectName: 'Manuel bitiş yok',
      projectDescription: 'Bitiş verilmedi; periyottan türetilmeli (start + 2 hafta).',
      helpNeeded: 'Yok',
      technologies: ['Gemini'],
    });
    expect(entry.desiredEndDate).toBe(periodEndDate(start, '2w'));
  });
});
