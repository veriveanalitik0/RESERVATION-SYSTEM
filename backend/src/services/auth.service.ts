/**
 * Authentication servisleri.
 *
 * Güvenlik:
 * - app_security.md §4: Argon2id parola hash; brute-force lockout (5 deneme → 15 dk).
 * - app_security.md §4: User ve Admin tabloları ayrı.
 * - Generic hata mesajı (kullanıcı varlığı ifşa edilmez).
 */
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { config } from '../config/env';
import { dbOne, dbRun } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import type { AdminRecord, SubjectKind, UserRecord } from '../types/auth.types';
import {
  issueRefreshToken,
  revokeAllForSubjectAllKinds,
  signAccessToken,
  type IssuedTokens,
} from './token.service';
import type { RegisterInput } from '../validators/schemas';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
};

/**
 * Parola hash'i — ortak Argon2id ayarlarıyla (app_security §7).
 * Şifre sıfırlama gibi diğer servisler de aynı politikayı kullanır.
 */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Admin kendi parolasını değiştirir — mevcut parola doğrulaması zorunlu.
 */
export async function changeAdminPassword(
  adminId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const admin = await dbOne('SELECT id, password_hash FROM admins WHERE id = ? AND status = 1', [adminId]) as { id: string; password_hash: string } | undefined;
  if (!admin) {
    throw new HttpError(404, 'Yönetici bulunamadı.', 'ADMIN_NOT_FOUND');
  }
  const ok = await argon2.verify(admin.password_hash, currentPassword).catch(() => false);
  if (!ok) {
    throw new HttpError(400, 'Mevcut parola yanlış.', 'INVALID_CURRENT_PASSWORD');
  }
  const passwordHash = await hashPassword(newPassword);
  await dbRun('UPDATE admins SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash, adminId]);
}

type SubjectRecord = UserRecord | AdminRecord;

function tableFor(kind: SubjectKind): 'users' | 'admins' {
  return kind === 'admin' ? 'admins' : 'users';
}

/** Yönetişim kind'ı (danisman/arge) için user kaydının governance_role'ü eşleşmeli. */
function expectedGovernanceRoleFor(kind: SubjectKind): 'analitik_danisman' | 'yz_arge' | 'izleyici' | null {
  if (kind === 'danisman') return 'analitik_danisman';
  if (kind === 'arge') return 'yz_arge';
  if (kind === 'izleyici') return 'izleyici';
  return null;
}

async function findSubjectByEmail(kind: SubjectKind, email: string): Promise<SubjectRecord | undefined> {
  const table = tableFor(kind);
  const sql = `SELECT * FROM ${table} WHERE email = ? AND status = 1 LIMIT 1`;
  return await dbOne(sql, [email]) as SubjectRecord | undefined;
}

function isLocked(record: SubjectRecord): boolean {
  if (!record.locked_until) return false;
  return new Date(record.locked_until).getTime() > Date.now();
}

async function incrementFailedLogin(kind: SubjectKind, id: string, currentFails: number): Promise<void> {
  const table = tableFor(kind);
  const newCount = currentFails + 1;
  const shouldLock = newCount >= config.maxLoginAttempts;
  const lockUntil = shouldLock
    ? new Date(Date.now() + config.loginLockoutMinutes * 60_000).toISOString()
    : null;

  await dbRun(`UPDATE ${table}
       SET failed_login_count = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [newCount, lockUntil, id]);
}

async function resetFailedLogin(kind: SubjectKind, id: string): Promise<void> {
  const table = tableFor(kind);
  await dbRun(`UPDATE ${table}
       SET failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [id]);
}

export interface LoginResult {
  tokens: IssuedTokens;
  subject: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    governanceRole?: 'analitik_danisman' | 'yz_arge' | 'izleyici' | null;
  };
  locked: boolean;
}

const GENERIC_AUTH_ERROR = 'E-posta veya parola hatalı.';

