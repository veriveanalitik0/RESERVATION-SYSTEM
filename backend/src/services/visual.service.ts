/**
 * Görsel üretim servisi (gorsel_uretim entegrasyonu).
 * Akış: fikir+tema → prompt enhance → provider üretir → DB'ye 'ready' yazılır.
 * Her görsel giriş yapan kullanıcıya bağlıdır (IDOR koruması: sahiplik kontrolü).
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { getImageProvider, variantSeed, translateToEnglish, type GeneratedImage } from './image-gen.service';
import { downloadAndStore, storeBytes, internalImageUrl, deleteStoredFiles } from './visual-store.service';
import { invalidateShowcaseFeed } from './showcase-feed.service';
import { broadcastToUser } from './sse.service';
// Paylaşılan DTO (backend↔frontend tek kaynak) — #6.
import type { VisualStatus, VisualVariant } from '@klab/shared';

export type { VisualStatus, VisualVariant };

export interface VisualDto {
  id: string;
  userId: string;
  roomId: string | null;
  fikir: string;
  tema: string | null;
  promptEn: string | null;
  imageUrl: string | null;
  seed: number | null;
  status: VisualStatus;
  errorMessage: string | null;
  variantIndex: number;
  variants: VisualVariant[];
  createdAt: string;
  updatedAt: string;
}

interface VisualRow {
  id: string;
  user_id: string;
  room_id: string | null;
  fikir: string;
  tema: string | null;
  prompt_en: string | null;
  image_url: string | null;
  seed: number | null;
  status: VisualStatus;
  error_message: string | null;
  variant_index: number;
  variants: string | null;
  created_at: string;
  updated_at: string;
}

function parseVariants(json: string | null): VisualVariant[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function rowToDto(r: VisualRow): VisualDto {
  return {
    id: r.id,
    userId: r.user_id,
    roomId: r.room_id,
    fikir: r.fikir,
    tema: r.tema,
    promptEn: r.prompt_en,
    imageUrl: r.image_url,
    seed: r.seed,
    status: r.status,
    errorMessage: r.error_message,
    variantIndex: r.variant_index,
    variants: parseVariants(r.variants),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function getRow(id: string): Promise<VisualRow | undefined> {
  return await dbOne('SELECT * FROM visuals WHERE id = ?', [id]) as VisualRow | undefined;
}

export async function getVisualForUser(userId: string, id: string): Promise<VisualDto | undefined> {
  const row = await getRow(id);
  if (!row || row.user_id !== userId) return undefined;
  return rowToDto(row);
}

export async function listMyVisuals(userId: string, limit = 24): Promise<VisualDto[]> {
  const rows = await dbAll('SELECT * FROM visuals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, Math.min(Math.max(limit, 1), 100)]) as VisualRow[];
  return rows.map(rowToDto);
}

export interface CreateVisualInput {
  fikir: string;
  tema?: string;
  roomId?: string;
}

export async function createVisual(userId: string, input: CreateVisualInput): Promise<VisualDto> {
  const id = nanoid();

  // Oda verildiyse geçerli mi? (opsiyonel bağ)
  const roomId = input.roomId
    ? ((await dbOne('SELECT id FROM rooms WHERE id = ? AND is_active = 1', [input.roomId]) as
        | { id: string }
        | undefined)?.id ?? null)
    : null;

  await dbRun(`INSERT INTO visuals (id, user_id, room_id, fikir, tema, status)
     VALUES (?, ?, ?, ?, ?, 'enhancing')`, [id, userId, roomId, input.fikir.trim(), input.tema?.trim() || null]);

  // Üretim arkaplanda — istek bloklanmaz (UX + timeout dayanıklılığı). Bitince
  // 'visual.updated' SSE event'i kullanıcıya push'lanır.
  void runVisualPipeline(userId, id, input.fikir, input.tema).catch((err) => {
    logger.error('visual_pipeline_unhandled', { id, err: (err as Error).message });
  });

  return (await getVisualForUser(userId, id))!; // status: 'enhancing'
}

/**
 * Üretilen görseli sunucuda saklamayı dener (veri-yönetişimi + provider
 * bağımsızlığı). İki provider türünü de işler:
 *  - Bayt dönen provider (Hugging Face / Gemini): baytları doğrudan diske yazar.
 *    Saklanamazsa dış URL fallback'i YOKTUR → çağıran hata göstermeli.
 *  - URL dönen provider (Pollinations): URL'i indirip saklar; saklanamazsa
 *    geçici hatada dış URL'de fallback, kalıcı (auth) hatada çağıran hata yapar.
 */
