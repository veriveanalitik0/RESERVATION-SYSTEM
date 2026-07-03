/**
 * JWT token üretimi ve doğrulaması.
 *
 * Güvenlik:
 * - app_security.md §4: Sadece RS256 (HS256/none yasak).
 * - Access token TTL: 15dk; Refresh token rotation + reuse detection.
 * - app_security.md §4: Payload'da parola/CVV/TCKN/PAN yok.
 * - SHA-256 ile refresh token hash'lenip DB'de saklanır (raw token DB'de yok).
 * - Reuse detection: Eski refresh token tekrar kullanılırsa o subject'in
 *   tüm refresh chain'i revoke edilir (OWASP "rotation + reuse" pattern).
 */
import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { config } from '../config/env';
import { dbOne, dbRun, dbTx } from '../db/schema';
import type { JwtPayload, SubjectKind } from '../types/auth.types';
import { logger } from '../utils/logger';

interface KeyBundle {
  privateKey: string;
  publicKey: string;
  audience: string;
  accessTtl: number;
  refreshTtl: number;
}

function getKeyBundle(kind: SubjectKind): KeyBundle {
  if (kind === 'admin') {
    return {
      privateKey: config.adminJwtPrivateKey,
      publicKey: config.adminJwtPublicKey,
      audience: config.adminJwtAudience,
      accessTtl: config.adminAccessTokenTtl,
      refreshTtl: config.adminRefreshTokenTtl,
    };
  }
  // user / danisman / arge — aynı RSA key, farklı `aud` claim'i.
  // Bu sayede danisman token'ı /api/user/* üzerinde verifyAccessToken'da
  // audience mismatch ile reddedilir (token cross-role kullanım engellenir).
  const audSuffix =
    kind === 'danisman' ? '-danisman'
    : kind === 'arge' ? '-arge'
    : kind === 'izleyici' ? '-izleyici'
    : '';
  return {
    privateKey: config.userJwtPrivateKey,
    publicKey: config.userJwtPublicKey,
    audience: config.userJwtAudience + audSuffix,
    accessTtl: config.userAccessTokenTtl,
    refreshTtl: config.userRefreshTokenTtl,
  };
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function signAccessToken(
  kind: SubjectKind,
  payload: Omit<JwtPayload, 'type'>,
  opts?: { ttlOverride?: number }
): { token: string; ttl: number } {
  const bundle = getKeyBundle(kind);
  const ttl = opts?.ttlOverride ?? bundle.accessTtl;
  const options: SignOptions = {
    algorithm: 'RS256',
    expiresIn: ttl,
    issuer: config.jwtIssuer,
    audience: bundle.audience,
  };
  const fullPayload: JwtPayload = { ...payload, type: kind };
  const token = jwt.sign(fullPayload, bundle.privateKey, options);
  return { token, ttl };
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function issueRefreshToken(
  kind: SubjectKind,
  subjectId: string,
  parentId: string | null = null
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const bundle = getKeyBundle(kind);
  const raw = randomBytes(48).toString('base64url');
  const tokenHash = hashToken(raw);
  const id = nanoid();
  const expiresAt = new Date(Date.now() + bundle.refreshTtl * 1000);

  await dbRun(`INSERT INTO refresh_tokens (id, token_hash, subject_id, subject_type, expires_at, parent_id)
       VALUES (?, ?, ?, ?, ?, ?)`, [id, tokenHash, subjectId, kind, expiresAt.toISOString(), parentId]);

  return { token: raw, id, expiresAt };
}

export interface RotatedTokens extends IssuedTokens {
  subjectId: string;
}

export type RotateOutcome =
  | { ok: true; tokens: RotatedTokens }
  | { ok: false; reason: 'not_found' | 'expired' | 'subject_mismatch' | 'kind_mismatch' | 'reuse_detected' };

/**
 * Refresh token rotation + reuse detection.
 *
 * Akış:
 *  1) Token DB'de bulunur (hash ile).
 *  2) revoked=1 ise → REUSE saldırısı şüphesi: o subject'in TÜM refresh token'ları revoke.
 *     (token zaten daha önce kullanılıp rotate edildiyse `used_at` set, sonraki kullanım theft.)
 *  3) Aksi halde yeni token üret, eski token revoke + used_at set, parent_id ile chain.
 */
export async function rotateRefreshToken(
  kind: SubjectKind,
  rawToken: string,
  payload: Omit<JwtPayload, 'type'>
): Promise<RotateOutcome> {
  const tokenHash = hashToken(rawToken);

  const row = await dbOne(`SELECT id, subject_id, subject_type, expires_at, revoked, used_at
       FROM refresh_tokens WHERE token_hash = ?`, [tokenHash]) as
    | {
        id: string;
        subject_id: string;
        subject_type: string;
        expires_at: string;
        revoked: number;
        used_at: string | null;
      }
    | undefined;

  if (!row) return { ok: false, reason: 'not_found' };
  if (row.subject_type !== kind) return { ok: false, reason: 'kind_mismatch' };
  if (row.subject_id !== payload.sub) return { ok: false, reason: 'subject_mismatch' };

  // REUSE saldırısı: zaten kullanılmış (rotated) bir token tekrar geliyor.
  if (row.revoked === 1 || row.used_at !== null) {
    logger.warn('refresh_token_reuse_detected', {
      subject_type: kind,
      subject_id: row.subject_id,
      token_id: row.id,
    });
    // Tüm chain'i iptal et — token theft varsayımı.
    await dbRun('UPDATE refresh_tokens SET revoked = 1 WHERE subject_id = ? AND subject_type = ?', [row.subject_id, kind]);
    return { ok: false, reason: 'reuse_detected' };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  // Atomik rotation: UPDATE yalnız token HÂLÂ kullanılmamışsa eşleşir. İki
  // eşzamanlı /refresh yarışında yalnız BİRİ changes=1 alır; diğeri changes=0 →
  // reuse muamelesi (READ COMMITTED altında ikinci UPDATE ilkinin commit'ini
  // bekleyip güncel satırı yeniden değerlendirir). Token çatallanması imkânsız.
  const rotated = await dbTx(async () => {
    const upd = await dbRun(
      `UPDATE refresh_tokens SET revoked = 1, used_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revoked = 0 AND used_at IS NULL`,
      [row.id]
    );
    if (upd.changes === 0) {
      // changes=0 → token bu sırada EŞZAMANLI bir istek tarafından zaten rotate
      // edildi (ör. çok-sekme). Bu iyi-niyetli eşzamanlılıktır, hırsızlık DEĞİL:
      // gerçek reuse (rotate edilmiş ESKİ token'ın tekrarı) yukarıdaki erken
      // kontrolde (revoked/used_at) zaten yakalanıp chain revoke edilir. Burada
      // chain'i REVOKE ETME — kazanan isteğin yeni token'ını iptal etmeyelim.
      return null;
    }
    return await issueRefreshToken(kind, payload.sub, row.id);
  });

  if (!rotated) {
    logger.warn('refresh_token_reuse_detected', {
      subject_type: kind,
      subject_id: row.subject_id,
      token_id: row.id,
      race: true,
    });
    return { ok: false, reason: 'reuse_detected' };
  }

  const { token: accessToken, ttl } = signAccessToken(kind, payload);

  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken: rotated.token,
      expiresIn: ttl,
      subjectId: payload.sub,
    },
  };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await dbRun('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', [tokenHash]);
}

export async function revokeAllForSubject(kind: SubjectKind, subjectId: string): Promise<void> {
  await dbRun('UPDATE refresh_tokens SET revoked = 1 WHERE subject_id = ? AND subject_type = ?', [subjectId, kind]);
}

/**
 * subject_id'ye ait TÜM refresh token'ları (her kind: user/admin/danisman/arge)
 * revoke eder. Login sırasında çağrılır → tek aktif oturum politikası (multi-role
 * session accumulation güvenlik açığı C1'in backend savunması).
 *
 * Erişim token'ları (15 dk TTL) hâlâ geçerli kalır ama yenileme yapılamayacağı
 * için kısa süre içinde otomatik silinir.
 */
export async function revokeAllForSubjectAllKinds(subjectId: string): Promise<void> {
  await dbRun('UPDATE refresh_tokens SET revoked = 1 WHERE subject_id = ?', [subjectId]);
}

export function verifyAccessToken(
  kind: SubjectKind,
  token: string,
  opts?: { ignoreExpiration?: boolean }
): JwtPayload {
  const bundle = getKeyBundle(kind);
  const options: VerifyOptions = {
    algorithms: ['RS256'],
    issuer: config.jwtIssuer,
    audience: bundle.audience,
    // /auth/refresh kimliği HttpOnly refresh cookie'sinden alır; süresi geçmiş
    // access token YALNIZ subject'i tanımlamak için kabul edilir (imza+aud+iss
    // hâlâ doğrulanır). Diğer tüm guard'larda expiration zorunlu kalır.
    ...(opts?.ignoreExpiration ? { ignoreExpiration: true } : {}),
  };
  const decoded = jwt.verify(token, bundle.publicKey, options) as JwtPayload;

  if (decoded.type !== kind) {
    throw new Error('Token tipi uyuşmuyor.');
  }
  return decoded;
}
