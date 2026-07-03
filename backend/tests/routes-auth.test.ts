/**
 * Route-level entegrasyon testleri — AUTH zinciri (supertest, gerçek app).
 *
 * Servis testlerinin göremediği katmanı doğrular: middleware sıralaması,
 * zod bağlama, CSRF, guard'lar, yanıt sözleşmeleri.
 *
 * Kapsam:
 *  - login: yanlış parola 401, doğru parola 200 (+ gövdede refresh token YOK)
 *  - guard: token'sız 401; user token'ı admin endpoint'inde reddedilir
 *  - MFA: TOTP'li admin login'de tam token alamaz (pending akışı) ve pending
 *    token korumalı endpoint'lerden geçemez
 *  - izleyici: GET serbest, mutasyon yasak (salt-okunur garanti)
 */
import './setup-env';
process.env.DISABLE_RATE_LIMIT = '1';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import speakeasy from 'speakeasy';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import { buildApp } from '../src/app';
import { encryptSecret } from '../src/utils/crypto';

const app = buildApp();

const USER = { id: nanoid(), email: 'route-user@test.local', password: 'Demo1234!Pass' };
const ADMIN = { id: nanoid(), email: 'route-admin@test.local', password: 'Admin1234!Pass' };
const MFA_ADMIN = { id: nanoid(), email: 'route-mfa@test.local', password: 'Admin1234!Pass' };
const IZLEYICI = { id: nanoid(), email: 'route-izleyici@test.local', password: 'Izle1234!Pass' };
const MFA_SECRET = speakeasy.generateSecret({ length: 20 }).base32;

/** CSRF token + cookie çifti — csrf-csrf double-submit deseni. */
async function csrfFor(agent: ReturnType<typeof request.agent>): Promise<string> {
  const res = await agent.get('/api/csrf');
  expect(res.status).toBe(200);
  return (res.body as { csrfToken: string }).csrfToken;
}

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash(USER.password, { type: argon2.argon2id });
  const adminHash = await argon2.hash(ADMIN.password, { type: argon2.argon2id });
  await dbRun(
    `INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`,
    [USER.id, USER.email, hash, 'Route Test User']
  );
  await dbRun(
    `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, governance_role) VALUES (?, ?, ?, ?, 'izleyici')`,
    [IZLEYICI.id, IZLEYICI.email, hash, 'Route Test İzleyici']
  );
  await dbRun(
    `INSERT OR IGNORE INTO admins (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`,
    [ADMIN.id, ADMIN.email, adminHash, 'Route Test Admin']
  );
  await dbRun(
    `INSERT OR IGNORE INTO admins (id, email, password_hash, full_name, totp_secret, totp_enabled) VALUES (?, ?, ?, ?, ?, 1)`,
    [MFA_ADMIN.id, MFA_ADMIN.email, adminHash, 'Route Test MFA Admin', encryptSecret(MFA_SECRET)]
  );
});

afterAll(async () => {
  await closeDb();
});

describe('POST /api/auth/login', () => {
  it('yanlış parola → 401 AUTH_FAILED', async () => {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: USER.email, password: 'Yanlis1234!xx' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_FAILED');
  });

  it('doğru parola → 200; gövdede refresh token YOK (cookie-only)', async () => {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: USER.email, password: USER.password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.type).toBe('user');
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.mfaRequired).toBe(false);
    // Refresh token HttpOnly cookie olarak set edilmiş olmalı
    const setCookie = res.get('set-cookie') ?? [];
    expect(setCookie.some((c: string) => c.includes('klab_rt_user') && c.includes('HttpOnly'))).toBe(true);
  });

  it('eksik gövde → 4xx (zod bağlama)', async () => {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const res = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('guard zinciri', () => {
  it("token'sız korumalı endpoint → 401", async () => {
    const res = await request(app).get('/api/user/bookings');
    expect(res.status).toBe(401);
  });

  it("user token'ı admin endpoint'inde reddedilir", async () => {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const login = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: USER.email, password: USER.password });
    const res = await request(app)
      .get('/api/admin/bookings')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    // Blanket staff guard: kind eşleşmez → 401/403
    expect([401, 403]).toContain(res.status);
  });
});

describe('MFA sunucu tarafı zorlama', () => {
  it('TOTP etkin admin login → tam token YOK, pending token VAR', async () => {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: MFA_ADMIN.email, password: MFA_ADMIN.password });
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.mfaPendingToken).toBeTruthy();
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it("pending token korumalı admin endpoint'inden GEÇEMEZ", async () => {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const login = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: MFA_ADMIN.email, password: MFA_ADMIN.password });
    const pending = login.body.mfaPendingToken as string;

    const res = await request(app)
      .get('/api/admin/bookings')
      .set('Authorization', `Bearer ${pending}`);
    expect([401, 403]).toContain(res.status);
  });

  it('geçerli TOTP ile /api/auth/mfa/verify → tam oturum', async () => {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const login = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: MFA_ADMIN.email, password: MFA_ADMIN.password });
    const pending = login.body.mfaPendingToken as string;

    const code = speakeasy.totp({ secret: MFA_SECRET, encoding: 'base32' });
    const verify = await agent
      .post('/api/auth/mfa/verify')
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${pending}`)
      .send({ code });
    expect(verify.status).toBe(200);
    expect(verify.body.accessToken).toBeTruthy();
    expect(verify.body.type).toBe('admin');

    // Tam token artık admin endpoint'lerinden geçer
    const list = await request(app)
      .get('/api/admin/bookings')
      .set('Authorization', `Bearer ${verify.body.accessToken}`);
    expect(list.status).toBe(200);
  });

  it('yanlış TOTP → 401 MFA_INVALID', async () => {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const login = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: MFA_ADMIN.email, password: MFA_ADMIN.password });
    const res = await agent
      .post('/api/auth/mfa/verify')
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${login.body.mfaPendingToken}`)
      .send({ code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MFA_INVALID');
  });
});

describe('izleyici rolü — salt-okunur garanti', () => {
  async function loginIzleyici() {
    const agent = request.agent(app);
    const csrf = await csrfFor(agent);
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: IZLEYICI.email, password: USER.password });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('izleyici');
    return { agent, csrf, token: res.body.accessToken as string };
  }

  it("login type='izleyici' döner ve admin GET'lerine erişir", async () => {
    const { token } = await loginIzleyici();
    const occ = await request(app)
      .get('/api/admin/rooms/occupancy')
      .set('Authorization', `Bearer ${token}`);
    expect(occ.status).toBe(200);
  });

  it('hiçbir admin mutasyonu yapamaz', async () => {
    const { agent, csrf, token } = await loginIzleyici();
    const res = await agent
      .post('/api/admin/bookings/xxxxxxxxxxxx/review')
      .set('X-CSRF-Token', csrf)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve' });
    expect([401, 403]).toContain(res.status);
  });

  it("user endpoint'lerine de erişemez (audience ayrımı)", async () => {
    const { token } = await loginIzleyici();
    const res = await request(app)
      .get('/api/user/bookings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
