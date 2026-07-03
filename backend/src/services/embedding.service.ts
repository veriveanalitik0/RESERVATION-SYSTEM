/**
 * Semantic embedding servisi.
 *
 * Amaç: Booking proje açıklamalarını (project_name + project_description + technologies)
 * sayısal vektörlere çevirip "geçmişte benzer proje var mı?" sorgusuna cevap vermek.
 *
 * Strateji (hibrit — fail-safe):
 *  1. ÖNCELİK: `@xenova/transformers` ile sentence-transformers/all-MiniLM-L6-v2 (384-dim).
 *     - Local model, dış API çağırmaz (data_security.md §8 uyumlu — PII sunucudan çıkmaz).
 *     - İlk request'te ~22MB model indirilir; sonrasında cache'lenir.
 *  2. FALLBACK: TF-IDF tabanlı bag-of-words vektör (pure JS).
 *     - ML modeli yüklenemezse (offline ortam) yine de "benzerlik" çalışır.
 *
 * Güvenlik:
 * - Embedding hesaplama input'u dışa çıkartmaz; local.
 * - DB'de embedding JSON string olarak saklanır (model + dim + values).
 * - Cosine similarity: pure JS, prepared statement ile booking_id eşle.
 */
import { dbAll, dbRun } from '../db/schema';
import { logger } from '../utils/logger';
// Paylaşılan DTO (backend↔frontend tek kaynak) — #6.
import type { SimilarBooking, DuplicateMatch } from '@klab/shared';

export type { SimilarBooking, DuplicateMatch };

interface EmbeddingResult {
  vector: number[];
  model: string;
  dim: number;
}

let extractor: ((text: string, opts?: unknown) => Promise<unknown>) | null = null;
let extractorReady: Promise<boolean> | null = null;
let extractorAvailable = false;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBED_DIM = 384;

/* ============================================================
 * ML MODEL YÜKLEMESİ
 * ============================================================ */

async function loadExtractor(): Promise<boolean> {
  if (extractorReady) return extractorReady;
  extractorReady = (async () => {
    try {
      // Dinamik import — `@xenova/transformers` ESM'dir, CJS TS'de problem çıkarmasın.
      const mod = (await import('@xenova/transformers')) as unknown as {
        pipeline: (task: string, model: string) => Promise<typeof extractor>;
        env: { allowLocalModels: boolean; allowRemoteModels: boolean; cacheDir?: string };
      };
      // Model uzaktan indirme izni (dev için açık). Production'da local proxy kullan.
      mod.env.allowRemoteModels = true;
      // Model cache'i node_modules'a DEĞİL, yazılabilir data dizinine yazılır.
      // Prod image'de node_modules root-sahipli + ayrıcalıksız 'node' kullanıcısı
      // oraya yazamaz (EACCES) → cache'i MODEL_CACHE_DIR'e (volume) yönlendir.
      if (process.env.MODEL_CACHE_DIR) mod.env.cacheDir = process.env.MODEL_CACHE_DIR;
      const pipeline = await mod.pipeline('feature-extraction', MODEL_ID);
      // pipeline runtime callable: (text, opts) => tensor
      extractor = pipeline as unknown as (text: string, opts?: unknown) => Promise<unknown>;
      extractorAvailable = true;
      logger.info('embedding_model_loaded', { model: MODEL_ID, dim: EMBED_DIM });
      return true;
    } catch (err) {
      extractorAvailable = false;
      logger.warn('embedding_model_load_failed_using_tfidf', {
        err: (err as Error).message,
      });
      return false;
    }
  })();
  return extractorReady;
}

/** Background warm-up — server start sırasında çağrılır. */
export async function warmupEmbeddings(): Promise<void> {
  await loadExtractor();
}

/* ============================================================
 * ML EMBEDDING (MiniLM)
 * ============================================================ */