async function persistVariant(
  id: string,
  result: GeneratedImage
): Promise<{ url: string; stored: boolean; ext?: string; authError?: boolean }> {
  // Bayt dönen provider → doğrudan sakla (harici URL yok).
  if (result.data && result.contentType) {
    const stored = await storeBytes(id, result.seed, result.data, result.contentType);
    if (stored.ok) return { url: internalImageUrl(id, result.seed), stored: true, ext: stored.ext };
    // Saklanamadı + dış URL yok → boş URL döndür; çağıran 'stored=false && !url'
    // ile geçici hata gösterir (kullanıcı "Yeniden üret" diyebilir).
    return { url: '', stored: false };
  }

  // URL dönen provider → indir ve sakla.
  const dl = await downloadAndStore(id, result.seed, result.url);
  if (dl.ok) {
    return { url: internalImageUrl(id, result.seed), stored: true, ext: dl.ext };
  }
  // Saklanamadı: 'auth' (token/ödeme) KALICI, 'transient' (zaman aşımı/5xx)
  // geçici. İKİSİNDE DE dış URL fallback'i YOK: Pollinations URL'i prompt'u
  // (kullanıcı fikri+teması) içerir ve public kiosk/showcase'e sızardı.
  // Çağıran net hata gösterir; kullanıcı "Yeniden üret" diyebilir.
  return { url: '', stored: false, authError: dl.reason === 'auth' };
}

/** Sağlayıcı kalıcı kimlik/ödeme hatası verdiğinde gösterilecek net mesaj. */
const PROVIDER_AUTH_ERROR =
  'Görsel sağlayıcı kimlik doğrulama gerektiriyor. Yöneticinin görsel sağlayıcı ' +
  'anahtarını (ör. HUGGINGFACE_API_KEY) ayarlaması gerekiyor.';

/** Saklama başarısız ve fallback URL de yoksa gösterilecek geçici hata mesajı. */
const PROVIDER_TRANSIENT_ERROR =
  'Görsel sağlayıcı şu an yanıt vermiyor. Lütfen birazdan "Yeniden üret" ile tekrar deneyin.';

