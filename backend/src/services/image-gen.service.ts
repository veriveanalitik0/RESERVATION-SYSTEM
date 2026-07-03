/**
 * Görsel üretim soyutlaması (gorsel_uretim projesinden port — Express).
 *
 * Provider'lar:
 *  - "huggingface" (önerilen, ücretsiz): Hugging Face Inference API üzerinden
 *    FLUX.1-schnell. HUGGINGFACE_API_KEY (ücretsiz, hf_... token) gerektirir.
 *    Görsel baytlarını DOĞRUDAN döner (POST) → visual-store diske yazar; harici
 *    URL yok, prompt asla client'a sızmaz. Ücretsiz tier rate-limit'li.
 *  - "pollinations": anahtarsız mimari ama yeni API (gen.pollinations.ai) anonim
 *    erişimde 402 verdiğinden POLLINATIONS_TOKEN ister. URL-bazlı, Flux Schnell.
 *  - "gemini": Google Gemini 2.5 Flash Image, GEMINI_API_KEY gerektirir. Base64 →
 *    diske yazar (public/generated).
 *
 * Bir provider ya harici bir `url` (Pollinations) ya da doğrudan görsel baytları
 * (`data` + `contentType`: Hugging Face, Gemini) döndürür; visual.service ikisini
 * de saklama katmanına yönlendirir.
 *
 * Seçim env ile: IMAGE_PROVIDER=huggingface | pollinations | gemini
 */
import { logger } from '../utils/logger';

export interface GenerateImageOptions {
  prompt: string;
  width?: number;
  height?: number;
  /** Sabit seed → aynı prompt+seed = aynı görsel. Verilmezse prompt'tan türetilir. */
  seed?: number;
}

export interface GeneratedImage {
  /** Harici görsel URL'i (URL-bazlı provider'lar, ör. Pollinations). Bayt dönen
   *  provider'larda boş string olabilir; bu durumda `data` doludur. */
  url: string;
  seed: number;
  provider: string;
  prompt: string;
  /** Provider görsel baytlarını doğrudan döndürdüyse (HF, Gemini) ham içerik. */
  data?: Buffer;
  /** `data` doluysa içeriğin MIME türü (ör. 'image/png'). */
  contentType?: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(opts: GenerateImageOptions): Promise<GeneratedImage>;
}

/** Kalite/maliyet dengesi. */
const DEFAULT_SIZE = 1280;

// ============================================================================
// Pollinations — anahtarsız, URL-bazlı
// ============================================================================

// Yeni Pollinations API (gen.pollinations.ai). Eski image.pollinations.ai/prompt
// legacy oldu ve anonim erişimde 402 (x402 ödeme) veriyor. Yeni endpoint API key
// ister → key SUNUCU TARAFINDA `Authorization: Bearer` ile gönderilir
// (visual-store.service downloadAndStore), client URL'ine sızmaz.
const POLLINATIONS_IMAGE_BASE = 'https://gen.pollinations.ai/image';

class PollinationsProvider implements ImageProvider {
  readonly name = 'pollinations';

  async generate(opts: GenerateImageOptions): Promise<GeneratedImage> {
    const width = opts.width ?? DEFAULT_SIZE;
    const height = opts.height ?? DEFAULT_SIZE;
    const seed = opts.seed ?? deterministicSeed(opts.prompt);

    const params = new URLSearchParams({
      width: String(width),
      height: String(height),
      seed: String(seed),
      model: 'flux',
      enhance: 'false',
    });

    const url = `${POLLINATIONS_IMAGE_BASE}/${encodeURIComponent(opts.prompt)}?${params.toString()}`;
    return { url, seed, provider: this.name, prompt: opts.prompt };
  }
}

// ============================================================================
// Hugging Face Inference API — FLUX.1-schnell (ücretsiz, bayt döner)
// ============================================================================

// HF Inference Providers router (yeni). Eski api-inference.huggingface.co
// kaldırıldı (DNS'de çözülmüyor). Model env ile değiştirilebilir.
// Not: HF "model loading" (503) durumunda kısa bir bekleme + tek retry yapılır.
const HF_API_BASE = (process.env.HUGGINGFACE_API_BASE ?? 'https://router.huggingface.co/hf-inference/models').replace(/\/+$/, '');
const HF_DEFAULT_MODEL = 'black-forest-labs/FLUX.1-schnell';
const HF_TIMEOUT_MS = 60_000; // FLUX cold-start yavaş olabilir
const HF_MAX_RETRIES = 1;

class HuggingFaceProvider implements ImageProvider {
  readonly name = 'huggingface';

