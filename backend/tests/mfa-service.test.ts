/**
 * MFA (admin TOTP + backup code) servisi — güvenlik testleri.
 *
 * Odak: backup code'ların DB'de PLAIN değil argon2 HASH olarak saklanması ve
 * tek-kullanımlık tüketimi (production hardening, CWE-312/CWE-522 koruması).
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun, dbOne } from '../src/db/schema';
import { enrollMfa, verifyMfaCode, getMfaStatus } from '../src/services/mfa.service';

const ADMIN = nanoid();

beforeAll(async () => {
  await initSchema();
  const hash = await argon2.hash('AdminPass1234!');
  await dbRun(`INSERT INTO admins (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)`, [
    ADMIN, `mfa-${ADMIN}@test.local`, hash, 'MFA Admin', 'admin',
  ]);
});

afterAll(async () => {
  await dbRun('DELETE FROM admins WHERE id = ?', [ADMIN]);
  await closeDb();
});

describe('MFA backup code güvenliği', () => {
  it('enroll: kullanıcıya 8 plain kod döner ama DB sadece argon2 hash saklar', async () => {
    const res = await enrollMfa(ADMIN);
    expect(res.backupCodes).toHaveLength(8);
    // Plain kodlar XXXX-XXXX formatında (karışıklık yaratan I/O/0/1 hariç).
    for (const c of res.backupCodes) {
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }

    const row = (await dbOne('SELECT totp_backup_codes FROM admins WHERE id = ?', [ADMIN])) as {
      totp_backup_codes: string;
    };
    const stored = JSON.parse(row.totp_backup_codes) as string[];

    // KRİTİK: saklanan değerler argon2 hash ($argon2...) — plain kod DB'de YOK.
    expect(stored).toHaveLength(8);
    for (const s of stored) {
      expect(s.startsWith('$argon2')).toBe(true);
    }
    for (const plain of res.backupCodes) {
      expect(row.totp_backup_codes).not.toContain(plain);
    }
  });

  it('verify: geçerli backup code çalışır ve tek-kullanımlıktır (ikinci kez reddedilir)', async () => {
    const res = await enrollMfa.call(null, ADMIN).catch(() => null);
    // enroll zaten etkinse yeniden enroll 409 verir; bu testte taze kod üret:
    // önce MFA'yı sıfırla.
    await dbRun('UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?', [ADMIN]);
    const fresh = await enrollMfa(ADMIN);
    const code = fresh.backupCodes[0]!;

    const before = await getMfaStatus(ADMIN);
    const first = await verifyMfaCode(ADMIN, code);
    expect(first).toEqual({ valid: true, usedBackupCode: true });

    // Tüketildi → ikinci kullanım reddedilir.
    const second = await verifyMfaCode(ADMIN, code);
    expect(second.valid).toBe(false);

    // Kalan sayaç bir azaldı (8 → 7).
    const after = await getMfaStatus(ADMIN);
    expect(after.backupCodesRemaining).toBe(before.backupCodesRemaining - 1);
    void res;
  });

  it('verify: yanlış backup code reddedilir', async () => {
    const bad = await verifyMfaCode(ADMIN, 'ZZZZ-ZZZZ');
    expect(bad.valid).toBe(false);
  });
});
