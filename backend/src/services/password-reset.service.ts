/**
 * Şifre sıfırlama akışı (sadece 'user' hesapları).
 *
 * Akış:
 *  1. requestPasswordReset(email): kullanıcı varsa tek kullanımlık token üretir,
 *     hash'ini saklar, ham token'ı e-posta linkiyle gönderir.
 *  2. resetPassword(token, newPassword): token geçerliyse parolayı günceller,
 *     token'ı tüketir, kullanıcının tüm refresh token'larını iptal eder.
 *
 * Güvenlik (app_security.md):
 * - §8 Kullanıcı varlığı ifşa edilmez — requestPasswordReset her zaman sessizce
 *   başarılı döner (e-posta kayıtlı olsun olmasın).
 * - Token ham haliyle DB'de tutulmaz — SHA-256 hash saklanır (refresh token paterni).
 * - Token tek kullanımlık (used_at) ve süreli (1 saat).
 * - Sıfırlama sonrası tüm oturumlar (refresh token) iptal edilir.
 * - §7 Parola Argon2id ile hash'lenir (auth.service.hashPassword).
 */
import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { dbOne, dbRun, dbTx } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { hashPassword } from './auth.service';
import { revokeAllForSubject } from './token.service';

/** Token geçerlilik süresi — 1 saat. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Parola sıfırlama talebi. Kullanıcı varlığını ifşa etmez — çağıran her
 * durumda aynı sonucu görür.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();

  const user = await dbOne("SELECT id, email, full_name FROM users WHERE email = ? AND status = 1", [normalized]) as { id: string; email: string; full_name: string } | undefined;

  if (!user) {
    // Kullanıcı yok — sessizce çık (varlık ifşası yok).
    logger.info('password_reset_request_unknown_email');
    return;
  }

  // Bu kullanıcının kullanılmamış eski token'larını geçersiz kıl.
  await dbRun(`UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND used_at IS NULL`, [user.id]);

  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  await dbRun(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`, [nanoid(), user.id, hashToken(rawToken), expiresAt]);

  // NOT: Token üretildi ve saklandı, ancak teslimat kanalı (e-posta) kaldırıldı.
  // Yeni bildirim yöntemi belirlenince sıfırlama linki burada gönderilecek:
  //   const resetUrl = `${FRONTEND_ORIGIN}/reset-password?token=${rawToken}`;
  // Şimdilik link teslim EDİLMEZ.
  logger.info('password_reset_token_created', { userId: user.id });
}

/**
 * Token doğrulayıp parolayı değiştirir.
 * Başarılıysa kullanıcının tüm oturumları (refresh token) iptal edilir.
 *
 * @returns sıfırlanan kullanıcının id'si
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string
): Promise<{ userId: string }> {
  const tokenHash = hashToken(rawToken.trim());

  const row = await dbOne(`SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens WHERE token_hash = ?`, [tokenHash]) as
    | { id: string; user_id: string; expires_at: string; used_at: string | null }
    | undefined;

  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError(
      400,
      'Sıfırlama bağlantısı geçersiz veya süresi dolmuş.',
      'RESET_TOKEN_INVALID'
    );
  }

  const passwordHash = await hashPassword(newPassword);

  await dbTx(async () => {
    // Token'ı yeniden doğrula (race koruması) + tüket.
    const fresh = await dbOne('SELECT used_at FROM password_reset_tokens WHERE id = ?', [row.id]) as { used_at: string | null } | undefined;
    if (!fresh || fresh.used_at) {
      throw new HttpError(400, 'Sıfırlama bağlantısı zaten kullanılmış.', 'RESET_TOKEN_USED');
    }
    await dbRun('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
    await dbRun('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash, row.user_id]);
  });

  // Tüm oturumları kapat — eski parolayla açılmış token'lar geçersiz olsun.
  await revokeAllForSubject('user', row.user_id);

  return { userId: row.user_id };
}
