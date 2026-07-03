/**
 * Oda (room) servisi — liste, uygunluk ve doluluk testleri.
 *
 * Kapsam:
 *  - listRooms(): yalnız aktif odaları döner (is_active=0 hariç).
 *  - listRooms(date): tarih filtreli uygunluk — o günü kapsayan booking varsa dolu.
 *  - getRoomsWithOccupancy(): odanın aktif booking'lerini sayar (approved/pending).
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import { listRooms, getRoomsWithOccupancy, getRoomAvailability } from '../src/services/room.service';

const USER = nanoid();
const ACTIVE_ROOM = nanoid();
const INACTIVE_ROOM = nanoid();
const BOOKED_ROOM = nanoid();
const ACTIVE_CODE = `RA-${nanoid(4).toUpperCase()}`;
const INACTIVE_CODE = `RI-${nanoid(4).toUpperCase()}`;
const BOOKED_CODE = `RB-${nanoid(4).toUpperCase()}`;

const futureDate = (daysFromNow: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
};
// Bugünü kapsayan aralık — listRooms(date) ve doluluk için.
const todayStr = new Date().toISOString().slice(0, 10);
const pastDate = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(`INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER, `room-${nanoid(6)}@test.local`, hash, 'Room Tester',
  ]);

  await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`, [
    ACTIVE_ROOM, ACTIVE_CODE, 'Aktif Oda', 'Test', 'Mahalle', 4,
  ]);
  await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity, is_active) VALUES (?, ?, ?, ?, ?, ?, 0)`, [
    INACTIVE_ROOM, INACTIVE_CODE, 'Pasif Oda', 'Test', 'Mahalle', 4,
  ]);
  await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`, [
    BOOKED_ROOM, BOOKED_CODE, 'Dolu Oda', 'Test', 'Mahalle', 4,
  ]);

  // BOOKED_ROOM: bugünü kapsayan, tüm hafta dolu (mask 127) approved booking.
  await dbRun(
    `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
       project_name, project_description, help_needed, technologies, weekday_mask, status)
     VALUES (?, ?, ?, 1, ?, ?, 'Dolu Proje', 'Bugünü kapsayan tam-hafta booking — oda dolu.', 'yok', '["X"]', 127, 'approved')`,
    [nanoid(), USER, BOOKED_ROOM, pastDate(2), futureDate(30)]
  );
});

afterAll(async () => {
  await closeDb();
});

describe('listRooms', () => {
  it('yalnız aktif odaları döner (pasif oda listede yok)', async () => {
    const rooms = await listRooms();
    const codes = rooms.map((r) => r.code);
    expect(codes).toContain(ACTIVE_CODE);
    expect(codes).toContain(BOOKED_CODE);
    expect(codes).not.toContain(INACTIVE_CODE);
  });

  it('booking olmayan aktif oda müsait (isAvailable=true)', async () => {
    const rooms = await listRooms();
    const active = rooms.find((r) => r.code === ACTIVE_CODE);
    expect(active).toBeDefined();
    expect(active!.isAvailable).toBe(true);
  });

  it('bugünü kapsayan tam-hafta booking olan oda müsait değil (isAvailable=false)', async () => {
    const rooms = await listRooms();
    const booked = rooms.find((r) => r.code === BOOKED_CODE);
    expect(booked).toBeDefined();
    expect(booked!.isAvailable).toBe(false);
    expect(booked!.nextAvailableDate).toBeTruthy();
  });

  it('tarih filtresi: dolu odanın o tarihte müsait olmadığını döner', async () => {
    const rooms = await listRooms(todayStr);
    const booked = rooms.find((r) => r.code === BOOKED_CODE);
    const active = rooms.find((r) => r.code === ACTIVE_CODE);
    expect(booked!.isAvailable).toBe(false);
    expect(active!.isAvailable).toBe(true);
  });

  it('tarih filtresi: booking aralığı dışındaki bir tarihte oda müsait', async () => {
    // 200 gün sonra hiçbir booking yok.
    const rooms = await listRooms(futureDate(200));
    const booked = rooms.find((r) => r.code === BOOKED_CODE);
    expect(booked!.isAvailable).toBe(true);
  });
});

describe('getRoomsWithOccupancy', () => {
  it('dolu odanın aktif booking sayımını döner (approvedCount >= 1)', async () => {
    const rooms = await getRoomsWithOccupancy();
    const booked = rooms.find((r) => r.code === BOOKED_CODE);
    expect(booked).toBeDefined();
    expect(booked!.bookings.length).toBeGreaterThanOrEqual(1);
    expect(booked!.approvedCount).toBeGreaterThanOrEqual(1);
    expect(booked!.bookings[0].userId).toBe(USER);
    expect(booked!.bookings[0].userFullName).toBe('Room Tester');
  });

  it('booking olmayan oda boş booking listesi + 0 sayım döner', async () => {
    const rooms = await getRoomsWithOccupancy();
    const active = rooms.find((r) => r.code === ACTIVE_CODE);
    expect(active).toBeDefined();
    expect(active!.bookings).toHaveLength(0);
    expect(active!.approvedCount).toBe(0);
    expect(active!.pendingCount).toBe(0);
  });

  it('pending booking pendingCount\'a yansır', async () => {
    await dbRun(
      `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
         project_name, project_description, help_needed, technologies, weekday_mask, status)
       VALUES (?, ?, ?, 1, ?, ?, 'Pending Proje', 'Bekleyen booking — pendingCount testi.', 'yok', '["X"]', 31, 'pending')`,
      [nanoid(), USER, ACTIVE_ROOM, pastDate(1), futureDate(20)]
    );
    const rooms = await getRoomsWithOccupancy();
    const active = rooms.find((r) => r.code === ACTIVE_CODE);
    expect(active!.pendingCount).toBeGreaterThanOrEqual(1);
    expect(active!.approvedCount).toBe(0);
  });
});

describe('availableWeekdays + getRoomAvailability (full-week varsayılan model)', () => {
  // weekdaySelection KAPALI (varsayılan): rezervasyon tüm haftayı kapsar →
  // müsaitlik TARİH bazlı. Bugünü kapsayan herhangi bir booking odayı doldurur.
  // İzole odalar — diğer testlerin booking'lerinden etkilenmesin.
  const FREE_ROOM = nanoid();
  const PARTIAL_ROOM = nanoid();
  const FREE_CODE = `RF-${nanoid(4).toUpperCase()}`;
  const PARTIAL_CODE = `RP-${nanoid(4).toUpperCase()}`;

  beforeAll(async () => {
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity, is_active) VALUES (?, ?, ?, 'T','M',4,1)`, [
      FREE_ROOM, FREE_CODE, 'Boş Oda',
    ]);
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity, is_active) VALUES (?, ?, ?, 'T','M',4,1)`, [
      PARTIAL_ROOM, PARTIAL_CODE, 'Kısmi Oda',
    ]);
    // PARTIAL_ROOM: bugünü kapsayan Pzt+Çar (mask 1|4 = 5) approved booking.
    await dbRun(
      `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
         project_name, project_description, help_needed, technologies, weekday_mask, status)
       VALUES (?, ?, ?, 1, ?, ?, 'Kısmi', 'Pzt+Çar dolu kısmi booking testi.', 'yok', '["X"]', 5, 'approved')`,
      [nanoid(), USER, PARTIAL_ROOM, pastDate(1), futureDate(20)]
    );
  });

  it('boş oda tüm haftayı müsait döner (availableWeekdays = [1..7])', async () => {
    const rooms = await listRooms();
    const free = rooms.find((r) => r.code === FREE_CODE)!;
    expect(free.isAvailable).toBe(true);
    expect(free.availableWeekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('full-week modda kısmi (Pzt+Çar) booking olan oda DOLU sayılır (tarih bazlı)', async () => {
    const rooms = await listRooms();
    const partial = rooms.find((r) => r.code === PARTIAL_CODE)!;
    // Tam-hafta rezervasyon kısmi booking ile çakışacağından oda bookable değil.
    expect(partial.isAvailable).toBe(false);
    expect(partial.availableWeekdays).toEqual([]);
    expect(partial.nextAvailableDate).toBeTruthy(); // ne zaman boşalacağı görünür
  });

  it('tam dolu oda availableWeekdays = []', async () => {
    const rooms = await listRooms();
    const booked = rooms.find((r) => r.code === BOOKED_CODE)!;
    expect(booked.availableWeekdays).toEqual([]);
  });

  it('getRoomAvailability: dolu oda — boş gün yok ama dolu tarih aralığı (Pzt,Çar) görünür', async () => {
    const avail = await getRoomAvailability(PARTIAL_ROOM);
    expect(avail).toBeDefined();
    expect(avail!.isAvailable).toBe(false); // full-week modda dolu
    expect(avail!.availableWeekdays).toEqual([]);
    expect(avail!.nextAvailableDate).toBeTruthy();
    // busyRanges gerçek maskeyi taşır (kullanıcıya hangi günler dolu bilgisi).
    expect(avail!.busyRanges.length).toBeGreaterThanOrEqual(1);
    expect(avail!.busyRanges[0].weekdays).toEqual([1, 3]); // Pzt, Çar
    expect(Array.isArray(avail!.appointments)).toBe(true);
  });

  it('getRoomAvailability: olmayan oda undefined döner', async () => {
    const avail = await getRoomAvailability('nonexistent-room-id-xyz');
    expect(avail).toBeUndefined();
  });
});

describe('getRoomAvailability — boş aralık / dolu pencere / doluluk sonrası', () => {
  const FUTURE_ROOM = nanoid(); // bugün müsait, ileride dolu pencere var
  const GAP_ROOM = nanoid();    // bugün dolu + ileride ayrı bir dolu pencere

  beforeAll(async () => {
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity, is_active) VALUES (?, ?, 'F','T','M',4,1)`, [
      FUTURE_ROOM, `RF-${nanoid(4).toUpperCase()}`,
    ]);
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity, is_active) VALUES (?, ?, 'G','T','M',4,1)`, [
      GAP_ROOM, `RG-${nanoid(4).toUpperCase()}`,
    ]);

    // FUTURE_ROOM: bugün boş; 15..45 gün sonrası dolu (tek pencere).
    await dbRun(
      `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
         project_name, project_description, help_needed, technologies, weekday_mask, status)
       VALUES (?, ?, ?, 1, ?, ?, 'Gelecek', 'İleride dolu pencere.', 'yok', '["X"]', 127, 'approved')`,
      [nanoid(), USER, FUTURE_ROOM, futureDate(15), futureDate(45)]
    );

    // GAP_ROOM: bugünü kapsayan doluluk (-2..+10) + ayrı gelecek pencere (+20..+40).
    await dbRun(
      `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
         project_name, project_description, help_needed, technologies, weekday_mask, status)
       VALUES (?, ?, ?, 1, ?, ?, 'Şimdi', 'Bugünü kapsayan doluluk.', 'yok', '["X"]', 127, 'approved')`,
      [nanoid(), USER, GAP_ROOM, pastDate(2), futureDate(10)]
    );
    await dbRun(
      `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
         project_name, project_description, help_needed, technologies, weekday_mask, status)
       VALUES (?, ?, ?, 1, ?, ?, 'İleride', 'Ayrı gelecek pencere.', 'yok', '["X"]', 127, 'approved')`,
      [nanoid(), USER, GAP_ROOM, futureDate(20), futureDate(40)]
    );
  });

  it('bugün müsait oda: nextOccupiedWindow + bugünden pencereye kadar boş aralık', async () => {
    const a = (await getRoomAvailability(FUTURE_ROOM))!;
    expect(a.isAvailable).toBe(true);
    expect(a.earliestAvailableAfter).toBeNull(); // bugün zaten müsait
    expect(a.nextOccupiedWindow).toEqual({ startDate: futureDate(15), endDate: futureDate(45) });
    // İlk boş aralık bugünden başlayıp doluluğun bir gün öncesinde biter.
    expect(a.freeGaps[0]).toEqual({ startDate: todayStr, endDate: futureDate(14) });
  });

  it('bugün dolu oda: earliestAvailableAfter doluluğun ertesi günü + pencereler arası boş aralık', async () => {
    const a = (await getRoomAvailability(GAP_ROOM))!;
    expect(a.isAvailable).toBe(false);
    // Mevcut doluluk +10'da biter → +11 ilk müsait gün.
    expect(a.earliestAvailableAfter).toBe(futureDate(11));
    // Gelecekteki en yakın ayrı pencere +20..+40.
    expect(a.nextOccupiedWindow).toEqual({ startDate: futureDate(20), endDate: futureDate(40) });
    // İki pencere arası boş aralık: +11 .. +19.
    expect(a.freeGaps).toContainEqual({ startDate: futureDate(11), endDate: futureDate(19) });
  });
});

describe('listRooms tarih ARALIĞI filtresi (from, to)', () => {
  const R = nanoid();
  beforeAll(async () => {
    await dbRun(`INSERT INTO rooms (id, code, name, district, neighborhood, capacity, is_active) VALUES (?, ?, 'Aralık','T','M',4,1)`, [
      R, `RR-${nanoid(4).toUpperCase()}`,
    ]);
    // +15..+45 dolu (tam hafta).
    await dbRun(
      `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
         project_name, project_description, help_needed, technologies, weekday_mask, status)
       VALUES (?, ?, ?, 1, ?, ?, 'Aralık', 'Aralık filtre testi.', 'yok', '["X"]', 127, 'approved')`,
      [nanoid(), USER, R, futureDate(15), futureDate(45)]
    );
  });
  const availOf = async (from: string, to?: string) => {
    const rooms = await listRooms(from, to);
    return rooms.find((x) => x.id === R)?.isAvailable;
  };

  it('aralık booking ile örtüşürse oda DOLU', async () => {
    expect(await availOf(futureDate(10), futureDate(20))).toBe(false); // +15 aralıkta
    expect(await availOf(futureDate(20), futureDate(30))).toBe(false); // tamamen içinde
    expect(await availOf(futureDate(40), futureDate(60))).toBe(false); // +45 aralıkta
  });

  it('aralık booking ile örtüşmezse oda MÜSAİT', async () => {
    expect(await availOf(futureDate(1), futureDate(10))).toBe(true);   // booking öncesi
    expect(await availOf(futureDate(46), futureDate(60))).toBe(true);  // booking sonrası
  });

  it('to verilmezse tek gün gibi davranır', async () => {
    expect(await availOf(futureDate(20))).toBe(false); // +20 booking içinde
    expect(await availOf(futureDate(5))).toBe(true);   // +5 booking dışında
  });
});
