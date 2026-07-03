/**
 * Görsel saklama / proxy katmanı (veri-yönetişimi).
 *
 * Amaç (banka veri-yönetişimi + provider bağımsızlığı):
 *  - Üretilen görsel 'ready' olunca SUNUCU TARAFINDA indirilip diske yazılır
 *    (backend/data/visuals/<id>_<seed>.<ext>). Böylece:
 *      1) Prompt artık client URL'inde AÇIKTA değil. Dış (Pollinations) URL'i
 *         prompt'u query string'inde taşır; iç URL ise yalnız id+seed içerir.
 *      2) Görsel, provider uptime'ından BAĞIMSIZ servis edilir (provider çökse
 *         bile saklanan baytlar serve edilir).
 *  - İndirme başarısızsa (provider çökük) çağıran dış URL'de KALIR (graceful
 *    fallback) — bu servis sadece null döner, hata fırlatmaz.
 *
 * Güvenlik:
 *  - Path traversal koruması: id + seed katı regex/integer ile doğrulanır,
 *    dosya adı yalnız doğrulanmış parçalardan kurulur (app_security.md §3).
 *  - Yalnız image/* content-type kabul edilir (SSRF/içerik enjeksiyonu azaltma).
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';

/** Saklama klasörü — process.cwd() backend kökü (data/klab.db ile aynı kök). */
const VISUALS_DIR = path.join(process.cwd(), 'data', 'visuals');

/** Provider'dan indirme zaman aşımı (Pollinations yavaş olabilir). */
const DOWNLOAD_TIMEOUT_MS = 25_000;

/** Saklanabilecek maksimum görsel boyutu (kötü amaçlı/dev dosya koruması). */
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

/** content-type → uzantı eşlemesi (kabul edilen görsel türleri). */
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** uzantı → content-type (serve ederken). */
const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** Olası uzantılar — serve ederken dosyayı bulmak için denenir. */
const KNOWN_EXTS = ['jpg', 'png', 'webp', 'gif', 'avif', 'jpeg'];

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** id güvenli mi (nanoid karakter kümesi: A-Za-z0-9_-). */
export function isSafeVisualId(id: string): boolean {
  return ID_RE.test(id);
}

