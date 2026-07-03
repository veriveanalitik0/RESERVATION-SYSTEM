/**
 * Uygulama seviyesi simetrik şifreleme (AES-256-GCM) — at-rest hassas sırlar için
 * (ör. admin TOTP secret). DB sızıntısında bu değerler düz metin OKUNAMAZ.
 *
 * Anahtar kaynağı (öncelik sırası):
 *  1) ENCRYPTION_KEY env — 64 haneli hex (32 byte) veya passphrase (scrypt ile türetilir).
 *  2) Yoksa CSRF_SECRET'tan domain-ayrımlı scrypt türevi (ayrı ENCRYPTION_KEY önerilir).
 *
 * Format: "enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>" (base64 ':' içermez → güvenli split).
 * Geriye dönük uyumluluk: prefix taşımayan değerler DÜZ METİN kabul edilir
 * (mevcut kayıtlar okunmaya devam eder; bir sonraki yazımda şifrelenir).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config/env';

const PREFIX = 'enc:v1:';
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (raw) {
    cachedKey = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : scryptSync(raw, 'klab-encryption-salt', 32);
  } else {
    // Dedike anahtar yoksa CSRF_SECRET'tan ayrı bir amaç (info) ile türet.
    cachedKey = scryptSync(config.csrfSecret, 'klab-at-rest-secret-enc', 32);
  }
  return cachedKey;
}

/** Düz metni AES-256-GCM ile şifreler ve taşınabilir string döner. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12); // GCM için 96-bit nonce
  const cipher = createCipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Şifreli string'i çözer. Prefix yoksa (eski kayıt) değer aynen döner. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const parts = stored.split(':'); // ['enc','v1', iv, tag, ct]
  const ivB64 = parts[2];
  const tagB64 = parts[3];
  const ctB64 = parts[4];
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Bozuk şifreli değer.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