async function mlEmbed(text: string): Promise<number[]> {
  if (!extractor) throw new Error('Extractor not loaded');
  // pooling: 'mean' + normalize: true → 384-dim L2-normalized vektör
  const result = (await extractor(text, { pooling: 'mean', normalize: true })) as {
    data: Float32Array;
  };
  return Array.from(result.data);
}

/* ============================================================
 * TF-IDF FALLBACK (pure JS)
 * ============================================================ */

// Basit Türkçe + İngilizce stopword listesi
const STOPWORDS = new Set<string>([
  've', 'veya', 'ile', 'bu', 'bir', 'için', 'ama', 'da', 'de', 'ki', 'mi', 'çok', 'gibi',
  'olarak', 'kadar', 'her', 'şu', 'sonra', 'önce', 'olan', 'olduğu',
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may',
  'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
  'they', 'them', 'their', 'his', 'her', 'its', 'our', 'your', 'my', 'mine', 'in', 'on',
  'at', 'to', 'from', 'with', 'by', 'as', 'of', 'for', 'about',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Türkçe karakterler korunur; non-alfanumerik ayırıcı
    .replace(/[^a-z0-9çğıöşü\s]/giu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 40 && !STOPWORDS.has(t));
}

// Hashed bag-of-words: 384-dim sabit vektör, her token bir bucket'a düşer.
// Aynı hashing trick FastText'in basitleştirilmiş hali.
function tfidfHashedEmbed(text: string): number[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return new Array(EMBED_DIM).fill(0);

  // term frequency
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  const vector = new Array(EMBED_DIM).fill(0);
  for (const [token, count] of tf.entries()) {
    const hash = stringHash(token);
    const bucket = Math.abs(hash) % EMBED_DIM;
    // Log-scaled TF (dampening)
    vector[bucket] += 1 + Math.log(count);
  }

  // L2 normalize
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  }
  return vector;
}

// FNV-1a 32-bit string hash (deterministic, no crypto needed)
function stringHash(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/* ============================================================
 * PUBLIC API
 * ============================================================ */

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!text || text.trim().length === 0) {
    return { vector: new Array(EMBED_DIM).fill(0), model: 'empty', dim: EMBED_DIM };
  }

  await loadExtractor();

  if (extractorAvailable && extractor) {
    try {
      const vec = await mlEmbed(text);
      return { vector: vec, model: MODEL_ID, dim: vec.length };
    } catch (err) {
      logger.warn('embedding_ml_failed_using_tfidf', { err: (err as Error).message });
    }
  }

  return { vector: tfidfHashedEmbed(text), model: 'tfidf-hashed-v1', dim: EMBED_DIM };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/* ============================================================
 * BOOKING EMBEDDING — DB YARDIMCILARI
 * ============================================================ */

export function bookingTextForEmbedding(args: {
  projectName: string;
  projectDescription: string;
  technologies: string[] | string;
}): string {
  const techs = Array.isArray(args.technologies)
    ? args.technologies.join(' ')
    : args.technologies;
  return `${args.projectName}\n${args.projectDescription}\n${techs}`;
}

export async function saveBookingEmbedding(bookingId: string, text: string): Promise<void> {
  const emb = await generateEmbedding(text);
  await dbRun(`INSERT INTO project_embeddings (booking_id, embedding, model, dim)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(booking_id) DO UPDATE SET
       embedding = excluded.embedding,
       model = excluded.model,
       dim = excluded.dim,
       created_at = CURRENT_TIMESTAMP`, [bookingId, JSON.stringify(emb.vector), emb.model, emb.dim]);
}

export async function deleteBookingEmbedding(bookingId: string): Promise<void> {
  await dbRun(`DELETE FROM project_embeddings WHERE booking_id = ?`, [bookingId]);
}

