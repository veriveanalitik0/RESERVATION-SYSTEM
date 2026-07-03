/**
 * Bakım (maintenance) servisi — periyodik temizlik akışı testleri.
 *
 * Kapsam:
 *  - runMaintenanceOnce(): süresi geçmiş + revoked refresh token'lar silinir;
 *    appointmentsCompleted alanı döner.
 *  - markPastAppointmentsCompleted(): end_at geçmiş 'scheduled' randevu 'completed'
 *    olur; gelecekteki 'scheduled' randevuya dokunulmaz; sayı doğru döner.
 *
 * NOT: VACUUM testte kapalı (vacuumOnPrune:false) — silme sayıları izole ölçülür.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun, dbOne } from '../src/db/schema';
import { runMaintenanceOnce } from '../src/services/maintenance.service';
import { markPastAppointmentsCompleted } from '../src/services/appointment.service';

const USER = nanoid();
const ROOM = nanoid();
const BOOKING = nanoid();

/** YYYY-MM-DD HH:MM:SS — şema created_at formatına uygun (leksik karşılaştırılabilir). */
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(`INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
    USER, 'maint@test.local', hash, 'Maint Tester',
  ]);
  await dbRun(`INSERT OR IGNORE INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, ?, ?, ?)`, [
    ROOM, 'MN-01', 'Maint Oda', 'Test', 'Mahalle', 4,
  ]);
  // appointment FK olmasa da bookings satırı tutarlılık için ekleniyor.
  await dbRun(
    `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
       project_name, project_description, help_needed, technologies, status)
     VALUES (?, ?, ?, 1, '2026-01-01', '2026-12-31', 'Maint', 'Maint booking açıklaması yeterli uzunlukta.', 'yok', '["X"]', 'approved')`,
    [BOOKING, USER, ROOM]
  );
});

afterAll(async () => {
  await closeDb();
});

describe('runMaintenanceOnce', () => {
  it('süresi geçmiş VE revoked refresh token silinir; taze/geçerli token korunur', async () => {
    const old = Date.now() - 60 * DAY_MS; // 60 gün önce (grace 30 günü aşar)

    // 1) Süresi geçmiş + eski oluşturma → silinmeli
    const expiredId = nanoid();
    await dbRun(
      `INSERT INTO refresh_tokens (id, token_hash, subject_id, subject_type, expires_at, revoked, created_at)
       VALUES (?, ?, ?, 'user', ?, 0, ?)`,
      [expiredId, nanoid(), USER, iso(old + DAY_MS), iso(old)]
    );

    // 2) Revoked + eski oluşturma → silinmeli (henüz süresi dolmamış olsa da)
    const revokedId = nanoid();
    await dbRun(
      `INSERT INTO refresh_tokens (id, token_hash, subject_id, subject_type, expires_at, revoked, created_at)
       VALUES (?, ?, ?, 'user', ?, 1, ?)`,
      [revokedId, nanoid(), USER, iso(Date.now() + 30 * DAY_MS), iso(old)]
    );

    // 3) Taze + geçerli → KORUNMALI
    const freshId = nanoid();
    await dbRun(
      `INSERT INTO refresh_tokens (id, token_hash, subject_id, subject_type, expires_at, revoked, created_at)
       VALUES (?, ?, ?, 'user', ?, 0, ?)`,
      [freshId, nanoid(), USER, iso(Date.now() + 30 * DAY_MS), iso(Date.now())]
    );

    const result = await runMaintenanceOnce({ vacuumOnPrune: false, auditRetentionDays: 0, auditMaxRows: 0 });

    expect(result.refreshTokensDeleted).toBeGreaterThanOrEqual(2);

    const expiredRow = await dbOne('SELECT id FROM refresh_tokens WHERE id = ?', [expiredId]);
    const revokedRow = await dbOne('SELECT id FROM refresh_tokens WHERE id = ?', [revokedId]);
    const freshRow = await dbOne('SELECT id FROM refresh_tokens WHERE id = ?', [freshId]);
    expect(expiredRow).toBeUndefined();
    expect(revokedRow).toBeUndefined();
    expect(freshRow).toBeDefined();
  });

  it('appointmentsCompleted alanını döner (number)', async () => {
    const result = await runMaintenanceOnce({ vacuumOnPrune: false, auditRetentionDays: 0, auditMaxRows: 0 });
    expect(typeof result.appointmentsCompleted).toBe('number');
    expect(result).toHaveProperty('refreshTokensDeleted');
    expect(result).toHaveProperty('auditLogsDeleted');
    expect(result).toHaveProperty('vacuumed');
  });
});

describe('markPastAppointmentsCompleted', () => {
  it("end_at geçmiş 'scheduled' randevuyu 'completed' yapar; gelecektekine dokunmaz", async () => {
    const pastAppt = nanoid();
    const futureAppt = nanoid();
    const now = Date.now();

    // Geçmiş randevu — end_at dün
    await dbRun(
      `INSERT INTO appointments (id, booking_id, user_id, room_id, start_at, end_at, title, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Geçmiş', 'scheduled')`,
      [pastAppt, BOOKING, USER, ROOM, iso(now - 2 * DAY_MS), iso(now - 1 * DAY_MS)]
    );
    // Gelecek randevu — yarın
    await dbRun(
      `INSERT INTO appointments (id, booking_id, user_id, room_id, start_at, end_at, title, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Gelecek', 'scheduled')`,
      [futureAppt, BOOKING, USER, ROOM, iso(now + 1 * DAY_MS), iso(now + 2 * DAY_MS)]
    );

    const count = await markPastAppointmentsCompleted();
    expect(count).toBeGreaterThanOrEqual(1);

    const past = (await dbOne('SELECT status FROM appointments WHERE id = ?', [pastAppt])) as { status: string };
    const future = (await dbOne('SELECT status FROM appointments WHERE id = ?', [futureAppt])) as { status: string };
    expect(past.status).toBe('completed');
    expect(future.status).toBe('scheduled');
  });

  it('güncellenecek randevu yoksa 0 döner (idempotent)', async () => {
    // Önceki test geçmiş randevuyu zaten completed yaptı — kalan geçmiş scheduled yok.
    const count = await markPastAppointmentsCompleted();
    expect(count).toBe(0);
  });
});