/** Arkaplan boru hattı: prompt → generate → diske sakla → DB güncelle → SSE push. */
async function runVisualPipeline(
  userId: string,
  id: string,
  fikir: string,
  tema?: string
): Promise<void> {
  try {
    // Fikir (Türkçe) → İngilizce çeviri (FLUX İngilizce'de çok daha isabetli).
    // Çeviri başarısızsa orijinal fikir kullanılır (graceful).
    //
    // Prompt yapısı: KONU baskın cümle, tema ise yalnız "Art style and color
    // palette" olarak ikincil. Aksi halde "doğa/botanik" gibi İÇERİK temaları
    // konuyu eziyor ve sadece çiçek/yeşillik üretiyordu. Bu yapı her temada
    // (doğa, neon, fotogerçekçi…) projeyi koruyup temayı yalnız stile uygular.
    const ideaEn = await translateToEnglish(fikir.trim());
    const themeStr = tema?.trim();
    const promptEn = themeStr
      ? `${ideaEn}. Art style and color palette: ${themeStr}. High quality, detailed.`
      : `${ideaEn}. High quality, detailed.`;
    await dbRun(`UPDATE visuals SET prompt_en = ?, status = 'generating', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [promptEn,
      id]);

    const result = await getImageProvider().generate({ prompt: promptEn });
    // Üretilen görseli sunucuda sakla → image_url prompt'suz iç URL olur.
    const persisted = await persistVariant(id, result);
    // Saklanamadıysa 'ready' deyip dış/kırık URL VERME → net hata göster.
    if (!persisted.stored) {
      throw new Error(persisted.authError ? PROVIDER_AUTH_ERROR : PROVIDER_TRANSIENT_ERROR);
    }
    const variant: VisualVariant = {
      seed: result.seed,
      url: persisted.url,
      stored: persisted.stored,
      ext: persisted.ext,
      created_at: Math.floor(Date.now() / 1000),
    };
    await dbRun(`UPDATE visuals
       SET prompt_en = ?, image_url = ?, seed = ?, status = 'ready',
           variant_index = 0, variants = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [promptEn, persisted.url, result.seed, JSON.stringify([variant]), id]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dbRun(`UPDATE visuals SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [message,
      id]);
  } finally {
    broadcastToUser(userId, { type: 'visual.updated', data: { id } });
  }
}

/**
 * Kullanıcının kendi görselini siler (IDOR: yalnız sahibi). Bu görseli arkaplan
 * olarak kullanan kendi booking'lerinin showcase_image_url'i NULL'lanır (kırık
 * referans kalmasın) ve diskteki tüm varyant dosyaları temizlenir.
 */
export async function deleteVisual(userId: string, visualId: string): Promise<{ deleted: true }> {
  const row = await getRow(visualId);
  if (!row || row.user_id !== userId) {
    throw new HttpError(404, 'Görsel bulunamadı.', 'VISUAL_NOT_FOUND');
  }

  // Bu görseli arkaplan yapan referansları temizle (kırık görsel kalmasın). İç
  // URL formatı: /api/public/visuals/<id>/image?v=<seed> → id'ye göre LIKE.
  // LIKE'ta '_' tek-karakter joker — nanoid '_' içerebilir; escape edilmezse
  // komşu id'li görsellerin referansları da yanlışlıkla NULL'lanır.
  const ref = `%/visuals/${visualId.replace(/([\\%_])/g, '\\$1')}/image%`;
  // 1) Proje (booking) showcase arkaplanı
  await dbRun(
    `UPDATE bookings SET showcase_image_url = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND showcase_image_url LIKE ? ESCAPE '\'`,
    [userId, ref]
  );
  // 2) Kullanıcının kişisel profil arka planı (leaderboard kartı + public profil)
  //    ve sohbet teması — bu görseli kullananlardan referansı kaldır.
  await dbRun(
    `UPDATE users SET profile_background_url = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND profile_background_url LIKE ? ESCAPE '\'`,
    [userId, ref]
  );
  await dbRun(
    `UPDATE users SET chat_background_url = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND chat_background_url LIKE ? ESCAPE '\'`,
    [userId, ref]
  );

  await dbRun('DELETE FROM visuals WHERE id = ? AND user_id = ?', [visualId, userId]);
  await deleteStoredFiles(visualId);
  invalidateShowcaseFeed(); // bir kart arkaplanı kalkmış olabilir → feed cache tazele
  return { deleted: true };
}

export async function regenerateVisual(userId: string, visualId: string): Promise<VisualDto> {
  const row = await getRow(visualId);
  if (!row || row.user_id !== userId) {
    throw new HttpError(404, 'Görsel bulunamadı.', 'VISUAL_NOT_FOUND');
  }
  if (!row.prompt_en) {
    throw new HttpError(409, 'Prompt henüz hazır değil.', 'PROMPT_NOT_READY');
  }

  // Yeni varyant üretimi arkaplanda; istek hemen 'generating' döner, bitince SSE.
  // Eşzamanlılık guard'ı: zaten üretim sürüyorsa ikinci pipeline başlatma
  // (aynı seed + son-yazan-kazanır varyant kaybı + kota israfı).
  const claimed = await dbRun(
    `UPDATE visuals SET status = 'generating', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status NOT IN ('generating', 'enhancing')`,
    [visualId]
  );
  if (claimed.changes === 0) {
    throw new HttpError(409, 'Bu görsel için üretim zaten sürüyor.', 'VISUAL_BUSY');
  }
  void runRegeneratePipeline(userId, visualId, row.prompt_en, parseVariants(row.variants)).catch((err) => {
    logger.error('visual_regenerate_unhandled', { visualId, err: (err as Error).message });
  });

  return (await getVisualForUser(userId, visualId))!; // status: 'generating'
}

async function runRegeneratePipeline(
  userId: string,
  visualId: string,
  promptEn: string,
  existing: VisualVariant[]
): Promise<void> {
  try {
    const newIndex = existing.length;
    const newSeed = variantSeed(promptEn, newIndex);
    const result = await getImageProvider().generate({ prompt: promptEn, seed: newSeed });
    // Yeni varyantı sunucuda sakla → iç URL.
    const persisted = await persistVariant(visualId, result);
    if (!persisted.stored) {
      throw new Error(persisted.authError ? PROVIDER_AUTH_ERROR : PROVIDER_TRANSIENT_ERROR);
    }
    const variant: VisualVariant = {
      seed: result.seed,
      url: persisted.url,
      stored: persisted.stored,
      ext: persisted.ext,
      created_at: Math.floor(Date.now() / 1000),
    };
    await dbRun(`UPDATE visuals
       SET image_url = ?, seed = ?, status = 'ready', variant_index = ?,
           variants = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [persisted.url, result.seed, newIndex, JSON.stringify([...existing, variant]), visualId]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dbRun(`UPDATE visuals SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [message,
      visualId]);
  } finally {
    broadcastToUser(userId, { type: 'visual.updated', data: { id: visualId } });
  }
}

/** Asılı görsel kurtarma eşiği (ms): bu süreden uzun üretimde kalanlar takılmış sayılır. */
const STUCK_VISUAL_THRESHOLD_MS = 5 * 60 * 1000;

/** Kurtarılan (takılmış) görsele yazılan açıklayıcı hata mesajı. */
const STUCK_VISUAL_ERROR =
  'Görsel üretimi yarıda kaldı (sunucu yeniden başlatılmış olabilir). ' +
  'Lütfen "Yeniden üret" ile tekrar deneyin.';

/**
 * Çökme/restart sonrası 'generating'/'enhancing' durumunda asılı kalan görselleri
 * kurtarır: eşiği (varsayılan 5 dk) aşan ve hâlâ üretim/iyileştirme durumunda olan
 * kayıtları 'error' + açıklayıcı mesaj yapar. Aksi halde `regenerateVisual`
 * guard'ı (status NOT IN generating/enhancing) bunlara her zaman VISUAL_BUSY döner
 * ve kullanıcı görseli ne üretebilir ne kullanabilir (kalıcı kilit).
 *
 * Eşik PG oturum saatinde (now()) hesaplanır; `updated_at` de aynı now()/to_char
 * ile yazıldığından managed/UTC Postgres'te bile leksik karşılaştırma tutarlıdır
 * (Node process TZ'sine bağımlı DEĞİL). Bakım cron'undan (leader-korumalı) çağrılır.
 * Kurtarılan kayıt sayısını döner.
 */
export async function recoverStuckVisuals(
  thresholdMs: number = STUCK_VISUAL_THRESHOLD_MS
): Promise<number> {
  const thresholdSec = Math.floor(thresholdMs / 1000);
  const res = await dbRun(
    `UPDATE visuals SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('generating', 'enhancing')
         AND updated_at < to_char(now() - (? * interval '1 second'), 'YYYY-MM-DD HH24:MI:SS')`,
    [STUCK_VISUAL_ERROR, thresholdSec]
  );
  if (res.changes > 0) {
    logger.warn('visual_recover_stuck', { recovered: res.changes, thresholdSec });
  }
  return res.changes;
}

/**
 * Kullanıcının kendi projesinin (booking) Envanter kartına, kendi ürettiği bir
 * görseli arkaplan olarak atar. visualId null ise arkaplanı kaldırır.
 * IDOR: hem booking hem visual aynı kullanıcıya ait olmalı.
 */
export async function setBookingShowcaseImage(
  userId: string,
  bookingId: string,
  visualId: string | null
): Promise<{ showcaseImageUrl: string | null }> {
  const booking = await dbOne('SELECT id, user_id FROM bookings WHERE id = ?', [bookingId]) as
    | { id: string; user_id: string }
    | undefined;
  if (!booking || booking.user_id !== userId) {
    throw new HttpError(404, 'Proje bulunamadı.', 'BOOKING_NOT_FOUND');
  }

  let imageUrl: string | null = null;
  if (visualId) {
    const v = await getRow(visualId);
    if (!v || v.user_id !== userId) {
      throw new HttpError(404, 'Görsel bulunamadı.', 'VISUAL_NOT_FOUND');
    }
    if (!v.image_url) {
      throw new HttpError(409, 'Bu görsel henüz hazır değil.', 'VISUAL_NOT_READY');
    }
    imageUrl = v.image_url;
  }

  await dbRun('UPDATE bookings SET showcase_image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [imageUrl,
    bookingId]);
  invalidateShowcaseFeed(); // galeri kartı arkaplanı değişti → feed cache'ini tazele
  return { showcaseImageUrl: imageUrl };
}

/**
 * Kullanıcının KİŞİSEL profil arka planını ayarlar (leaderboard kartı + public
 * profil sayfası arka planı). visualId null ise kaldırır.
 * IDOR: görsel giriş yapan kullanıcıya ait olmalı (kendi görselini seçebilir).
 */
export async function setProfileBackgroundImage(
  userId: string,
  visualId: string | null
): Promise<{ profileBackgroundUrl: string | null }> {
  let imageUrl: string | null = null;
  if (visualId) {
    const v = await getRow(visualId);
    if (!v || v.user_id !== userId) {
      throw new HttpError(404, 'Görsel bulunamadı.', 'VISUAL_NOT_FOUND');
    }
    if (!v.image_url) {
      throw new HttpError(409, 'Bu görsel henüz hazır değil.', 'VISUAL_NOT_READY');
    }
    imageUrl = v.image_url;
  }

  await dbRun('UPDATE users SET profile_background_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [imageUrl, userId]);
  return { profileBackgroundUrl: imageUrl };
}

/**
 * Kullanıcının sohbet ekranı arka plan temasını ayarlar. visualId null ise kaldırır.
 * IDOR: görsel giriş yapan kullanıcıya ait olmalı.
 */
export async function setChatBackgroundImage(
  userId: string,
  visualId: string | null
): Promise<{ chatBackgroundUrl: string | null }> {
  let imageUrl: string | null = null;
  if (visualId) {
    const v = await getRow(visualId);
    if (!v || v.user_id !== userId) {
      throw new HttpError(404, 'Görsel bulunamadı.', 'VISUAL_NOT_FOUND');
    }
    if (!v.image_url) {
      throw new HttpError(409, 'Bu görsel henüz hazır değil.', 'VISUAL_NOT_READY');
    }
    imageUrl = v.image_url;
  }

  await dbRun('UPDATE users SET chat_background_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [imageUrl, userId]);
  return { chatBackgroundUrl: imageUrl };
}
