/**
 * Görsel servisi — IDOR + showcase arkaplan sahiplik (#6).
 *
 * Test alanı:
 *  - getVisualForUser / listMyVisuals: kullanıcı yalnız KENDİ görselini görür.
 *  - regenerateVisual: başkasının görseli yeniden üretilemez (IDOR).
 *  - setBookingShowcaseImage: yalnız kendi booking'ine, kendi (hazır) görselini
 *    arkaplan atayabilir; başkasının booking'i/görseli reddedilir.
 *
 * NOT: createVisual/regenerate asenkron provider (ağ) çağırır; testte görseller
 * doğrudan SQL ile kurulur, yalnız SENKRON sahiplik/doğrulama yolları test edilir.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun, dbOne } from '../src/db/schema';
import {
  getVisualForUser,
  listMyVisuals,
  regenerateVisual,
  setBookingShowcaseImage,
} from '../src/services/visual.service';

const USER_A = nanoid();
const USER_B = nanoid();
const ROOM = nanoid();
const BOOKING_A = nanoid();
const BOOKING_B = nanoid();
const VISUAL_A = nanoid(); // A'nın hazır görseli
const VISUAL_A_NOTREADY = nanoid(); // A'nın prompt'suz/hazır olmayan görseli
const VISUAL_B = nanoid(); // B'nin görseli

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  for (const [id, email, name] of [
    [USER_A, 'va@test.local', 'Visual A'],
    [USER_B, 'vb@test.local', 'Visual B'],
  ]) {
    await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
      id,
      email,
      hash,
      name,
    ]);
  }
  await dbRun(
    `INSERT INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, ?, ?, ?)`,
    [ROOM, 'VX-01', 'Visual · Oda', 'Test', 'Mahalle', 4]
  );

  // Booking'ler (showcase-image ataması için)
  await dbRun(
    `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
       project_name, project_description, help_needed, technologies, status)
     VALUES (?, ?, ?, 1, '2099-01-01', '2099-02-01', 'A Proje', 'A açıklaması yeterince uzun.', '-', '[]', 'approved')`,
    [BOOKING_A, USER_A, ROOM]
  );
  await dbRun(
    `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
       project_name, project_description, help_needed, technologies, status)
     VALUES (?, ?, ?, 1, '2099-01-01', '2099-02-01', 'B Proje', 'B açıklaması yeterince uzun.', '-', '[]', 'approved')`,
    [BOOKING_B, USER_B, ROOM]
  );

  // Görseller — doğrudan SQL (ağ yok)
  const readyVariants = JSON.stringify([
    { seed: 123, url: '/api/public/visuals/' + VISUAL_A + '/image?v=123', stored: true, ext: 'jpg', created_at: 1 },
  ]);
  await dbRun(
    `INSERT INTO visuals (id, user_id, fikir, tema, prompt_en, image_url, seed, status, variant_index, variants)
     VALUES (?, ?, 'fikir A', 'tema', 'prompt A', ?, 123, 'ready', 0, ?)`,
    [VISUAL_A, USER_A, '/api/public/visuals/' + VISUAL_A + '/image?v=123', readyVariants]
  );
  await dbRun(
    `INSERT INTO visuals (id, user_id, fikir, tema, prompt_en, image_url, seed, status, variant_index, variants)
     VALUES (?, ?, 'fikir A2', NULL, NULL, NULL, NULL, 'enhancing', 0, NULL)`,
    [VISUAL_A_NOTREADY, USER_A]
  );
  await dbRun(
    `INSERT INTO visuals (id, user_id, fikir, tema, prompt_en, image_url, seed, status, variant_index, variants)
     VALUES (?, ?, 'fikir B', 'tema', 'prompt B', ?, 999, 'ready', 0, ?)`,
    [VISUAL_B, USER_B, '/api/public/visuals/' + VISUAL_B + '/image?v=999', JSON.stringify([{ seed: 999, url: 'x', stored: false, created_at: 1 }])]
  );
});

afterAll(async () => {
  await closeDb();
});

describe('Görsel sahiplik / IDOR', () => {
  it('sahibi kendi görselini görür', async () => {
    const v = await getVisualForUser(USER_A, VISUAL_A);
    expect(v?.id).toBe(VISUAL_A);
    expect(v?.status).toBe('ready');
  });

  it("başka kullanıcı A'nın görselini GÖREMEZ (undefined)", async () => {
    expect(await getVisualForUser(USER_B, VISUAL_A)).toBeUndefined();
  });

  it('listMyVisuals yalnız kendi görsellerini döner', async () => {
    const aList = await listMyVisuals(USER_A);
    const bList = await listMyVisuals(USER_B);
    expect(aList.every((v) => v.userId === USER_A)).toBe(true);
    expect(aList.some((v) => v.id === VISUAL_A)).toBe(true);
    expect(bList.some((v) => v.id === VISUAL_A)).toBe(false);
    expect(bList.some((v) => v.id === VISUAL_B)).toBe(true);
  });

  it("regenerateVisual: B, A'nın görselini yeniden üretemez (IDOR)", async () => {
    await expect(regenerateVisual(USER_B, VISUAL_A)).rejects.toThrow(
      /bulunamadı|VISUAL_NOT_FOUND/i
    );
  });

  it('regenerateVisual: prompt hazır değilse reddedilir', async () => {
    await expect(regenerateVisual(USER_A, VISUAL_A_NOTREADY)).rejects.toThrow(
      /PROMPT_NOT_READY|hazır değil/i
    );
  });
});

describe('Showcase arkaplan görseli — sahiplik', () => {
  it('sahibi kendi booking + kendi görselini arkaplan atayabilir', async () => {
    const res = await setBookingShowcaseImage(USER_A, BOOKING_A, VISUAL_A);
    expect(res.showcaseImageUrl).toContain(VISUAL_A);
    // DB'ye yazıldı mı?
    const row = (await dbOne(
      'SELECT showcase_image_url FROM bookings WHERE id = ?',
      [BOOKING_A]
    )) as { showcase_image_url: string | null };
    expect(row.showcase_image_url).toContain(VISUAL_A);
  });

  it('visualId=null arkaplanı kaldırır', async () => {
    const res = await setBookingShowcaseImage(USER_A, BOOKING_A, null);
    expect(res.showcaseImageUrl).toBeNull();
  });

  it("A, B'nin booking'ine görsel atayamaz (IDOR)", async () => {
    await expect(setBookingShowcaseImage(USER_A, BOOKING_B, VISUAL_A)).rejects.toThrow(/bulunamadı|BOOKING_NOT_FOUND/i);
  });

  it("A, B'nin görselini KENDİ booking'ine atayamaz (IDOR)", async () => {
    await expect(setBookingShowcaseImage(USER_A, BOOKING_A, VISUAL_B)).rejects.toThrow(/bulunamadı|VISUAL_NOT_FOUND/i);
  });

  it('hazır olmayan görsel arkaplan atanamaz', async () => {
    await expect(setBookingShowcaseImage(USER_A, BOOKING_A, VISUAL_A_NOTREADY)).rejects.toThrow(/hazır değil|VISUAL_NOT_READY/i);
  });
});