/** seed'i güvenli, negatif olmayan tamsayıya çevirir; geçersizse null. */
export function safeSeed(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

/** Saklanan dosyanın mutlak yolu (parçalar doğrulanmış olmalı). */
function storedPath(id: string, seed: number, ext: string): string {
  return path.join(VISUALS_DIR, `${id}_${seed}.${ext}`);
}

/**
 * id + seed için saklanan görselin iç (prompt'suz) URL'i.
 * Relatif URL — frontend vite proxy / prod reverse-proxy üzerinden backend'e gider.
 */
export function internalImageUrl(id: string, seed: number): string {
  return `/api/public/visuals/${id}/image?v=${seed}`;
}

/**
 * downloadAndStore sonucu:
 *  - ok=true  → diske yazıldı (iç URL kullanılabilir).
 *  - ok=false, reason='auth'      → 401/402/403: sağlayıcı kimlik/ödeme istiyor
 *    (KALICI; token gerekir). Çağıran bunu kullanıcıya hata olarak göstermeli.
 *  - ok=false, reason='transient' → zaman aşımı / 5xx / ağ / içerik hatası
 *    (GEÇİCİ; dış URL'de fallback mantıklı, sonra tekrar denenebilir).
 */
export type StoreResult =
  | { ok: true; ext: string }
  | { ok: false; reason: 'auth' | 'transient' };

/**
 * Verilen görseli provider URL'inden indirir ve diske yazar.
 *
 * Pollinations token (POLLINATIONS_TOKEN) varsa `Authorization: Bearer` ile
 * gönderilir — token YALNIZ sunucu tarafında kalır, client URL'ine sızmaz
 * (Pollinations güvenlik kılavuzu: token'ı public URL'de gösterme). Anonim
 * erişim 402 (ödeme) verdiğinden token'sız üretim 'auth' hatasıyla döner.
 */
export async function downloadAndStore(
  id: string,
  seed: number,
  sourceUrl: string
): Promise<StoreResult> {
  if (!isSafeVisualId(id) || safeSeed(seed) === null) return { ok: false, reason: 'transient' };

  const headers: Record<string, string> = { Accept: 'image/*' };
  const token = process.env.POLLINATIONS_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers,
    });
    if (!res.ok) {
      // 401/402/403 → kimlik/ödeme (kalıcı); diğer HTTP hataları → geçici.
      const reason = res.status === 401 || res.status === 402 || res.status === 403 ? 'auth' : 'transient';
      return { ok: false, reason };
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const ext = CONTENT_TYPE_TO_EXT[contentType];
    if (!ext) return { ok: false, reason: 'transient' }; // yalnız görsel türleri

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return { ok: false, reason: 'transient' };

    await mkdir(VISUALS_DIR, { recursive: true, mode: 0o700 });
    await writeFile(storedPath(id, seed, ext), buf);
    return { ok: true, ext };
  } catch {
    // Zaman aşımı / ağ hatası → geçici (dış URL'de fallback).
    return { ok: false, reason: 'transient' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider'ın doğrudan döndürdüğü görsel baytlarını (Hugging Face / Gemini)
 * diske yazar — harici URL'den indirme yok. content-type doğrulanır.
 */
export async function storeBytes(
  id: string,
  seed: number,
  data: Buffer,
  contentType: string
): Promise<StoreResult> {
  if (!isSafeVisualId(id) || safeSeed(seed) === null) return { ok: false, reason: 'transient' };

  const ext = CONTENT_TYPE_TO_EXT[contentType.split(';')[0]!.trim().toLowerCase()];
  if (!ext) return { ok: false, reason: 'transient' };
  if (data.byteLength === 0 || data.byteLength > MAX_BYTES) return { ok: false, reason: 'transient' };

  try {
    await mkdir(VISUALS_DIR, { recursive: true, mode: 0o700 });
    await writeFile(storedPath(id, seed, ext), data);
    return { ok: true, ext };
  } catch {
    return { ok: false, reason: 'transient' };
  }
}

/**
 * Bir görsele ait TÜM saklanan dosyaları siler (<id>_<seed>.<ext> — tüm
 * varyantlar). Görsel silinince diskte yetim dosya kalmasın. Best-effort:
 * dosya yoksa/silinemezse sessizce geçer.
 */
export async function deleteStoredFiles(id: string): Promise<void> {
  if (!isSafeVisualId(id)) return;
  let entries: string[];
  try {
    entries = await readdir(VISUALS_DIR);
  } catch {
    return; // dizin yoksa silinecek bir şey de yok
  }
  const prefix = `${id}_`;
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => unlink(path.join(VISUALS_DIR, name)).catch(() => undefined))
  );
}

/** Saklanan dosyayı (id+seed) bulur; yoksa null. */
async function findStored(id: string, seed: number): Promise<{ absPath: string; contentType: string; size: number } | null> {
  for (const ext of KNOWN_EXTS) {
    const p = storedPath(id, seed, ext);
    try {
      const s = await stat(p);
      if (s.isFile()) {
        return { absPath: p, contentType: EXT_TO_CONTENT_TYPE[ext] ?? 'application/octet-stream', size: s.size };
      }
    } catch {
      /* sıradaki uzantı */
    }
  }
  return null;
}

/**
 * Saklanan görseli HTTP yanıtı olarak serve eder.
 * Dosya bulunursa true (yanıt yazıldı), yoksa false (çağıran 404 versin).
 */
export async function serveStoredImage(res: Response, id: string, seed: number): Promise<boolean> {
  if (!isSafeVisualId(id)) return false;
  const found = await findStored(id, seed);
  if (!found) return false;

  // İkinci stat YOK (TOCTOU): eşzamanlı silmede ENOENT 500'e dönüşüyordu —
  // findStored'un stat sonucundaki boyut kullanılır; silinme yarışı stream
  // error handler'ında zaten ele alınır.
  res.setHeader('Content-Type', found.contentType);
  res.setHeader('Content-Length', String(found.size));
  // (id, seed) → sabit baytlar → uzun süreli, immutable cache.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return await new Promise<boolean>((resolve) => {
    const stream = createReadStream(found.absPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500);
      res.end();
      resolve(true); // yanıt sonlandı (hata da olsa çağıran 404 atmamalı)
    });
    stream.on('end', () => resolve(true));
    stream.pipe(res);
  });
}