export async function login(
  kind: SubjectKind,
  email: string,
  password: string
): Promise<LoginResult> {
  const record = await findSubjectByEmail(kind, email);

  if (!record) {
    // Side channel timing leak'i azaltmak için yine de argon2 hesaplaması yap.
    await argon2.hash('decoy_password_for_timing_protection', ARGON2_OPTIONS);
    throw new HttpError(401, GENERIC_AUTH_ERROR, 'AUTH_FAILED');
  }

  if (isLocked(record)) {
    throw new HttpError(
      423,
      'Hesabınız geçici olarak kilitlendi. Lütfen daha sonra tekrar deneyin.',
      'ACCOUNT_LOCKED'
    );
  }

  let passwordOk = false;
  try {
    passwordOk = await argon2.verify(record.password_hash, password);
  } catch {
    passwordOk = false;
  }

  if (!passwordOk) {
    await incrementFailedLogin(kind, record.id, record.failed_login_count);
    throw new HttpError(401, GENERIC_AUTH_ERROR, 'AUTH_FAILED');
  }

  await resetFailedLogin(kind, record.id);

  const governanceRole =
    kind === 'user' ? (record as UserRecord).governance_role ?? null : undefined;

  const accessPayload = {
    sub: record.id,
    role: record.role,
    email: record.email,
    ...(governanceRole !== undefined ? { governanceRole } : {}),
  };

  const { token: accessToken, ttl } = signAccessToken(kind, accessPayload);
  const { token: refreshToken } = await issueRefreshToken(kind, record.id);

  return {
    tokens: { accessToken, refreshToken, expiresIn: ttl },
    subject: {
      id: record.id,
      email: record.email,
      fullName: record.full_name,
      role: record.role,
      ...(governanceRole !== undefined ? { governanceRole } : {}),
    },
    locked: false,
  };
}

/**
 * Yeni kullanıcı kaydı (yalnızca 'user' rolü).
 *
 * Güvenlik (app_security §8 — account enumeration):
 * - Admin kaydı bu endpoint üzerinden YAPILAMAZ — sadece users tablosuna yazar.
 * - Aynı e-posta hem users hem admins tablosunda bulunmamalıdır.
 * - Argon2id ile hash; parola politikası schema tarafında uygulanır.
 * - Transaction içinde unique kontrol + insert (race condition koruması).
 * - **E-posta zaten alınmışsa GENERIC hata döner** (saldırgan hangi e-postaların
 *   sistemde olduğunu enum edemez). Gerçek sebep (EMAIL_TAKEN) HttpError.code'unda
 *   kalır — audit log'a yazılır ama kullanıcıya gönderilen mesajda yer almaz.
 * - Timing leak'i azaltmak için e-posta var olsa bile decoy argon2 hesabı yapılır.
 */
const GENERIC_REGISTER_ERROR =
  'Kayıt tamamlanamadı. Mevcut hesabınız varsa lütfen giriş yapın.';

export async function registerUser(input: RegisterInput): Promise<{ id: string; email: string; fullName: string }> {
  const normalizedEmail = input.email.trim().toLowerCase();

  // 1) Çakışma kontrolü — hem admins hem users tablosunda
  const existingAdmin = await dbOne('SELECT id FROM admins WHERE email = ? LIMIT 1', [normalizedEmail]);
  const existingUser = !existingAdmin
    ? await dbOne('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail])
    : null;

  if (existingAdmin || existingUser) {
    // Timing protection: yeni kayıt sırasında argon2 hash çalışır; e-posta zaten
    // alınmış durumda da aynı süreyi tüketmek için decoy hash çalıştır.
    await argon2.hash('decoy_for_timing_protection_' + normalizedEmail, ARGON2_OPTIONS);
    throw new HttpError(409, GENERIC_REGISTER_ERROR, 'EMAIL_TAKEN');
  }

  // 2) Parola hash
  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

  // 3) Insert — governance_role HER ZAMAN NULL. Atama yalnız admin yapabilir
  // (SECURITY C2). Self-service registration ile governance role alınamaz.
  const id = nanoid();
  try {
    await dbRun(`INSERT INTO users (id, email, password_hash, full_name, role, status, governance_role)
       VALUES (?, ?, ?, ?, 'user', 1, NULL)`, [id,
      normalizedEmail,
      passwordHash,
      input.fullName.trim()]);
  } catch (err) {
    // UNIQUE constraint çakışması (yarış durumu) — yine generic mesaj.
    // PostgreSQL unique_violation SQLSTATE kodu: 23505 (#7 — pg-only).
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, GENERIC_REGISTER_ERROR, 'EMAIL_TAKEN');
    }
    throw err;
  }

  return { id, email: normalizedEmail, fullName: input.fullName.trim() };
}

