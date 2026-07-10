/**
 * API client çekirdeği — request(), CSRF yönetimi, token refresh ve SSE havuzu.
 * Alan modülleri (auth, bookings, ...) bu altyapıyı paylaşır.
 *
 * Güvenlik:
 * - app_security.md §6: Refresh token HttpOnly cookie'de. Frontend access token'ı
 *   memory + sessionStorage'da tutar (XSS surface dar — production'da tamamen
 *   memory'e taşınabilir).
 * - app_security.md §6: Tüm mutation (POST/PUT/DELETE) X-CSRF-Token header
 *   gönderir; double-submit token doğrulanır.
 * - Cookie credentials için `credentials: 'include'` zorunlu.
 *
 * Auto-refresh: 401 alındığında refresh endpoint çağrılır, başarılı olursa
 * orijinal istek tekrarlanır.
 */
import type { ApiError, AuthTokens, SubjectKind } from '../../types';
import { sessionStore } from '../storage';

export const API_BASE = '/api';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  kind: SubjectKind;
  auth?: boolean;
  /** Public endpoint'ler (showcase) için bypass. */
  noAuth?: boolean;
}

/* ============================================================
 * CSRF Token Cache
 * ============================================================ */

let cachedCsrfToken: string | null = null;
let csrfFetching: Promise<string | null> | null = null;

export async function fetchCsrfToken(force = false): Promise<string | null> {
  if (cachedCsrfToken && !force) return cachedCsrfToken;
  if (csrfFetching && !force) return csrfFetching;

  csrfFetching = (async () => {
    try {
      const res = await fetch(`${API_BASE}/csrf`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { csrfToken?: string };
      cachedCsrfToken = data.csrfToken ?? null;
      return cachedCsrfToken;
    } catch {
      return null;
    } finally {
      csrfFetching = null;
    }
  })();

  return csrfFetching;
}

/**
 * Cache'lenmiş CSRF token'ı temizler. Login/Register sayfası mount olduğunda
 * çağrılır — backend restart veya session geçişi sonrası eski token'la
 * 403 alma riskini ortadan kaldırır (bir sonraki istek fresh fetch yapar).
 */
export function clearCsrfCache(): void {
  cachedCsrfToken = null;
  csrfFetching = null;
}

// 401 fırtınası koruması: oturum ölünce onlarca istek aynı anda refresh denemesin.
//  - Tek-uçuş: eşzamanlı 401'ler TEK refresh çağrısı paylaşır.
//  - Cooldown: refresh başarısız olduysa kısa süre ağ'a gitmeden false döner.
//  - Başarısızlıkta oturum temizlenir + 'klab:session-expired' event'i atılır
//    (AuthContext bunu dinleyip login'e yönlendirir → polling component'leri durur).
const refreshInFlight: Partial<Record<SubjectKind, Promise<boolean>>> = {};
const refreshFailedUntil: Partial<Record<SubjectKind, number>> = {};
const REFRESH_FAIL_COOLDOWN_MS = 5000;

function notifySessionExpired(kind: SubjectKind): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('klab:session-expired', { detail: kind }));
  }
}

