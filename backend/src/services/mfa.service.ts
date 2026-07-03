/**
 * Admin MFA (TOTP — RFC 6238) servisi.
 *
 * Güvenlik:
 * - speakeasy: TOTP generate + verify (RFC 6238, SHA-1, 30s window, 6 digit).
 * - Secret base32 → DB'ye AES-256-GCM ŞİFRELİ yazılır (utils/crypto); düz metin
 *   saklanmaz. Doğrulamada çözülür. Eski düz-metin kayıtlar geriye dönük okunur.
 * - Backup code: 8 adet tek-kullanımlık kod. Kullanıcıya bir kez düz gösterilir,
 *   DB'de yalnız argon2 HASH'leri saklanır (plain saklanmaz). Doğrulamada her
 *   hash'e karşı argon2.verify denenir; eşleşen hash diziden silinir (tek-kullanım).
 * - Time skew tolerance: ±1 window (30s).
 * - app_security.md §4: Admin için MFA önerilir (henüz zorunlu değil — opt-in).
 */
import { randomInt } from 'node:crypto';
import argon2 from 'argon2';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { dbOne, dbRun } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { encryptSecret, decryptSecret } from '../utils/crypto';

export interface MfaEnrollResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

export interface MfaStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

const ISSUER = 'KLAB-Randevu';

// Backup code segmenti: 4 karakterlik, karışıklık yaratan harfler (I/O/0/1) hariç
// büyük harf+rakam alfabesinden kriptografik rastgele seçim.
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function backupCodeSegment(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
  return s;
}

async function getAdminRow(
  adminId: string
): Promise<{ id: string; email: string; totp_secret: string | null; totp_enabled: number; totp_backup_codes: string | null }> {
  const row = await dbOne('SELECT id, email, totp_secret, totp_enabled, totp_backup_codes FROM admins WHERE id = ? AND status = 1', [adminId]) as
    | {
        id: string;
        email: string;
        totp_secret: string | null;
        totp_enabled: number;
        totp_backup_codes: string | null;
      }
    | undefined;
  if (!row) throw new HttpError(404, 'Admin bulunamadı.', 'SUBJECT_NOT_FOUND');
  return row;
}

export async function enrollMfa(adminId: string): Promise<MfaEnrollResult> {
  const row = await getAdminRow(adminId);
  if (row.totp_enabled === 1) {
    throw new HttpError(409, 'MFA zaten etkin.', 'MFA_ALREADY_ENABLED');
  }

  const secret = speakeasy.generateSecret({
    name: `${ISSUER}:${row.email}`,
    issuer: ISSUER,
    length: 20,
  });

  // Backup code'lar (8 adet 8-haneli kod). Bunlar MFA bypass için kullanılan
  // kimlik doğrulama sırlarıdır → kriptografik olarak güvenli üreteç şart
  // (Math.random öngörülebilir — CWE-338). crypto.randomInt ile uniform seçim.
  const backupCodes: string[] = [];
  for (let i = 0; i < 8; i++) {
    backupCodes.push(`${backupCodeSegment()}-${backupCodeSegment()}`);
  }

  // Backup code'lar DB'ye YALNIZ argon2 hash olarak yazılır (plain saklanmaz).
  // Kullanıcı plain kodları yalnız bu yanıtta bir kez görür.
  const hashedCodes = await Promise.all(backupCodes.map((c) => argon2.hash(c)));

  // Secret + backup code hash'leri DB'ye yazılır — ancak totp_enabled hâlâ 0
  // (kullanıcı 6-digit ile verify edene kadar aktif değil). TOTP secret at-rest
  // AES-256-GCM ile şifrelenir (DB sızıntısında MFA taklit edilemesin, CWE-312).
  await dbRun('UPDATE admins SET totp_secret = ?, totp_backup_codes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [encryptSecret(secret.base32), JSON.stringify(hashedCodes), adminId]);

  const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url ?? '');

  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url ?? '',
    qrCodeDataUrl,
    backupCodes,
  };
}

/**
 * 6 haneli kodu (veya backup kodu) doğrula.
 * - İlk verify enroll'u tamamlar (totp_enabled = 1)
 * - Sonraki verify'lar normal MFA challenge.
 */
export async function verifyMfaCode(
  adminId: string,
  code: string
): Promise<{ valid: boolean; usedBackupCode: boolean }> {
  const row = await getAdminRow(adminId);
  if (!row.totp_secret) {
    throw new HttpError(409, 'MFA henüz başlatılmadı.', 'MFA_NOT_ENABLED');
  }

  // Önce TOTP — secret at-rest şifreli; doğrulama için çöz (eski düz-metin
  // kayıtlar decryptSecret tarafından aynen döndürülür → geriye dönük uyumlu).
  const ok = speakeasy.totp.verify({
    secret: decryptSecret(row.totp_secret),
    encoding: 'base32',
    token: code,
    window: 1, // ±30s tolerans
  });

  if (ok) {
    // İlk verify: enrollment'ı tamamla
    if (row.totp_enabled === 0) {
      await dbRun('UPDATE admins SET totp_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [adminId]);
    }
    return { valid: true, usedBackupCode: false };
  }

  // Backup code denemesi — saklananlar argon2 HASH'leri; gelen kodu her hash'e
  // karşı argon2.verify ile dene. Eşleşen hash silinir (tek-kullanımlık).
  if (row.totp_backup_codes) {
    let hashes: string[] = [];
    try {
      hashes = JSON.parse(row.totp_backup_codes) as string[];
    } catch {
      hashes = [];
    }
    const candidate = code.toUpperCase().trim();
    for (let i = 0; i < hashes.length; i++) {
      const match = await argon2.verify(hashes[i]!, candidate).catch(() => false);
      if (match) {
        hashes.splice(i, 1);
        await dbRun('UPDATE admins SET totp_backup_codes = ?, totp_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(hashes), adminId]);
        return { valid: true, usedBackupCode: true };
      }
    }
  }

  return { valid: false, usedBackupCode: false };
}

export async function disableMfa(adminId: string): Promise<void> {
  const row = await getAdminRow(adminId);
  if (row.totp_enabled === 0) {
    throw new HttpError(409, 'MFA zaten devre dışı.', 'MFA_NOT_ENABLED');
  }
  await dbRun('UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [adminId]);
}

export async function getMfaStatus(adminId: string): Promise<MfaStatus> {
  const row = await getAdminRow(adminId);
  let remaining = 0;
  if (row.totp_backup_codes) {
    try {
      const arr = JSON.parse(row.totp_backup_codes) as string[];
      remaining = Array.isArray(arr) ? arr.length : 0;
    } catch {
      remaining = 0;
    }
  }
  return {
    enabled: row.totp_enabled === 1,
    backupCodesRemaining: remaining,
  };
}

export async function isMfaRequired(adminId: string): Promise<boolean> {
  const row = await dbOne('SELECT totp_enabled FROM admins WHERE id = ? AND status = 1', [adminId]) as { totp_enabled: number } | undefined;
  return !!row && row.totp_enabled === 1;
}