/**
 * Auth lookup cache — findSubjectById HER authenticated istekte çağrılır;
 * SELECT * ile 200KB'a varan profile_photo dahil tüm satırı çekiyordu.
 * Kısa TTL'li cache + dar kolon listesi: DB yükü ve payload düşer.
 * Kullanıcıyı etkileyen admin işlemleri (devre dışı bırakma, rol değişimi,
 * purge) invalidateSubjectCache ile anında düşürür.
 */
const SUBJECT_CACHE_TTL_MS = 30_000;
const subjectCache = new Map<string, { row: SubjectRecord | undefined; expiresAt: number }>();

export function invalidateSubjectCache(id?: string): void {
  if (!id) {
    subjectCache.clear();
    return;
  }
  for (const key of subjectCache.keys()) {
    if (key.endsWith(`:${id}`)) subjectCache.delete(key);
  }
}

export async function findSubjectById(kind: SubjectKind, id: string): Promise<SubjectRecord | undefined> {
  const cacheKey = `${kind}:${id}`;
  const cached = subjectCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  const table = tableFor(kind);
  // Yalnız auth katmanının ihtiyaç duyduğu kolonlar — profile_photo/bio gibi
  // büyük alanlar BİLİNÇLİ dışarıda (gereken yer kendisi çeker).
  // governance_role HER İKİ tabloda da var (users + admins). Admin için de SELECT
  // edilmeli: aksi halde requireGovernanceRole admin'lerde daima undefined görür →
  // yz_arge/analitik_danisman atanmış admin governance-onay ucundan 403 alır.
  const cols = 'id, email, full_name, role, status, locked_until, failed_login_count, governance_role';
  const row = await dbOne(`SELECT ${cols} FROM ${table} WHERE id = ? AND status = 1 LIMIT 1`, [id]) as SubjectRecord | undefined;

  let result: SubjectRecord | undefined = row;
  if (row) {
    // Yönetişim kind'ları için governance_role eşleşmesi şart — DB'de role
    // değiştirilmişse eski token geçersizleşir.
    const expectedRole = expectedGovernanceRoleFor(kind);
    if (expectedRole !== null) {
      const actual = (row as UserRecord).governance_role ?? null;
      if (actual !== expectedRole) result = undefined;
    }
    // Normal user için governance_role NULL olmalı; varsa danisman/arge kind'ına
    // yönlendirilmiş, 'user' token'ı yanlış kişide.
    if (kind === 'user') {
      const actual = (row as UserRecord).governance_role ?? null;
      if (actual !== null) result = undefined;
    }
  }

  subjectCache.set(cacheKey, { row: result, expiresAt: Date.now() + SUBJECT_CACHE_TTL_MS });
  return result;
}

/**
 * Unified login: aynı e-posta önce admins'te, sonra users'ta aranır.
 * Timing-safe: kullanıcı bulunmasa bile decoy argon2 hash hesaplanır.
 *
 * Güvenlik notları:
 * - Admin/User tabloları AYRI (data izolasyonu korunur).
 * - Aynı e-posta her iki tabloda olsa bile yalnızca İLK eşleşme (admin) auth eder.
 *   Bu admin önceliği kasıtlı: aynı kişi hem admin hem user olarak listelenmişse
 *   yüksek yetki için yetkilendirilir.
 * - JWT key pair, audience ve refresh token paneli hala AYRI (cross-token bypass yok).
 */