/**
 * Verilen query text'e en benzer N booking'i döner.
 *
 * Privacy:
 * - `visibility = 'showcase'` (varsayılan): YALNIZ kullanıcının opt-in yaptığı projeler
 *   (status='approved' AND showcase_visible=1). Pending/rejected/gizli projeler İFŞA EDİLMEZ.
 * - `visibility = 'admin'`: Tüm projeler — sadece admin endpoint'ten çağrılmalı.
 *
 * Args:
 * - excludeBookingId: yeni gönderilen booking kendi kendisi ile eşleşmesin.
 * - excludeUserId: user'ın kendi geçmiş booking'lerini hariç tutmak için (opsiyonel).
 * - minSimilarity: 0.0 - 1.0. Aşağıdaki: çoğunluk için 0.3 makul threshold.
 * - includeOwner: çağıran user kendi user_id'sini gönderirse, kendi projeleri DAHİL
 *   (kendisi opt-in yapmamış olsa bile kendi geçmişini görür).
 */
export async function findSimilarBookings(args: {
  queryText: string;
  limit?: number;
  excludeBookingId?: string;
  excludeUserId?: string;
  minSimilarity?: number;
  /** @deprecated visibility kullanın */
  onlyApproved?: boolean;
  visibility?: 'showcase' | 'admin' | 'collaboration';
  includeOwner?: string;
}): Promise<SimilarBooking[]> {
  const limit = args.limit ?? 5;
  const minSim = args.minSimilarity ?? 0.3;
  const visibility = args.visibility ?? 'showcase';

  const queryEmb = await generateEmbedding(args.queryText);

  const conditions: string[] = ['pe.booking_id = b.id'];
  const params: unknown[] = [];

  if (args.excludeBookingId) {
    conditions.push('b.id != ?');
    params.push(args.excludeBookingId);
  }
  if (args.excludeUserId) {
    conditions.push('b.user_id != ?');
    params.push(args.excludeUserId);
  }

  if (visibility === 'showcase') {
    // PRIVACY: yalnız opt-in showcase projeleri + kendi geçmişin (varsa)
    if (args.includeOwner) {
      conditions.push("((b.status = 'approved' AND b.showcase_visible = 1) OR b.user_id = ?)");
      params.push(args.includeOwner);
    } else {
      conditions.push("b.status = 'approved' AND b.showcase_visible = 1");
    }
  } else if (visibility === 'collaboration') {
    // İŞ BİRLİĞİ: yalnız BAŞKA kullanıcıların PUBLIC (opt-in showcase) projeleri.
    // Showcase zaten herkese açık (yazar /showcase'te görünür) → yazar ifşası
    // privacy regresyonu DEĞİL. Çağıran kendi projelerini excludeUserId ile eler.
    conditions.push("b.status = 'approved' AND b.showcase_visible = 1");
  } else if (args.onlyApproved) {
    // Backwards compat — eski admin çağrıları
    conditions.push("b.status = 'approved'");
  }
  // visibility='admin' → kısıt yok, tüm bookings görünür

  // Model uyumu — sadece aynı modelle hesaplanmış embedding'lerle kıyaslama
  conditions.push('pe.model = ?');
  params.push(queryEmb.model);

  const sql = `
    SELECT pe.booking_id, pe.embedding, pe.dim,
           b.user_id, b.project_name, b.project_description, b.technologies, b.status, b.created_at,
           r.code AS room_code, r.name AS room_name,
           u.full_name AS user_full_name
    FROM project_embeddings pe
    INNER JOIN bookings b ON b.id = pe.booking_id
    INNER JOIN rooms r ON r.id = b.room_id
    INNER JOIN users u ON u.id = b.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY b.created_at DESC
    LIMIT 1000
  `;

  const rows = await dbAll(sql, [...params]) as Array<{
    booking_id: string;
    embedding: string;
    dim: number;
    user_id: string;
    project_name: string;
    project_description: string;
    technologies: string;
    status: string;
    room_code: string;
    room_name: string;
    user_full_name: string;
    created_at: string;
  }>;

  const scored: SimilarBooking[] = [];
  for (const row of rows) {
    let vec: number[];
    try {
      const parsed = JSON.parse(row.embedding) as unknown;
      if (!Array.isArray(parsed)) continue;
      vec = parsed as number[];
    } catch {
      continue;
    }
    if (vec.length !== queryEmb.vector.length) continue;

    const sim = cosineSimilarity(queryEmb.vector, vec);
    if (sim < minSim) continue;

    let techs: string[] = [];
    try {
      const t = JSON.parse(row.technologies) as unknown;
      if (Array.isArray(t)) techs = t.filter((x): x is string => typeof x === 'string');
    } catch {
      /* ignore */
    }

    const isOwn = !!args.includeOwner && row.user_id === args.includeOwner;
    // showcase görünürlüğünde başkasının projesi maskelenir. collaboration/admin'de
    // ifşa edilir (showcase projeleri zaten public → yazar gösterilir).
    const anonymize = visibility === 'showcase' && !isOwn;

    scored.push({
      bookingId: row.booking_id,
      similarity: sim,
      projectName: row.project_name,
      projectDescription: row.project_description,
      technologies: techs,
      status: row.status,
      roomCode: row.room_code,
      roomName: row.room_name,
      userFullName: anonymize ? 'AI Lab Ekibi' : row.user_full_name,
      // Yalnız ifşa edilen sonuçlarda authorId ver (anonim olanda gizli kalır).
      authorId: anonymize ? undefined : row.user_id,
      isOwn,
      anonymized: anonymize,
      createdAt: row.created_at,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

/**
 * Yeni booking için OTOMATİK duplicate-tespiti (#4).
 *
 * Yüksek benzerlik eşiğinin (varsayılan 0.85) üstündeki TEK en yakın projeyi döner.
 * Kapsam (privacy): çağıranın kendi geçmiş projeleri + opt-in public showcase
 * projeleri (showcase visibility + includeOwner). Başkasının GİZLİ projesi ifşa
 * edilmez. Bloklamaz — yalnız uyarı amaçlı.
 */
export async function detectDuplicate(args: {
  queryText: string;
  excludeBookingId?: string;
  userId: string;
  threshold?: number;
}): Promise<DuplicateMatch | null> {
  // 0.80: Türkçe parafraz mükerrerlerini yakalar (gözlem: aynı projenin yeniden
  // ifadesi ~0.82-0.85, alakasız projeler <~0.5 → net ayrım). MiniLM cosine.
  const threshold = args.threshold ?? 0.8;
  const results = await findSimilarBookings({
    queryText: args.queryText,
    excludeBookingId: args.excludeBookingId,
    limit: 1,
    minSimilarity: threshold,
    visibility: 'showcase',
    includeOwner: args.userId,
  });
  const top = results[0];
  if (!top) return null;
  return {
    bookingId: top.bookingId,
    projectName: top.projectName,
    similarity: top.similarity,
    isOwn: !!top.isOwn,
    authorFullName: top.userFullName,
    roomCode: top.roomCode,
  };
}

/**
 * Henüz embedding'i hesaplanmamış mevcut booking'leri arka planda işle.
 * (Migration sonrası ilk run — geçmiş data için).
 */
export async function backfillEmbeddings(): Promise<{ processed: number; skipped: number }> {
  const rows = await dbAll(`SELECT b.id, b.project_name, b.project_description, b.technologies
       FROM bookings b
       LEFT JOIN project_embeddings pe ON pe.booking_id = b.id
       WHERE pe.booking_id IS NULL`, []) as Array<{
      id: string;
      project_name: string;
      project_description: string;
      technologies: string;
    }>;

  let processed = 0;
  for (const row of rows) {
    const text = bookingTextForEmbedding({
      projectName: row.project_name,
      projectDescription: row.project_description,
      technologies: row.technologies,
    });
    try {
      await saveBookingEmbedding(row.id, text);
      processed++;
    } catch (err) {
      logger.warn('embedding_backfill_skip', {
        bookingId: row.id,
        err: (err as Error).message,
      });
    }
  }

  return { processed, skipped: rows.length - processed };
}

export function isMLAvailable(): boolean {
  return extractorAvailable;
}

export function currentModelId(): string {
  return extractorAvailable ? MODEL_ID : 'tfidf-hashed-v1';
}
