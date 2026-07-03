/**
 * Şifre sıfırlama servisi — token üretimi + reset akışı testleri.
 *
 * Kapsam:
 *  - requestPasswordReset: kayıtlı e-posta için hash'li token saklanır (ham token DB'de yok).
 *  - resetPassword: geçerli token ile parola güncellenir + token tüketilir.
 *  - süresi geçmiş token reddi.
 *  - kullanılmış token reddi.
 *  - var olmayan e-posta sızdırmaz (enumeration koruması — sessizce başarılı, token üretmez).
 *
 * NOT: E-posta teslimatı kaldırıldı; ham token artık dışarı sızmıyor. resetPassword
 * testleri token satırını doğrudan DB'ye yazıp (hash) ham token'la doğrular.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { initSchema, closeDb, dbRun, dbOne } from '../src/db/schema';
import {
  requestPasswordReset,
  resetPassword,
} from '../src/services/password-reset.service';
import { HttpError } from '../src/middleware/error.middleware';

const USER = nanoid();
const EMAIL = `pwreset-${nanoid(6).toLowerCase()}@test.local`;
const ORIGINAL_PASSWORD = 'Demo1234!Pass';

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

function randomHex(): string {
  return createHash('sha256').update(nanoid() + String(Math.floor(performance.now()))).digest('hex');
}

/**
 * resetPassword testleri için kullanıcıya geçerli (1 saat süreli) bir token satırı
 * ekler ve ham token'ı döner. Servisin davranışını taklit ederek önceki
 * kullanılmamış token'ları geçersiz kılar.
 */
async function createFreshToken(): Promise<string> {
  const raw = randomHex();
  await dbRun(
    `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL`,
    [USER]
  );
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await dbRun(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [nanoid(), USER, hashToken(raw), expires]
  );
  return raw;
}

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash(ORIGINAL_PASSWORD, { type: argon2.argon2id });
  await dbRun(`INSERT OR IGNORE INTO users (id, email, password_hash, full_name, status) VALUES (?, ?, ?, ?, 1)`, [
    USER, EMAIL, hash, 'PW Reset Tester',
  ]);
});

afterAll(async () => {
  await closeDb();
});

describe('requestPasswordReset', () => {
  it('kayıtlı e-posta için DB\'de hash\'li (kullanılmamış) token satırı oluşturur', async () => {
    await requestPasswordReset(EMAIL);

    const row = await dbOne(
      'SELECT token_hash, user_id, used_at FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1',
      [USER]
    ) as { token_hash: string; user_id: string; used_at: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.user_id).toBe(USER);
    expect(row!.used_at).toBeNull();
    // Saklanan değer SHA-256 hash (64 hex) — ham token değil.
    expect(row!.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('var olmayan e-posta token üretmez (enumeration koruması — sessizce başarılı)', async () => {
    const before = (await dbOne('SELECT COUNT(*) AS c FROM password_reset_tokens', []) as { c: number }).c;

    await expect(requestPasswordReset(`yok-${nanoid(8)}@test.local`)).resolves.toBeUndefined();

    const after = (await dbOne('SELECT COUNT(*) AS c FROM password_reset_tokens', []) as { c: number }).c;
    expect(after).toBe(before); // yeni token satırı eklenmedi
  });

  it('yeni talep önceki kullanılmamış token\'ları geçersiz kılar', async () => {
    await requestPasswordReset(EMAIL);
    const firstUnused = await dbOne(
      'SELECT id FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1',
      [USER]
    ) as { id: string } | undefined;
    expect(firstUnused).toBeDefined();

    await requestPasswordReset(EMAIL);

    // İlk token artık used_at set (geçersiz).
    const firstRow = await dbOne(
      'SELECT used_at FROM password_reset_tokens WHERE id = ?',
      [firstUnused!.id]
    ) as { used_at: string | null };
    expect(firstRow.used_at).not.toBeNull();

    // Kullanıcı için tam olarak bir kullanılmamış token kalır.
    const unused = (await dbOne(
      'SELECT COUNT(*) AS c FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL',
      [USER]
    ) as { c: number }).c;
    expect(unused).toBe(1);
  });
});

describe('resetPassword', () => {
  it('geçerli token ile parolayı değiştirir + token tüketir', async () => {
    const token = await createFreshToken();
    const newPassword = 'Yeni4567!Sifre';

    const result = await resetPassword(token, newPassword);
    expect(result.userId).toBe(USER);

    // Token tüketildi (used_at set).
    const tokenRow = await dbOne(
      'SELECT used_at FROM password_reset_tokens WHERE token_hash = ?',
      [hashToken(token)]
    ) as { used_at: string | null };
    expect(tokenRow.used_at).not.toBeNull();

    // Parola gerçekten değişti — yeni hash yeni parolayı doğrular.
    const userRow = await dbOne('SELECT password_hash FROM users WHERE id = ?', [USER]) as { password_hash: string };
    expect(await argon2.verify(userRow.password_hash, newPassword)).toBe(true);
    expect(await argon2.verify(userRow.password_hash, ORIGINAL_PASSWORD)).toBe(false);
  });

  it('kullanılmış token ikinci kez reddedilir', async () => {
    const token = await createFreshToken();
    await resetPassword(token, 'Ikinci8901!Sifre');
    await expect(resetPassword(token, 'Ucuncu2345!Sifre')).rejects.toThrow(HttpError);
  });

  it('süresi geçmiş token reddedilir', async () => {
    const raw = randomHex();
    const id = nanoid();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 saat önce dolmuş
    await dbRun(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
      [id, USER, hashToken(raw), past]
    );
    await expect(resetPassword(raw, 'Suresi6789!Gecmis')).rejects.toThrow(/geçersiz|süresi|RESET_TOKEN_INVALID/i);
  });

  it('var olmayan token reddedilir', async () => {
    await expect(resetPassword(randomHex(), 'Olmayan1234!Tk')).rejects.toThrow(HttpError);
  });
});