export async function unifiedLogin(email: string, password: string): Promise<LoginResult & { kind: SubjectKind }> {
  // 1) Admin tablosunda dene
  const adminRecord = await findSubjectByEmail('admin', email);
  if (adminRecord) {
    if (isLocked(adminRecord)) {
      throw new HttpError(
        423,
        'Hesabınız geçici olarak kilitlendi. Lütfen daha sonra tekrar deneyin.',
        'ACCOUNT_LOCKED'
      );
    }
    const ok = await argon2.verify(adminRecord.password_hash, password).catch(() => false);
    if (ok) {
      await resetFailedLogin('admin', adminRecord.id);
      // Tek-aktif-oturum politikası (C1 savunması): yeni login → eski refresh
      // token'ları (her kind'da) revoke.
      await revokeAllForSubjectAllKinds(adminRecord.id);
      const accessPayload = { sub: adminRecord.id, role: adminRecord.role, email: adminRecord.email };
      const { token: accessToken, ttl } = signAccessToken('admin', accessPayload);
      const { token: refreshToken } = await issueRefreshToken('admin', adminRecord.id);
      return {
        kind: 'admin',
        tokens: { accessToken, refreshToken, expiresIn: ttl },
        subject: { id: adminRecord.id, email: adminRecord.email, fullName: adminRecord.full_name, role: adminRecord.role },
        locked: false,
      };
    }
    await incrementFailedLogin('admin', adminRecord.id, adminRecord.failed_login_count);
    // Don't fall through to user table — admin password failure is final
    throw new HttpError(401, GENERIC_AUTH_ERROR, 'AUTH_FAILED');
  }

  // 2) User tablosunda dene
  const userRecord = await findSubjectByEmail('user', email);
  if (!userRecord) {
    // Hiçbir tabloda yok — yine de decoy hash (timing protection)
    await argon2.hash('decoy_password_for_timing_protection', ARGON2_OPTIONS);
    throw new HttpError(401, GENERIC_AUTH_ERROR, 'AUTH_FAILED');
  }

  if (isLocked(userRecord)) {
    throw new HttpError(
      423,
      'Hesabınız geçici olarak kilitlendi. Lütfen daha sonra tekrar deneyin.',
      'ACCOUNT_LOCKED'
    );
  }

  const ok = await argon2.verify(userRecord.password_hash, password).catch(() => false);
  if (!ok) {
    await incrementFailedLogin('user', userRecord.id, userRecord.failed_login_count);
    throw new HttpError(401, GENERIC_AUTH_ERROR, 'AUTH_FAILED');
  }

  await resetFailedLogin('user', userRecord.id);
  // Tek-aktif-oturum politikası (C1 savunması): yeni login → tüm eski refresh
  // token'lar (her kind) revoke. Demo+intranet senaryosunda multi-device beklenmediği
  // için ek güvenlik olarak tek aktif oturum tutulur.
  await revokeAllForSubjectAllKinds(userRecord.id);
  const governanceRole = (userRecord as UserRecord).governance_role ?? null;
  // Yönetişim rolüne göre token kind'ı belirlenir — danisman/arge için ayrı
  // audience'lı token üretilir, bu token user/admin endpoint'lerinde geçmez.
  const effectiveKind: SubjectKind =
    governanceRole === 'analitik_danisman'
      ? 'danisman'
      : governanceRole === 'yz_arge'
        ? 'arge'
        : governanceRole === 'izleyici'
          ? 'izleyici'
          : 'user';
  const accessPayload = {
    sub: userRecord.id,
    role: userRecord.role,
    email: userRecord.email,
    governanceRole,
  };
  const { token: accessToken, ttl } = signAccessToken(effectiveKind, accessPayload);
  const { token: refreshToken } = await issueRefreshToken(effectiveKind, userRecord.id);
  return {
    kind: effectiveKind,
    tokens: { accessToken, refreshToken, expiresIn: ttl },
    subject: {
      id: userRecord.id,
      email: userRecord.email,
      fullName: userRecord.full_name,
      role: userRecord.role,
      governanceRole,
    },
    locked: false,
  };
}
