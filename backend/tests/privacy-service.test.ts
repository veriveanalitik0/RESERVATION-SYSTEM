/**
 * KVKK uyum testleri — data export + right to be forgotten.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun, dbOne } from '../src/db/schema';
import {
  exportUserData,
  purgeUser,
} from '../src/services/privacy.service';
import { HttpError } from '../src/middleware/error.middleware';

const USER_ID = nanoid();
const ROOM_ID = nanoid();
const BOOKING_PENDING = nanoid();
const BOOKING_APPROVED = nanoid();

const futureDate = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('TestPass123!', { type: argon2.argon2id });
  await dbRun(
    `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, department)
     VALUES (?, ?, ?, ?, ?)`,
    [USER_ID, 'kvkk@test.local', hash, 'Veri Sahibi', 'Compliance']
  );
  await dbRun(
    `INSERT OR IGNORE INTO rooms (id, code, name, district, neighborhood, capacity)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ROOM_ID, 'KV-01', 'KVKK Test Oda', 'Test', 'Mahalle', 4]
  );

  // 2 booking: 1 pending, 1 approved
  await dbRun(
    `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
       project_name, project_description, help_needed, technologies, status)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'yok', ?, 'pending')`,
    [
      BOOKING_PENDING,
      USER_ID,
      ROOM_ID,
      futureDate(200),
      futureDate(230),
      'Pending proje',
      'Bu pending bir proje, silindiğinde tamamen yok olmalı.',
      JSON.stringify(['Claude']),
    ]
  );

  await dbRun(
    `INSERT INTO bookings (id, user_id, room_id, period_months, start_date, end_date,
       project_name, project_description, help_needed, technologies, status)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'yok', ?, 'approved')`,
    [
      BOOKING_APPROVED,
      USER_ID,
      ROOM_ID,
      futureDate(300),
      futureDate(330),
      'Approved proje',
      'Bu approved bir proje, pseudonymize edilmeli — tarih bütünlüğü için kalır.',
      JSON.stringify(['GPT']),
    ]
  );

  // Diğer kişisel veri tabloları — genişletilmiş purge kapsamı (KVKK).
  await dbRun(
    `INSERT INTO chat_messages (id, sender_id, sender_kind, recipient_id, recipient_kind, body)
     VALUES (?, ?, 'user', ?, 'admin', 'KVKK test mesajı')`,
    [nanoid(), USER_ID, nanoid()]
  );
  await dbRun(
    `INSERT INTO showcase_comments (id, booking_id, user_id, user_full_name, body)
     VALUES (?, ?, ?, 'Veri Sahibi', 'KVKK test yorumu')`,
    [nanoid(), BOOKING_APPROVED, USER_ID]
  );
  await dbRun(
    `INSERT INTO notifications (id, recipient_id, recipient_type, category, title, body)
     VALUES (?, ?, 'user', 'system', 'KVKK', 'test bildirimi')`,
    [nanoid(), USER_ID]
  );
  await dbRun(
    `INSERT INTO support_requests (id, user_id, description) VALUES (?, ?, 'KVKK destek talebi açıklaması')`,
    [nanoid(), USER_ID]
  );
});

afterAll(async () => {
  await closeDb();
});

describe('exportUserData', () => {
  it('user verisini + bookings + audit dahil eder', async () => {
    const data = await exportUserData(USER_ID);
    expect(data.user.id).toBe(USER_ID);
    expect(data.user.email).toBe('kvkk@test.local');
    expect(data.bookings.length).toBeGreaterThanOrEqual(2);
    expect(data.generatedAt).toBeDefined();
    expect(data.schemaVersion).toBe('1.0');
  });

  it('var olmayan user için 404 atar', async () => {
    await expect(exportUserData('does-not-exist')).rejects.toThrow(HttpError);
  });
});

describe('purgeUser — Right to be Forgotten', () => {
  it('user silindiğinde PII pseudonymize edilir', async () => {
    const result = await purgeUser(USER_ID, { id: USER_ID, type: 'user' });
    expect(result.purgedUser.id).toBe(USER_ID);
    expect(result.purgedUser.pseudonymizedAs).toMatch(/^deleted-/);

    const user = (await dbOne(
      'SELECT email, full_name, status, password_hash FROM users WHERE id = ?',
      [USER_ID]
    )) as {
      email: string;
      full_name: string;
      status: number;
      password_hash: string;
    };
    // Hassas alanlar temizlendi
    expect(user.email).toContain('@purged.local');
    expect(user.full_name).toBe('[Silinen kullanıcı]');
    expect(user.password_hash).toBe(''); // login imkânsız
    expect(user.status).toBe(3); // soft-delete
  });

  it('pending booking silinir', async () => {
    const pending = await dbOne('SELECT id FROM bookings WHERE id = ?', [BOOKING_PENDING]);
    expect(pending).toBeUndefined(); // silindi
  });

  it('approved booking korunur ama description pseudonymize edilir', async () => {
    const approved = (await dbOne(
      'SELECT project_description, status FROM bookings WHERE id = ?',
      [BOOKING_APPROVED]
    )) as { project_description: string; status: string };
    expect(approved.status).toBe('approved'); // hala kayıtlı
    expect(approved.project_description).toContain('silindi');
  });

  it('sohbet, yorum, bildirim ve destek talepleri de temizlenir (genişletilmiş kapsam)', async () => {
    const chat = await dbOne(
      `SELECT COUNT(*) AS c FROM chat_messages WHERE sender_id = ? OR recipient_id = ?`,
      [USER_ID, USER_ID]
    ) as { c: number };
    expect(Number(chat.c)).toBe(0);
    const comments = await dbOne(
      `SELECT COUNT(*) AS c FROM showcase_comments WHERE user_id = ?`, [USER_ID]
    ) as { c: number };
    expect(Number(comments.c)).toBe(0);
    const notifs = await dbOne(
      `SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = ?`, [USER_ID]
    ) as { c: number };
    expect(Number(notifs.c)).toBe(0);
    const support = await dbOne(
      `SELECT COUNT(*) AS c FROM support_requests WHERE user_id = ?`, [USER_ID]
    ) as { c: number };
    expect(Number(support.c)).toBe(0);
  });

  it('refresh tokenlar revoke edilir', async () => {
    // İlk önce bir token ekle
    const tokenId = nanoid();
    await dbRun(
      `INSERT INTO refresh_tokens (id, token_hash, subject_id, subject_type, expires_at)
       VALUES (?, ?, ?, 'user', ?)`,
      [tokenId, 'hash-' + tokenId, USER_ID, futureDate(7)]
    );

    // Ayrı bir user yarat ki tokenlar yine purge ile silinsin
    const otherUser = nanoid();
    await dbRun(`INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [
      otherUser,
      'other-' + otherUser + '@test.local',
      'x',
      'Other',
    ]);
    const otherToken = nanoid();
    await dbRun(
      `INSERT INTO refresh_tokens (id, token_hash, subject_id, subject_type, expires_at)
       VALUES (?, ?, ?, 'user', ?)`,
      [otherToken, 'hash-' + otherToken, otherUser, futureDate(7)]
    );

    await purgeUser(otherUser, { id: otherUser, type: 'user' });

    const tokenAfter = (await dbOne(
      'SELECT revoked FROM refresh_tokens WHERE id = ?',
      [otherToken]
    )) as { revoked: number };
    expect(tokenAfter.revoked).toBe(1);
  });

  it('audit log: user.delete event yazıldı', async () => {
    const logs = (await dbOne(
      `SELECT event_type, details FROM audit_logs
       WHERE event_type = 'user.delete'
       ORDER BY created_at DESC LIMIT 1`
    )) as { event_type: string; details: string };
    expect(logs.event_type).toBe('user.delete');
    const details = JSON.parse(logs.details);
    expect(details.action).toBe('data_purge');
  });
});