  async generate(opts: GenerateImageOptions): Promise<GeneratedImage> {
    const seed = opts.seed ?? deterministicSeed(opts.prompt);
    const apiKey = process.env.HUGGINGFACE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        'HUGGINGFACE_API_KEY bulunamadı (.env). huggingface.co/settings/tokens üzerinden ' +
          'ücretsiz bir "Read" token (hf_...) oluşturup ekleyin.'
      );
    }

    const model = process.env.HUGGINGFACE_IMAGE_MODEL?.trim() || HF_DEFAULT_MODEL;
    const url = `${HF_API_BASE}/${model}`;
    const body = JSON.stringify({
      inputs: opts.prompt,
      // FLUX.1-schnell distilled — 4 adım yeterli; seed varyant üretimi için.
      parameters: {
        seed,
        width: opts.width ?? DEFAULT_SIZE,
        height: opts.height ?? DEFAULT_SIZE,
        num_inference_steps: 4,
      },
    });

    for (let attempt = 0; attempt <= HF_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'image/png',
            'x-wait-for-model': 'true',
          },
          body,
          signal: controller.signal,
        });

        const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();

        if (res.ok && contentType.startsWith('image/')) {
          const data = Buffer.from(await res.arrayBuffer());
          if (data.byteLength === 0) throw new Error('Hugging Face boş görsel döndürdü.');
          return { url: '', seed, provider: this.name, prompt: opts.prompt, data, contentType };
        }

        // Hata gövdesi JSON olabilir (loading / rate-limit / auth).
        const errText = await res.text();
        // KALICI hatalar (401/403/429) → retry'lanmaz, hemen fırlatılır.
        if (res.status === 401 || res.status === 403) {
          throw new Error('Hugging Face token geçersiz/yetkisiz. HUGGINGFACE_API_KEY değerini kontrol edin.');
        }
        if (res.status === 429) {
          throw new Error('Hugging Face ücretsiz kota limiti aşıldı. Biraz sonra tekrar deneyin.');
        }
        // 503 = model yükleniyor → kısa bekle, tekrar dene; denemeler biterse dostça mesaj.
        if (res.status === 503) {
          if (attempt < HF_MAX_RETRIES) {
            await delay(parseEstimatedTime(errText));
            continue;
          }
          throw new Error('Hugging Face modeli şu an yükleniyor. Lütfen birazdan tekrar deneyin.');
        }
        throw new Error(`Hugging Face API hata ${res.status}: ${errText.substring(0, 200)}`);
      } catch (err) {
        const e = err as Error;
        // Yalnız zaman aşımı (AbortError) ve ağ hatası (TypeError) retry'lanır;
        // kalıcı HTTP hataları (yukarıda fırlatılanlar) hemen yukarı iletilir →
        // 401/429 gibi durumlarda gereksiz ikinci istek atılmaz.
        const retryable = e.name === 'AbortError' || e.name === 'TypeError';
        if (retryable && attempt < HF_MAX_RETRIES) {
          continue; // finally timer'ı temizler, sonraki denemeye geçilir
        }
        if (e.name === 'AbortError') {
          throw new Error('Hugging Face zaman aşımı — görsel üretimi çok uzun sürdü. Tekrar deneyin.');
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('Hugging Face görsel üretilemedi.');
  }
}

// FLUX (ve çoğu difüzyon modeli) İngilizce prompt'larda çok daha isabetli.
// Türkçe fikir doğrudan gönderilirse alakasız görsel üretir (ör. "bankacılık" →
// banka binası). Bu yüzden fikir önce ücretsiz HF çeviri modeliyle İngilizceye
// çevrilir. Girdi zaten İngilizce ise model ~aynen geçirir (güvenli).
const HF_TRANSLATE_MODEL = 'Helsinki-NLP/opus-mt-tr-en';
// Soğuk başlangıçta (model yüklenirken) ilk çağrı uzun sürebilir; düşük timeout
// erken abort edip Türkçe'ye düşürüyordu → doğa teması konuyu eziyordu. Yeterli
// süre + 1 retry (toplam ~2 deneme) ile cold-start tolere edilir.
const HF_TRANSLATE_TIMEOUT_MS = 30_000;
const HF_TRANSLATE_RETRIES = 1;

/**
 * Türkçe metni İngilizceye çevirir (görsel prompt kalitesi için — FLUX İngilizce'de
 * çok daha isabetli). HF anahtarı yoksa, metin boşsa veya tüm denemeler
 * başarısızsa ORİJİNAL metin döner (graceful — çeviri üretimi asla bloklamaz).
 */
