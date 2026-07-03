/**
 * Token servisi — refresh token reuse detection testleri.
 *
 * Akış:
 *  1. issueRefreshToken → DB'ye yazılır.
 *  2. rotateRefreshToken → eski revoke, yeni üretir, parent_id chain.
 *  3. Aynı eski token tekrar rotate → REUSE detected,
 *     o subject'in TÜM refresh chain'i revoke.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import {
  issueRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from '../src/services/token.service';

const SUBJECT_ID = nanoid();

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(
    `INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`,
    [SUBJECT_ID, 'reuse@test.local', hash, 'Reuse Tester']
  );
});

afterAll(async () => {
  await closeDb();
});

describe('Refresh token rotation + reuse detection', () => {
  it('rotation: eski revoke, yeni geçerli', async () => {
    const { token: first } = await issueRefreshToken('user', SUBJECT_ID);
    const outcome1 = await rotateRefreshToken('user', first, {
      sub: SUBJECT_ID,
      role: 'user',
      email: 'reuse@test.local',
    });
    expect(outcome1.ok).toBe(true);
    if (outcome1.ok) {
      // İlk rotation sonrası yeni refresh token gelir
      expect(outcome1.tokens.refreshToken).not.toEqual(first);
      expect(outcome1.tokens.accessToken.split('.')).toHaveLength(3); // JWT format
    }
  });

  it('REUSE: revoke edilmiş token tekrar rotate edilemez ve chain iptal olur', async () => {
    // Yeni bir chain başlat
    const { token: t1 } = await issueRefreshToken('user', SUBJECT_ID);
    const rotated = await rotateRefreshToken('user', t1, {
      sub: SUBJECT_ID,
      role: 'user',
      email: 'reuse@test.local',
    });
    expect(rotated.ok).toBe(true);

    // Eski t1'i tekrar kullan → reuse attack
    const attack = await rotateRefreshToken('user', t1, {
      sub: SUBJECT_ID,
      role: 'user',
      email: 'reuse@test.local',
    });
    expect(attack.ok).toBe(false);
    if (!attack.ok) expect(attack.reason).toBe('reuse_detected');

    // Chain'in tamamı revoke edildi mi?
    if (rotated.ok) {
      const followup = await rotateRefreshToken('user', rotated.tokens.refreshToken, {
        sub: SUBJECT_ID,
        role: 'user',
        email: 'reuse@test.local',
      });
      // Reuse sonrası yeni token bile artık geçerli değil (revoke = 1)
      expect(followup.ok).toBe(false);
    }
  });

  it('kind mismatch: user token admin olarak rotate edilemez', async () => {
    const { token } = await issueRefreshToken('user', SUBJECT_ID);
    const wrongKind = await rotateRefreshToken('admin', token, {
      sub: SUBJECT_ID,
      role: 'admin',
      email: 'reuse@test.local',
    });
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.reason).toBe('kind_mismatch');
  });

  it('subject mismatch: payload.sub != DB.subject_id reddedilir', async () => {
    const { token } = await issueRefreshToken('user', SUBJECT_ID);
    const wrongSub = await rotateRefreshToken('user', token, {
      sub: 'someone-else',
      role: 'user',
      email: 'reuse@test.local',
    });
    expect(wrongSub.ok).toBe(false);
    if (!wrongSub.ok) expect(wrongSub.reason).toBe('subject_mismatch');
  });
});

describe('Access token signing', () => {
  it('user access token RS256 ve 3-parçalı', async () => {
    const { token } = signAccessToken('user', {
      sub: SUBJECT_ID,
      role: 'user',
      email: 'reuse@test.local',
    });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    // header b64-decode et: { alg: 'RS256' }
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    expect(header.alg).toBe('RS256');
  });
});
