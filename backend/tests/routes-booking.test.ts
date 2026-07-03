/**
 * Route-level entegrasyon testleri — BOOKING akışı (supertest, gerçek app).
 *
 * Kapsam:
 *  - kullanıcı booking oluşturma (201 değil 200 mi — sözleşme), eksik alan 4xx
 *  - admin review approve → approved
 *  - ilerleme notu endpoint'i: yalnız onaylı booking + sahibi
 */
import './setup-env';
process.env.DISABLE_RATE_LIMIT = '1';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import { buildApp } from '../src/app';

const app = buildApp();

const USER = { id: nanoid(), email: 'route-bk-user@test.local', password: 'Demo1234!Pass' };
const OTHER = { id: nanoid(), email: 'route-bk-other@test.local', password: 'Demo1234!Pass' };
const ADMIN = { id: nanoid(), email: 'route-bk-admin@test.local', password: 'Admin1234!Pass' };
const ROOM = nanoid();

const futureDate = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

type Agent = ReturnType<typeof request.agent>;

async function login(email: string, password: string): Promise<{ agent: Agent; csrf: string; token: string }> {
  const agent = request.agent(app);
  const csrfRes = await agent.get('/api/csrf');
  const csrf = (csrfRes.body as { csrfToken: string }).csrfToken;
  const res = await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', csrf)
    .send({ email, password });
  expect(res.status).toBe(200);
  // CSRF token'ı login sonrası rotate olur (frontend de 403'te yeniden çeker) —
  // mutasyonlar için taze token al.
  const freshRes = await agent.get('/api/csrf');
  const fresh = (freshRes.body as { csrfToken: string }).csrfToken;
  return { agent, csrf: fresh, token: res.body.accessToken as string };
}

const VALID_BOOKING = {
  period: '1w' as const,
  startDate: futureDate(3),
  projectName: 'Route Test Projesi',
  projectDescription: 'Route-level entegrasyon testi için örnek proje açıklaması.',
  helpNeeded: 'Mimari değerlendirme desteği.',
  technologies: ['Claude'],
};

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash(USER.password, { type: argon2.argon2id });
  const adminHash = await argon2.hash(ADMIN.password, { type: argon2.argon2id });
  await dbRun(`INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [USER.id, USER.email, hash, 'Route BK User']);
  await dbRun(`INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [OTHER.id, OTHER.email, hash, 'Route BK Other']);
  await dbRun(`INSERT OR IGNORE INTO admins (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`, [ADMIN.id, ADMIN.email, adminHash, 'Route BK Admin']);
  await dbRun(`INSERT OR IGNORE INTO rooms (id, code, name, district, neighborhood, capacity) VALUES (?, ?, ?, ?, ?, ?)`, [ROOM, 'RT-01', 'Route Test Odası', 'Test', 'Mahalle', 4]);
});

afterAll(async () => {
  await closeDb();
});

describe('booking oluşturma → onay → ilerleme notu akışı', () => {
  let bookingId: string;

  it('eksik alanlarla POST /api/user/bookings → 4xx', async () => {
    const { agent, csrf, token } = await login(USER.email, USER.password);
    const res = await agent
      .post('/api/user/bookings')
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${token}`)
      .send({ roomId: ROOM, period: '1w' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('geçerli taleple booking oluşur (pending)', async () => {
    const { agent, csrf, token } = await login(USER.email, USER.password);
    const res = await agent
      .post('/api/user/bookings')
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${token}`)
      .send({ roomId: ROOM, ...VALID_BOOKING });
    expect([200, 201]).toContain(res.status);
    expect(res.body.booking?.status).toBe('pending');
    bookingId = res.body.booking.id as string;
  });

  it('onaysız booking için ilerleme notu yazılamaz (409)', async () => {
    const { agent, csrf, token } = await login(USER.email, USER.password);
    const res = await agent
      .put(`/api/user/bookings/${bookingId}/progress`)
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${token}`)
      .send({ progressNote: 'Henüz onaylanmadan not.' });
    expect(res.status).toBe(409);
  });

  it('tek onay: admin approve → anında approved (analitik onayı GEREKMEZ)', async () => {
    const { agent, csrf, token } = await login(ADMIN.email, ADMIN.password);
    const res = await agent
      .post(`/api/admin/bookings/${bookingId}/review`)
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('approved');
    expect(res.body.booking.adminDecision).toBe('approved');
    expect(res.body.booking.lifecycleStage).toBe('development');
    // Analitik kararı miras alan — hep null.
    expect(res.body.approvalState.analystDecision).toBeNull();
  });

  it('danışman booking review endpoint artık YOK (404)', async () => {
    const { agent, csrf, token } = await login(USER.email, USER.password);
    const res = await agent
      .post(`/api/governance/danisman/bookings/${bookingId}/review`)
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve' });
    // Route kaldırıldı → 404 (veya danışman-token guard'ına takılırsa 401/403).
    expect([401, 403, 404]).toContain(res.status);
  });

  it('sahibi ilerleme notunu günceller; başkası 404 alır (IDOR)', async () => {
    const own = await login(USER.email, USER.password);
    const ok = await own.agent
      .put(`/api/user/bookings/${bookingId}/progress`)
      .set('X-CSRF-Token', own.csrf)
      .set('Authorization', `Bearer ${own.token}`)
      .send({ progressNote: 'MVP tamam, entegrasyon testlerindeyim.' });
    expect(ok.status).toBe(200);
    expect(ok.body.booking.progressNote).toBe('MVP tamam, entegrasyon testlerindeyim.');

    const other = await login(OTHER.email, OTHER.password);
    const denied = await other.agent
      .put(`/api/user/bookings/${bookingId}/progress`)
      .set('X-CSRF-Token', other.csrf)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ progressNote: 'IDOR denemesi' });
    expect(denied.status).toBe(404);
  });

  it('sahibi onaylı rezervasyonu iptal eder → cancelled + oda boşalır', async () => {
    const { agent, csrf, token } = await login(USER.email, USER.password);
    const res = await agent
      .post(`/api/user/bookings/${bookingId}/cancel`)
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');

    // Oda artık aynı tarih aralığı için tekrar rezerve edilebilir olmalı.
    const again = await agent
      .post('/api/user/bookings')
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${token}`)
      .send({ roomId: ROOM, ...VALID_BOOKING });
    expect([200, 201]).toContain(again.status);
  });

  it("CSRF token'sız mutasyon reddedilir", async () => {
    const { token } = await login(USER.email, USER.password);
    const res = await request(app)
      .post('/api/user/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ roomId: ROOM, ...VALID_BOOKING, startDate: futureDate(200) });
    expect([401, 403]).toContain(res.status);
  });
});