export async function translateToEnglish(text: string): Promise<string> {
  const apiKey = process.env.HUGGINGFACE_API_KEY?.trim();
  const trimmed = text.trim();
  if (!apiKey || !trimmed) return trimmed;

  const url = `${HF_API_BASE}/${HF_TRANSLATE_MODEL}`;
  for (let attempt = 0; attempt <= HF_TRANSLATE_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HF_TRANSLATE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'x-wait-for-model': 'true',
        },
        body: JSON.stringify({ inputs: trimmed }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as Array<{ translation_text?: string }>;
        const out = Array.isArray(data) ? data[0]?.translation_text?.trim() : undefined;
        if (out) return out;
      } else if (res.status !== 503) {
        // 503 = model yükleniyor → retry'a değer; diğer hatalar kalıcı.
        logger.warn('image_prompt_translate_failed', { status: res.status });
        return trimmed;
      }
    } catch (err) {
      logger.warn('image_prompt_translate_retry', { attempt, err: (err as Error).message });
    } finally {
      clearTimeout(timer);
    }
  }
  logger.warn('image_prompt_translate_giveup', { textLen: trimmed.length });
  return trimmed;
}

/**
 * Çeviri modelini arka planda ısıtır (backend açılışında çağrılır) — ilk gerçek
 * kullanıcı isteği soğuk-başlangıç gecikmesi yaşamasın. Best-effort, hata yutulur.
 */
export async function warmupTranslation(): Promise<void> {
  if (!process.env.HUGGINGFACE_API_KEY?.trim()) return;
  try {
    await translateToEnglish('merhaba');
  } catch {
    /* yoksay */
  }
}

/** HF 503 gövdesinden estimated_time (sn) okur; 2–10 sn arası sınırlar. */
function parseEstimatedTime(body: string): number {
  try {
    const j = JSON.parse(body) as { estimated_time?: number };
    const sec = typeof j.estimated_time === 'number' ? j.estimated_time : 5;
    return Math.min(Math.max(Math.ceil(sec), 2), 10) * 1000;
  } catch {
    return 5000;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Gemini 2.5 Flash Image — base64 → disk
// ============================================================================

const GEMINI_MODEL = 'gemini-2.5-flash-image-preview';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

class GeminiProvider implements ImageProvider {
  readonly name = 'gemini';

  async generate(opts: GenerateImageOptions): Promise<GeneratedImage> {
    const seed = opts.seed ?? deterministicSeed(opts.prompt);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY bulunamadı (.env). Hugging Face kullanın ya da anahtar ekleyin.');
    }

    const apiUrl = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    // Timeout: HF provider'daki 60s desenle aynı — API asılı kalırsa görsel
    // süresiz 'generating' durumunda takılıyordu.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: opts.prompt }] }] }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Gemini API hata ${res.status}: ${errorBody.substring(0, 300)}`);
    }

    const data = (await res.json()) as GeminiResponse;
    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini prompt'u reddetti: ${data.promptFeedback.blockReason}`);
    }

    const imagePart = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      const finishReason = data.candidates?.[0]?.finishReason ?? 'bilinmiyor';
      throw new Error(`Gemini görsel döndürmedi (finishReason: ${finishReason})`);
    }

    // Baytları doğrudan döndür → visual-store diske yazıp iç URL'den serve eder
    // (statik /generated servisine gerek kalmaz, diğer provider'larla aynı yol).
    return {
      url: '',
      seed,
      provider: this.name,
      prompt: opts.prompt,
      data: Buffer.from(imagePart.inlineData.data, 'base64'),
      contentType: imagePart.inlineData.mimeType || 'image/png',
    };
  }
}

// ============================================================================
// Provider seçici
// ============================================================================

let _provider: ImageProvider | null = null;

export function getImageProvider(): ImageProvider {
  if (_provider) return _provider;

  const choice = (process.env.IMAGE_PROVIDER ?? 'huggingface').toLowerCase();
  switch (choice) {
    case 'huggingface':
    case 'hf':
      _provider = new HuggingFaceProvider();
      break;
    case 'pollinations':
      _provider = new PollinationsProvider();
      break;
    case 'gemini':
      _provider = new GeminiProvider();
      break;
    default:
      logger.warn('image_gen_unknown_provider', { choice, fallback: 'huggingface' });
      _provider = new HuggingFaceProvider();
  }
  logger.info('image_gen_provider_active', { provider: _provider.name });
  return _provider;
}

// ============================================================================
// Helpers
// ============================================================================

/** Aynı prompt → aynı seed (cache hit). djb2 varyantı. */
export function deterministicSeed(prompt: string): number {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) {
    h = (h * 31 + prompt.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Variant için yeni seed — aynı prompt, farklı seed → farklı görsel. */
export function variantSeed(prompt: string, variantIndex: number): number {
  const base = deterministicSeed(prompt);
  return Math.abs((base ^ (variantIndex * 2654435761)) | 0);
}