export async function refreshAccess(kind: SubjectKind): Promise<boolean> {
  if (Date.now() < (refreshFailedUntil[kind] ?? 0)) return false;

  const existing = refreshInFlight[kind];
  if (existing) return existing;

  const p = (async (): Promise<boolean> => {
    const session = sessionStore.get(kind);
    if (!session) return false;
    try {
      // Refresh token HttpOnly cookie'de yaşar — gövdede gönderilmez.
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.tokens.accessToken}`,
        },
      });

      if (!res.ok) {
        // Oturum ölü → temizle, cooldown koy, app'i bilgilendir → fırtınayı kes.
        refreshFailedUntil[kind] = Date.now() + REFRESH_FAIL_COOLDOWN_MS;
        sessionStore.clear(kind);
        notifySessionExpired(kind);
        return false;
      }

      const data = (await res.json()) as AuthTokens & { type?: SubjectKind };
      sessionStore.updateTokens(kind, {
        accessToken: data.accessToken,
        expiresIn: data.expiresIn,
      });
      refreshFailedUntil[kind] = 0;
      return true;
    } catch {
      refreshFailedUntil[kind] = Date.now() + REFRESH_FAIL_COOLDOWN_MS;
      return false;
    } finally {
      refreshInFlight[kind] = undefined;
    }
  })();

  refreshInFlight[kind] = p;
  return p;
}

export async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const { method = 'GET', body, kind, auth = true, noAuth = false } = options;
  const session = sessionStore.get(kind);
  const isMutation = method !== 'GET';

  const buildHeaders = async (): Promise<HeadersInit> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Session her denemede taze okunur: 401 → refresh sonrası retry'ın
    // closure'daki bayat access token yerine yenilenen token'ı kullanması şart.
    const current = sessionStore.get(kind);
    if (auth && !noAuth && current) {
      headers.Authorization = `Bearer ${current.tokens.accessToken}`;
    }
    if (isMutation && !noAuth) {
      const csrf = await fetchCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    return headers;
  };

  const doFetch = async (): Promise<Response> => {
    const headers = await buildHeaders();
    return fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch();

  // CSRF rotated? Re-fetch and retry once.
  if (res.status === 403 && isMutation) {
    let isCsrf = false;
    try {
      const errClone = res.clone();
      const peek = (await errClone.json()) as ApiError;
      isCsrf = peek?.code === 'CSRF_INVALID';
    } catch {
      // ignore
    }
    if (isCsrf) {
      await fetchCsrfToken(true);
      res = await doFetch();
    }
  }

  // Access token expired → refresh + retry
  if (res.status === 401 && auth && !noAuth && session) {
    const ok = await refreshAccess(kind);
    if (ok) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    let payload: ApiError = { error: 'İşlem başarısız.' };
    try {
      payload = (await res.json()) as ApiError;
    } catch {
      // ignore
    }
    const error = new Error(payload.error || 'İşlem başarısız.') as Error & {
      status?: number;
      code?: string;
      issues?: ApiError['issues'];
    };
    error.status = res.status;
    error.code = payload.code;
    error.issues = payload.issues;
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Bildirim endpoint base path'i. user/admin doğrudan `/{kind}` altında route'lanır;
 * danışman ve ar-ge ise governance router'ında (`/governance/{kind}`) yaşar — token
 * audience'ları ayrı olduğu için user/admin route'larına düşemezler.
 */
export function notificationBase(kind: SubjectKind): string {
  return kind === 'danisman' || kind === 'arge' || kind === 'izleyici'
    ? `/governance/${kind}`
    : `/${kind}`;
}

/* ============================================================
 * SSE — real-time stream
 * ============================================================ */

export interface SseSubscription {
  close: () => void;
}

/**
 * SSE bağlantı havuzu — kind başına TEK EventSource paylaşılır (refcount'lu).
 * Önceden her sayfadaki her hook ayrı bağlantı açıyordu (sayfa başına 2-3 SSE,
 * navigasyonda kopar-bağlan). Artık aboneler tek bağlantının üzerinden fan-out
 * alır; son abone kapanınca bağlantı kapanır.
 */
const ssePool = new Map<
  SubjectKind,
  { sub: SseSubscription; handlers: Set<(type: string, data: unknown) => void>; refs: number }
>();

export function subscribeEvents(
  kind: SubjectKind,
  handler: (type: string, data: unknown) => void
): SseSubscription | null {
  if (!sessionStore.get(kind)) return null;

  const existing = ssePool.get(kind);
  if (existing) {
    existing.handlers.add(handler);
    existing.refs += 1;
    return {
      close: () => {
        existing.handlers.delete(handler);
        existing.refs -= 1;
        if (existing.refs <= 0) {
          ssePool.delete(kind);
          existing.sub.close();
        }
      },
    };
  }

  const handlers = new Set<(type: string, data: unknown) => void>([handler]);
  const raw = openEventStream(kind, (t, d) => {
    for (const h of handlers) h(t, d);
  });
  if (!raw) return null;
  const entry = { sub: raw, handlers, refs: 1 };
  ssePool.set(kind, entry);
  return {
    close: () => {
      entry.handlers.delete(handler);
      entry.refs -= 1;
      if (entry.refs <= 0) {
        ssePool.delete(kind);
        entry.sub.close();
      }
    },
  };
}

/** Gerçek EventSource yönetimi — yalnız havuz üzerinden kullanılır. */
function openEventStream(
  kind: SubjectKind,
  handler: (type: string, data: unknown) => void
): SseSubscription | null {
  if (!sessionStore.get(kind)) return null;

  const wrap = (eventName: string) => (e: MessageEvent) => {
    try {
      const data = e.data ? (JSON.parse(e.data as string) as unknown) : null;
      handler(eventName, data);
    } catch {
      handler(eventName, null);
    }
  };

  const eventNames = [
    'hello',
    'ping',
    'booking.created',
    'booking.updated',
    'booking.reviewed',
    'booking.withdrawn',
    'waitlist.changed',
    'appointment.changed',
    'chat.message',
    'hardware_request.created',
    'hardware_request.reviewed',
    'support_request.created',
    'visual.updated',
  ];

  // EventSource'un native reconnect'i URL'e gömülü access token'ı yeniden
  // kullanır; token süresi dolunca bağlantı sessizce ölürdü. Reconnect'i biz
  // yönetiyoruz: her denemede token taze okunur, üst üste hatada refresh denenir.
  let source: EventSource | null = null;
  let retryTimer: number | undefined;
  let attempt = 0;
  let closed = false;

  const connect = () => {
    if (closed) return;
    const session = sessionStore.get(kind);
    if (!session) return; // oturum kapanmış — yeniden bağlanma
    const url = `${API_BASE}/events?access_token=${encodeURIComponent(session.tokens.accessToken)}`;
    source = new EventSource(url, { withCredentials: true });
    for (const n of eventNames) source.addEventListener(n, wrap(n));
    source.onopen = () => {
      attempt = 0;
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (closed) return;
      attempt += 1;
      const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempt - 1, 4));
      retryTimer = window.setTimeout(() => {
        void (async () => {
          if (closed) return;
          // İlk hata ağ kopması olabilir; ardışık hatada token bayatlamış
          // demektir → reconnect öncesi refresh (in-flight dedup'lı, ucuz).
          if (attempt >= 2) await refreshAccess(kind);
          connect();
        })();
      }, delay);
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      source?.close();
      source = null;
    },
  };
}

/**
 * Aktif personel oturumunun kind'ı. `/api/admin/*` endpoint'leri artık GET
 * isteklerinde danışman/arge token'ı da kabul ediyor (read-only). Tek-oturum
 * politikası gereği aynı anda yalnızca bir staff oturumu açıktır; bu yüzden
 * admin api metotları sabit 'admin' yerine aktif staff kind'ını kullanır.
 * Sıf admin → 'admin' (davranış değişmez); danışman/arge → kendi token'ı.
 */
export function staffKind(): SubjectKind {
  if (sessionStore.get('admin')) return 'admin';
  if (sessionStore.get('danisman')) return 'danisman';
  if (sessionStore.get('arge')) return 'arge';
  if (sessionStore.get('izleyici')) return 'izleyici';
  return 'admin';
}
