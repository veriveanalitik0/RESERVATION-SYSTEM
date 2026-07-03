/**
 * Profil fotoğrafı upload servisi.
 *
 * Demo amaçlı: küçük (max 200KB) JPEG, base64 data URL formatında DB'de saklanır.
 * Production'da object storage (S3 + presigned URL + CDN) tercih edilir.
 *
 * Güvenlik (app_security §3, §6):
 * - Sadece JPEG (image/jpeg) kabul; PNG/SVG yasak (SVG XSS riski).
 * - Gerçek bytes'tan SOI (FF D8 FF) + EOI (FF D9) marker doğrulanır
 *   (base64 prefix tek başına yetmez — saldırgan "data:image/jpeg;base64,"
 *   ile başlayıp bytes'ta başka format gönderebilirdi).
 * - Boyut limiti server tarafta (max 200KB) gerçek byte uzunluğunda.
 * - data URL prefix doğrulanır.
 * - User sadece kendi profilini değiştirir (IDOR koruması route'ta).
 * - Render: <img> tag ile gösterilir; XSS taşımaz çünkü browser data:image/jpeg
 *   olarak yorumlar. Helmet noSniff (X-Content-Type-Options: nosniff) zaten
 *   MIME-type sniffing'i engelliyor.
 */
import { dbOne, dbRun } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { recordAudit } from './audit.service';

const MAX_BYTES = 200 * 1024; // 200 KB
const JPEG_PREFIX = 'data:image/jpeg;base64,';

/**
 * Base64 data URL kabul eder, gerçek bytes'ta JPEG SOI/EOI marker doğrular,
 * boyutu kontrol eder. Throws HttpError validasyon başarısız ise.
 */
export function validateJpegDataUrl(dataUrl: string): void {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(JPEG_PREFIX)) {
    throw new HttpError(400, 'Yalnızca JPEG formatı kabul edilir.', 'VALIDATION');
  }
  const base64 = dataUrl.slice(JPEG_PREFIX.length);
  if (base64.length === 0) {
    throw new HttpError(400, 'Boş resim verisi.', 'VALIDATION');
  }

  // Base64 → gerçek bytes decode et (tahmin yerine kesin)
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw new HttpError(400, 'Geçersiz base64 verisi.', 'VALIDATION');
  }

  // Boyut sınırı — gerçek byte uzunluğu (tahmin değil)
  if (bytes.length > MAX_BYTES) {
    throw new HttpError(
      413,
      `Dosya çok büyük. Maksimum ${Math.round(MAX_BYTES / 1024)}KB JPEG.`,
      'VALIDATION'
    );
  }
  if (bytes.length < 10) {
    throw new HttpError(400, 'Resim verisi çok kısa.', 'VALIDATION');
  }

  // SOI (Start of Image): FF D8 FF — JPEG'in mutlak ilk 3 byte'ı
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new HttpError(400, 'Geçersiz JPEG dosyası (SOI marker eksik).', 'VALIDATION');
  }

  // EOI (End of Image): FF D9 — JPEG'in mutlak son 2 byte'ı
  // Truncated/partial JPEG'leri ve trailing-data bombalarını engeller.
  const len = bytes.length;
  if (bytes[len - 2] !== 0xff || bytes[len - 1] !== 0xd9) {
    throw new HttpError(400, 'Geçersiz JPEG dosyası (EOI marker eksik).', 'VALIDATION');
  }
}

export async function setUserProfilePhoto(userId: string, dataUrl: string): Promise<void> {
  validateJpegDataUrl(dataUrl);
  const existing = await dbOne('SELECT id FROM users WHERE id = ? AND status != 3', [userId]);
  if (!existing) {
    throw new HttpError(404, 'Kullanıcı bulunamadı.', 'USER_NOT_FOUND');
  }
  await dbRun(`UPDATE users SET profile_photo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [dataUrl, userId]);

  recordAudit({
    eventType: 'user.photo_uploaded',
    subjectId: userId,
    subjectType: 'user',
    success: true,
    details: { sizeKb: Math.round((dataUrl.length * 3) / 4 / 1024) },
  });
}

export async function clearUserProfilePhoto(userId: string): Promise<void> {
  await dbRun(`UPDATE users SET profile_photo = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [userId]);

  recordAudit({
    eventType: 'user.photo_uploaded',
    subjectId: userId,
    subjectType: 'user',
    success: true,
    details: { action: 'cleared' },
  });
}

export async function getUserProfilePhoto(userId: string): Promise<string | null> {
  const row = await dbOne('SELECT profile_photo FROM users WHERE id = ? AND status != 3', [userId]) as { profile_photo: string | null } | undefined;
  return row?.profile_photo ?? null;
}
