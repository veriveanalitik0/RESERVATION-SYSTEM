/**
 * API client.
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
import type {
  AdminStats,
  AdminUserUpdatePayload,
  AdminUserSearchFilters,
  AnalyticsResponse,
  ApiError,
  ApprovalType,
  AppNotification,
  AuthTokens,
  AuthUser,
  Appointment,
  Booking,
  GateKey,
  GateStatus,
  GovernanceAdmin,
  GovernanceBundle,
  GovernanceDashboard,
  HumanApproval,
  QualityGate,
  RoomWithOccupancy,
  ChatContact,
  ChatMessage,
  CreateBookingPayload,
  CreateHardwareRequestPayload,
  HardwareRequest,
  HardwareRequestStatus,
  HardwareRequestWithUser,
  JoinWaitlistPayload,
  LicenseBudgetReport,
  LicenseReport,
  LicenseRequest,
  LicenseRequestStatus,
  LicenseRequestWithUser,
  LikeStatus,
  MfaEnrollResult,
  MfaStatus,
  ProfileUpdatePayload,
  PublicProfile,
  ReviewBookingPayload,
  Room,
  RoomAvailability,
  ShowcaseComment,
  ShowcaseEngagement,
  ShowcaseItem,
  SimilarBooking,
  DuplicateMatch,
  Leaderboard,
  RoomApptHeatmap,
  KioskRoom,
  KioskData,
  Book,
  BookLoan,
  StageEvent,
  SubjectKind,
  SupportRequest,
  SupportRequestStatus,
  SupportRequestWithUser,
  UserLicenseUsage,
  UserListItem,
  UserProfile,
  Visual,
  CreateVisualPayload,
  WaitlistEntry,
} from '../types';
import { sessionStore } from './storage';

const API_BASE = '/api';

interface RequestOptions {
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

async function fetchCsrfToken(force = false): Promise<string | null> {
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

async function refreshAccess(kind: SubjectKind): Promise<boolean> {
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

async function request<T>(path: string, options: RequestOptions): Promise<T> {
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
function notificationBase(kind: SubjectKind): string {
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
function staffKind(): SubjectKind {
  if (sessionStore.get('admin')) return 'admin';
  if (sessionStore.get('danisman')) return 'danisman';
  if (sessionStore.get('arge')) return 'arge';
  if (sessionStore.get('izleyici')) return 'izleyici';
  return 'admin';
}

/* ============================================================
 * API client object
 * ============================================================ */

export const api = {
  async login(email: string, password: string) {
    return request<{
      // mfaRequired=true ise accessToken GELMEZ; mfaPendingToken ile
      // /auth/mfa/verify çağrılıp tam oturum alınır. Refresh token her durumda
      // yalnız HttpOnly cookie'dedir.
      accessToken?: string;
      mfaPendingToken?: string;
      expiresIn: number;
      type: SubjectKind;
      subject: AuthUser;
      mfaRequired?: boolean;
    }>('/auth/login', { method: 'POST', body: { email, password }, kind: 'user', auth: false });
  },

  /** MFA login ikinci adımı: pending token + TOTP/backup kodu → tam oturum. */
  async mfaLoginVerify(pendingToken: string, code: string) {
    const csrf = await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/auth/mfa/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pendingToken}`,
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      let payload: ApiError = { error: 'MFA doğrulaması başarısız.' };
      try {
        payload = (await res.json()) as ApiError;
      } catch {
        // ignore
      }
      const error = new Error(payload.error || 'MFA doğrulaması başarısız.') as Error & {
        status?: number;
        code?: string;
      };
      error.status = res.status;
      error.code = payload.code;
      throw error;
    }
    return (await res.json()) as {
      accessToken: string;
      expiresIn: number;
      type: 'admin';
      subject: AuthUser;
      usedBackupCode: boolean;
    };
  },

  async register(payload: {
    email: string;
    password: string;
    passwordConfirm: string;
    fullName: string;
    // governanceRole REMOVED (C2) — backend reddediyor zaten, type'tan da kaldırıldı.
  }) {
    return request<{
      accessToken: string;
      expiresIn: number;
      type: 'user';
      subject: AuthUser;
    }>('/auth/register', { method: 'POST', body: payload, kind: 'user', auth: false });
  },

  async loginUser(email: string, password: string) {
    return request<{
      accessToken: string;
      expiresIn: number;
      user: AuthUser;
    }>('/user/auth/login', {
      method: 'POST',
      body: { email, password },
      kind: 'user',
      auth: false,
    });
  },

  /* ============ ŞİFRE SIFIRLAMA ============ */

  async forgotPassword(email: string) {
    return request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      kind: 'user',
      auth: false,
    });
  },

  async resetPassword(token: string, password: string, passwordConfirm: string) {
    return request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: { token, password, passwordConfirm },
      kind: 'user',
      auth: false,
    });
  },

  async loginAdmin(email: string, password: string) {
    return request<{
      accessToken: string;
      expiresIn: number;
      admin: AuthUser;
      mfaRequired?: boolean;
    }>('/admin/auth/login', {
      method: 'POST',
      body: { email, password },
      kind: staffKind(),
      auth: false,
    });
  },

  async logoutUser() {
    try {
      await request('/auth/logout', { method: 'POST', kind: 'user' });
    } finally {
      sessionStore.clear('user');
    }
  },

  async logoutAdmin() {
    try {
      await request('/auth/logout', { method: 'POST', kind: staffKind() });
    } finally {
      sessionStore.clear('admin');
    }
  },

  /* ============ ROOMS / BOOKINGS ============ */

  async listUserRooms(from?: string, to?: string) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{ rooms: Room[] }>(`/user/rooms${qs}`, { kind: 'user' });
  },

  /** Oda müsaitlik detayı — boş günler, dolu tarih aralıkları, dolu saatler. */
  async roomAvailability(roomId: string, params?: { from?: string; to?: string }) {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<RoomAvailability>(
      `/user/rooms/${encodeURIComponent(roomId)}/availability${suffix}`,
      { kind: 'user' }
    );
  },

  async listUserBookings() {
    return request<{ bookings: Booking[] }>('/user/bookings', { kind: 'user' });
  },

  /** Onaylı rezervasyonu iptal et — kayıt 'cancelled' olur, oda boşalır. */
  async cancelApprovedBooking(bookingId: string) {
    return request<{ booking: Booking }>(`/user/bookings/${encodeURIComponent(bookingId)}/cancel`, {
      method: 'POST',
      kind: 'user',
    });
  },

  /** Dashboard ilerleme notu — yalnız sahibi, yalnız onaylı booking. */
  async updateBookingProgress(bookingId: string, progressNote: string) {
    return request<{ booking: Booking }>(`/user/bookings/${encodeURIComponent(bookingId)}/progress`, {
      method: 'PUT',
      body: { progressNote },
      kind: 'user',
    });
  },

  async createBooking(payload: CreateBookingPayload) {
    // Yanıt: oluşturulan booking + (varsa) otomatik duplicate-tespiti uyarısı (#4).
    return request<{ booking: Booking; duplicateWarning: DuplicateMatch | null }>(
      '/user/bookings',
      {
        method: 'POST',
        body: payload,
        kind: 'user',
      }
    );
  },

  /* ============ GÖRSEL ÜRETİMİ ============ */

  async createVisual(payload: CreateVisualPayload) {
    return request<{ visual: Visual }>('/user/visuals', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async listMyVisuals() {
    return request<{ visuals: Visual[] }>('/user/visuals', { kind: 'user' });
  },

  async regenerateVisual(id: string) {
    return request<{ visual: Visual }>(`/user/visuals/${id}/regenerate`, {
      method: 'POST',
      kind: 'user',
    });
  },

  async deleteVisual(id: string) {
    return request<{ deleted: true }>(`/user/visuals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: 'user',
    });
  },

  async setShowcaseImage(bookingId: string, visualId: string | null) {
    return request<{ showcaseImageUrl: string | null }>(
      `/user/bookings/${bookingId}/showcase-image`,
      { method: 'PUT', body: { visualId }, kind: 'user' }
    );
  },

  async setProfileBackground(visualId: string | null) {
    return request<{ profileBackgroundUrl: string | null }>(
      '/user/profile/background',
      { method: 'PUT', body: { visualId }, kind: 'user' }
    );
  },

  async setChatBackground(visualId: string | null) {
    return request<{ chatBackgroundUrl: string | null }>(
      '/user/chat/background',
      { method: 'PUT', body: { visualId }, kind: 'user' }
    );
  },

  async updateBooking(id: string, payload: CreateBookingPayload) {
    return request<{ booking: Booking }>(`/user/bookings/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
      kind: 'user',
    });
  },

  async deleteBooking(id: string) {
    return request<{ deleted: boolean }>(`/user/bookings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: 'user',
    });
  },

  async toggleBookingShowcase(id: string, visible: boolean) {
    return request<{ booking: Booking }>(
      `/user/bookings/${encodeURIComponent(id)}/showcase`,
      { method: 'PUT', body: { visible }, kind: 'user' }
    );
  },

  /* ============ APPOINTMENTS — günlük randevular ============ */

  async listUserAppointments(opts: {
    from?: string;
    to?: string;
    includeCancelled?: boolean;
  } = {}) {
    const qs = new URLSearchParams();
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.includeCancelled) qs.set('includeCancelled', 'true');
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ appointments: Appointment[] }>(
      `/user/appointments${query}`,
      { kind: 'user' }
    );
  },

  async listBookingAppointments(bookingId: string) {
    return request<{ appointments: Appointment[] }>(
      `/user/bookings/${encodeURIComponent(bookingId)}/appointments`,
      { kind: 'user' }
    );
  },

  async createAppointment(payload: {
    bookingId: string;
    startAt: string;
    endAt: string;
    title?: string;
    notes?: string;
  }) {
    return request<{ appointment: Appointment }>('/user/appointments', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async cancelAppointment(id: string) {
    return request<{ cancelled: boolean }>(
      `/user/appointments/${encodeURIComponent(id)}`,
      { method: 'DELETE', kind: 'user' }
    );
  },

  /** Kullanıcı aşamayı kendisi ilerletir (canlıya kadar — canlı geçişi onaylıdır). */
  async selfAdvanceStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/user/bookings/${encodeURIComponent(bookingId)}/advance-stage`,
      { method: 'POST', kind: 'user' }
    );
  },

  /** Kullanıcı admin'den CANLIYA geçiş onayı talep eder. */
  async requestStageAdvance(bookingId: string, note?: string) {
    return request<{ booking: Booking }>(
      `/user/bookings/${encodeURIComponent(bookingId)}/request-advance`,
      { method: 'POST', body: { note }, kind: 'user' }
    );
  },

  /* ============ WAITLIST ============ */

  async listUserWaitlist() {
    return request<{ entries: WaitlistEntry[] }>('/user/waitlist', { kind: 'user' });
  },

  async joinWaitlist(payload: JoinWaitlistPayload) {
    return request<{ entry: WaitlistEntry }>('/user/waitlist', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async removeWaitlistEntry(id: string) {
    return request<{ removed: boolean }>(`/user/waitlist/${encodeURIComponent(id)}/remove`, {
      method: 'DELETE',
      kind: 'user',
    });
  },

  async cancelWaitlist(id: string) {
    return request<{ cancelled: boolean }>(`/user/waitlist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: 'user',
    });
  },

  /* ============ ADMIN ============ */

  async listAdminBookings(status?: string) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<{ bookings: Booking[] }>(`/admin/bookings${qs}`, { kind: staffKind() });
  },

  async reviewBooking(id: string, payload: ReviewBookingPayload) {
    return request<{
      booking: Booking;
      autoWaitlisted: boolean;
      waitlistPosition?: number;
    }>(`/admin/bookings/${id}/review`, {
      method: 'POST',
      body: payload,
      kind: staffKind(),
    });
  },

  async adminStats() {
    return request<{ stats: AdminStats }>('/admin/stats', { kind: staffKind() });
  },

  async adminAnalytics() {
    return request<AnalyticsResponse>('/admin/analytics', { kind: staffKind() });
  },

  async adminLicenses() {
    return request<LicenseReport>('/admin/licenses', { kind: staffKind() });
  },

  async adminLicenseBudget() {
    return request<LicenseBudgetReport>('/admin/licenses/budget', { kind: staffKind() });
  },

  async myLicenseUsage() {
    return request<UserLicenseUsage>('/user/me/licenses', { kind: 'user' });
  },

  async adminListWaitlist() {
    return request<{ entries: WaitlistEntry[] }>('/admin/waitlist', { kind: staffKind() });
  },

  /** Admin: waitlist sırası değiştirme (öncelik verme). */
  async adminMoveWaitlist(id: string, move: 'up' | 'down' | 'top') {
    return request<{ entries: WaitlistEntry[] }>(
      `/admin/waitlist/${encodeURIComponent(id)}/move`,
      { method: 'POST', body: { move }, kind: staffKind() }
    );
  },

  /* ============ ODALAR — admin doluluk + atama ============ */

  async adminRoomsOccupancy() {
    return request<{ rooms: RoomWithOccupancy[] }>('/admin/rooms/occupancy', {
      kind: staffKind(),
    });
  },

  async adminReassignBooking(bookingId: string, roomId: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/reassign`,
      { method: 'POST', body: { roomId }, kind: staffKind() }
    );
  },

  async adminReassignBookingUser(bookingId: string, userId: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/reassign-user`,
      { method: 'POST', body: { userId }, kind: staffKind() }
    );
  },

  async adminDeleteBooking(bookingId: string) {
    return request<{
      deleted: boolean;
      roomId: string;
      userId: string;
      wasApproved: boolean;
    }>(`/admin/bookings/${encodeURIComponent(bookingId)}`, {
      method: 'DELETE',
      kind: staffKind(),
    });
  },

  /** Booking detayı + yaşam döngüsü zaman çizelgesi (modal "Geçmiş" tab'ı için). */
  async adminGetBookingDetail(bookingId: string) {
    return request<{ booking: Booking; stageEvents: StageEvent[] }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}`,
      { kind: staffKind() }
    );
  },

  async adminAdvanceBookingStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/advance-stage`,
      { method: 'POST', kind: staffKind() }
    );
  },

  async adminRegressBookingStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/regress-stage`,
      { method: 'POST', kind: staffKind() }
    );
  },

  async adminSetBookingReviewTrack(bookingId: string, track: 'standard' | 'swat') {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/review-track`,
      { method: 'POST', body: { track }, kind: staffKind() }
    );
  },

  async adminRejectStageAdvanceRequest(bookingId: string, note?: string) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(bookingId)}/advance-request`,
      { method: 'DELETE', body: { note }, kind: staffKind() }
    );
  },

  /* ============ YÖNETIŞIM — DANIŞMAN ============ */

  async danismanInbox() {
    return request<{
      licenseRequests: LicenseRequestWithUser[];
      bookings: Booking[];
      counts: { licenseRequestsPending: number; bookingsPending: number };
    }>('/governance/danisman/inbox', { kind: 'danisman' });
  },

  async danismanReviewLicense(
    licenseId: string,
    payload: { action: 'approve' | 'reject' | 'request_feedback' | 'swat'; feedback?: string }
  ) {
    return request<{ request: LicenseRequest }>(
      `/governance/danisman/license-requests/${encodeURIComponent(licenseId)}/review`,
      { method: 'POST', body: payload, kind: 'danisman' }
    );
  },

  /* ============ YÖNETIŞIM — AR-GE ============ */

  async argeProjects() {
    return request<{
      projects: Booking[];
      counts: {
        total: number;
        withAdvanceRequest: number;
        inStage: number;
        inProduction: number;
      };
    }>('/governance/arge/projects', { kind: 'arge' });
  },

  async argeAdvanceStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/governance/arge/bookings/${encodeURIComponent(bookingId)}/advance-stage`,
      { method: 'POST', kind: 'arge' }
    );
  },

  async argeRegressStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/governance/arge/bookings/${encodeURIComponent(bookingId)}/regress-stage`,
      { method: 'POST', kind: 'arge' }
    );
  },

  async argeRejectAdvanceRequest(bookingId: string) {
    return request<{ booking: Booking }>(
      `/governance/arge/bookings/${encodeURIComponent(bookingId)}/advance-request`,
      { method: 'DELETE', kind: 'arge' }
    );
  },

  async adminListAppointments(opts: {
    from?: string;
    to?: string;
    includeCancelled?: boolean;
  } = {}) {
    const qs = new URLSearchParams();
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.includeCancelled) qs.set('includeCancelled', 'true');
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ appointments: Appointment[] }>(
      `/admin/appointments${query}`,
      { kind: staffKind() }
    );
  },

  async adminCancelAppointment(id: string) {
    return request<{ cancelled: boolean }>(
      `/admin/appointments/${encodeURIComponent(id)}`,
      { method: 'DELETE', kind: staffKind() }
    );
  },

  /* ============ PAROLA — admin ============ */

  async adminResetUserPassword(userId: string, password: string) {
    return request<{ message: string }>(
      `/admin/users/${encodeURIComponent(userId)}/reset-password`,
      { method: 'POST', body: { password }, kind: staffKind() }
    );
  },

  async adminChangePassword(currentPassword: string, newPassword: string) {
    return request<{ message: string }>('/admin/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      kind: staffKind(),
    });
  },

  async toggleAdminShowcase(id: string, payload: { visible?: boolean; highlight?: boolean }) {
    return request<{ booking: Booking }>(
      `/admin/bookings/${encodeURIComponent(id)}/showcase`,
      { method: 'PUT', body: payload, kind: staffKind() }
    );
  },

  /* ============ ADMIN MFA ============ */

  async mfaStatus() {
    return request<MfaStatus>('/admin/mfa/status', { kind: staffKind() });
  },

  async mfaEnroll() {
    return request<MfaEnrollResult>('/admin/mfa/enroll', { method: 'POST', kind: staffKind() });
  },

  async mfaVerify(code: string) {
    return request<{ verified: boolean; usedBackupCode: boolean }>('/admin/mfa/verify', {
      method: 'POST',
      body: { code },
      kind: staffKind(),
    });
  },

  async mfaDisable(code: string) {
    return request<{ disabled: boolean }>('/admin/mfa/disable', {
      method: 'POST',
      body: { code },
      kind: staffKind(),
    });
  },

  /* ============ Profil ============ */

  async getProfile() {
    return request<{ profile: UserProfile }>('/user/profile', { kind: 'user' });
  },

  async updateProfile(payload: ProfileUpdatePayload) {
    return request<{ profile: UserProfile }>('/user/profile', {
      method: 'PUT',
      body: payload,
      kind: 'user',
    });
  },

  /* ============ Admin User Management ============ */

  async adminListUsers(filters: AdminUserSearchFilters = {}) {
    const qs = new URLSearchParams();
    if (filters.q) qs.set('q', filters.q);
    if (filters.status) qs.set('status', filters.status);
    if (filters.department) qs.set('department', filters.department);
    if (filters.hasBookings) qs.set('hasBookings', filters.hasBookings);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ users: UserListItem[] }>(`/admin/users${query}`, { kind: staffKind() });
  },

  async adminListDepartments() {
    return request<{ departments: string[] }>('/admin/users/meta/departments', {
      kind: staffKind(),
    });
  },

  async adminGetUser(id: string) {
    return request<{ user: UserProfile }>(`/admin/users/${encodeURIComponent(id)}`, {
      kind: staffKind(),
    });
  },

  async adminUpdateUser(id: string, payload: AdminUserUpdatePayload) {
    return request<{ user: UserProfile }>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
      kind: staffKind(),
    });
  },

  async adminDeleteUser(id: string) {
    return request<{ deleted: boolean }>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: staffKind(),
    });
  },

  async adminRestoreUser(id: string) {
    return request<{ user: UserProfile }>(
      `/admin/users/${encodeURIComponent(id)}/restore`,
      { method: 'POST', kind: staffKind() }
    );
  },

  /* ============ PROFİL FOTOĞRAFI ============ */

  async setMyPhoto(dataUrl: string) {
    return request<{ ok: boolean }>('/user/me/photo', {
      method: 'PUT',
      body: { dataUrl },
      kind: 'user',
    });
  },

  async clearMyPhoto() {
    return request<{ ok: boolean }>('/user/me/photo', {
      method: 'DELETE',
      kind: 'user',
    });
  },

  /* ============ GENEL SOHBET (rol-bağımsız chat) ============ */

  async chatContacts(kind: SubjectKind) {
    return request<{ contacts: ChatContact[] }>('/chat/contacts', { kind });
  },

  async chatConversation(kind: SubjectKind, peerId: string) {
    return request<{ messages: ChatMessage[]; markedRead: number }>(
      `/chat/conversations/${encodeURIComponent(peerId)}`,
      { kind }
    );
  },

  async chatSend(
    kind: SubjectKind,
    recipientId: string,
    recipientKind: 'user' | 'admin',
    body: string
  ) {
    return request<{ message: ChatMessage }>('/chat/messages', {
      method: 'POST',
      body: { recipientId, recipientKind, body },
      kind,
    });
  },

  async chatMarkRead(kind: SubjectKind, peerId: string) {
    return request<{ markedRead: number }>(
      `/chat/conversations/${encodeURIComponent(peerId)}/read`,
      { method: 'POST', kind }
    );
  },

  async chatUnread(kind: SubjectKind) {
    return request<{ unread: number }>('/chat/unread', { kind });
  },

  /* ============ BİLDİRİM MERKEZİ ============ */

  async listNotifications(kind: SubjectKind) {
    return request<{ items: AppNotification[]; unread: number }>(
      `${notificationBase(kind)}/notifications`,
      { kind }
    );
  },

  async markNotificationRead(kind: SubjectKind, id: string) {
    return request<void>(
      `${notificationBase(kind)}/notifications/${encodeURIComponent(id)}/read`,
      { method: 'POST', kind }
    );
  },

  async markAllNotificationsRead(kind: SubjectKind) {
    return request<{ marked: number }>(
      `${notificationBase(kind)}/notifications/read-all`,
      { method: 'POST', kind }
    );
  },

  /* ============ SHOWCASE LIKES & COMMENTS ============ */

  // Okuma — rol-bağımsız (/api/showcase). Aktif oturumun kind'ı geçilir; admin
  // dahil her rol beğeni/yorum GÖREBİLİR (envanterde "giriş yap" sorunu çözümü).
  async getLikeStatus(bookingId: string, kind: SubjectKind = 'user') {
    return request<LikeStatus>(`/showcase/${encodeURIComponent(bookingId)}/likes`, {
      kind,
    });
  },

  async toggleLike(bookingId: string) {
    return request<LikeStatus>(`/user/showcase/${encodeURIComponent(bookingId)}/like`, {
      method: 'POST',
      kind: 'user',
    });
  },

  async listComments(bookingId: string, kind: SubjectKind = 'user') {
    return request<{ comments: ShowcaseComment[] }>(
      `/showcase/${encodeURIComponent(bookingId)}/comments`,
      { kind }
    );
  },

  async postComment(bookingId: string, body: string) {
    return request<{ comment: ShowcaseComment }>(
      `/user/showcase/${encodeURIComponent(bookingId)}/comments`,
      { method: 'POST', body: { body }, kind: 'user' }
    );
  },

  async deleteComment(commentId: string) {
    return request<{ deleted: boolean }>(
      `/user/showcase/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE', kind: 'user' }
    );
  },

  async showcaseEngagement() {
    return request<{ engagement: ShowcaseEngagement }>('/public/showcase/engagement', {
      kind: 'user',
      auth: false,
      noAuth: true,
    });
  },

  /* ============ LEADERBOARD / HEATMAP / KIOSK (#5) ============ */

  /** Sıralama: kullanıcı (oda kullanımı + etkileşim) + proje (beğeni/yorum). */
  async leaderboard() {
    return request<Leaderboard>('/user/leaderboard', { kind: 'user' });
  },

  /** Appointment (saatli) ısı-haritası — oda × gün, saat detaylı (#5). */
  async roomAppointmentHeatmap(params?: { from?: string; to?: string }) {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<RoomApptHeatmap>(`/user/rooms/appointment-heatmap${suffix}`, { kind: 'user' });
  },

  /** Kiosk seçici — aktif odalar (public). */
  async kioskRooms() {
    return request<{ rooms: KioskRoom[] }>('/public/rooms', {
      kind: 'user',
      auth: false,
      noAuth: true,
    });
  },

  /** Bir odanın kiosk verisi — son görsel + oda (public). */
  async roomKiosk(roomId: string) {
    return request<KioskData>(`/public/rooms/${encodeURIComponent(roomId)}/kiosk`, {
      kind: 'user',
      auth: false,
      noAuth: true,
    });
  },

  /* ============ PUBLIC PROFİL ============ */

  async getPublicProfile(userId: string) {
    return request<{ profile: PublicProfile }>(
      `/public/users/${encodeURIComponent(userId)}`,
      { kind: 'user', auth: false, noAuth: true }
    );
  },

  /* ============ PUBLIC ============ */

  async showcase() {
    return request<{ items: ShowcaseItem[]; total: number }>('/public/showcase', {
      kind: 'user',
      auth: false,
      noAuth: true,
    });
  },

  async showcaseTechnologies() {
    return request<{ technologies: Array<{ technology: string; count: number }> }>(
      '/public/showcase/technologies',
      { kind: 'user', auth: false, noAuth: true }
    );
  },

  /**
   * Showcase FEED — tek çağrıda items + technologies + engagement (#3).
   * Eski 3 ayrı isteğin (showcase/technologies/engagement) yerini alır.
   */
  async showcaseFeed() {
    return request<{
      items: ShowcaseItem[];
      total: number;
      technologies: Array<{ technology: string; count: number }>;
      engagement: ShowcaseEngagement;
      generatedAt: string;
    }>('/public/showcase/feed', { kind: 'user', auth: false, noAuth: true });
  },

  /* ============ SEMANTIC SEARCH (henüz frontend tetiklenecek) ============ */

  async userFindSimilar(payload: {
    bookingId?: string;
    projectName?: string;
    projectDescription?: string;
    technologies?: string[];
    limit?: number;
    minSimilarity?: number;
  }) {
    return request<{ results: SimilarBooking[] }>('/user/similar', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  /**
   * İş birliği önerisi (#4) — kendi booking'ine benzer, BAŞKA ekiplerin public
   * projeleri (yazar ifşalı → "Bağlan"). IDOR: yalnız kendi bookingId'si.
   */
  async userCollaborations(payload: { bookingId: string; limit?: number; minSimilarity?: number }) {
    return request<{ results: SimilarBooking[] }>('/user/collaborations', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async adminFindSimilar(payload: {
    bookingId?: string;
    projectName?: string;
    projectDescription?: string;
    technologies?: string[];
    limit?: number;
    minSimilarity?: number;
  }) {
    return request<{ results: SimilarBooking[] }>('/admin/similar', {
      method: 'POST',
      body: payload,
      kind: staffKind(),
    });
  },

  /* ============ LİSANS TALEPLERİ ============ */

  async licenseCatalog() {
    return request<{
      items: Array<{
        key: string;
        name: string;
        vendor: string;
        category: string;
        tier: 'paid' | 'free' | 'enterprise';
        monthlyUsd: number;
      }>;
    }>('/user/licenses/catalog', { kind: 'user' });
  },

  async listMyLicenseRequests() {
    return request<{ items: LicenseRequest[] }>('/user/licenses/requests', { kind: 'user' });
  },

  async createLicenseRequest(payload: LicenseRequestPayload) {
    return request<{ request: LicenseRequest }>('/user/licenses/requests', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async updateLicenseRequest(requestId: string, payload: LicenseRequestPayload) {
    return request<{ request: LicenseRequest }>(
      `/user/licenses/requests/${encodeURIComponent(requestId)}`,
      { method: 'PUT', body: payload, kind: 'user' }
    );
  },

  /** Kullanıcının kendi başvuru/proje detayı — yönetişim demeti dahil. */
  async userLicenseRequestDetail(requestId: string) {
    return request<GovernanceBundle>(
      `/user/licenses/requests/${encodeURIComponent(requestId)}`,
      { kind: 'user' }
    );
  },

  async adminListLicenseRequests(statusFilter?: LicenseRequestStatus) {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return request<{ items: LicenseRequestWithUser[] }>(
      `/admin/licenses/requests${qs}`,
      { kind: staffKind() }
    );
  },

  async adminReviewLicenseRequest(
    requestId: string,
    payload: {
      action: 'approve' | 'reject' | 'request_feedback' | 'swat';
      adminFeedback?: string | null;
    }
  ) {
    return request<{ request: LicenseRequestWithUser }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/review`,
      { method: 'POST', body: payload, kind: staffKind() }
    );
  },

  /* ============ YÖNETİŞİM ============ */

  async adminLicenseRequestDetail(requestId: string) {
    return request<GovernanceBundle>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}`,
      { kind: staffKind() }
    );
  },

  async adminGovernanceDashboard() {
    return request<GovernanceDashboard>('/admin/licenses/governance/dashboard', {
      kind: staffKind(),
    });
  },

  async adminGovernanceAdmins() {
    return request<{ admins: GovernanceAdmin[] }>('/admin/governance/admins', {
      kind: staffKind(),
    });
  },

  async adminAdvanceLifecycle(requestId: string, note?: string | null) {
    return request<{ request: LicenseRequestWithUser; transition: { fromStage: string; toStage: string } }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/advance`,
      { method: 'POST', body: { note: note ?? null }, kind: staffKind() }
    );
  },

  async adminAssignEngineer(requestId: string, engineerId: string) {
    return request<{ request: LicenseRequestWithUser }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/assign-engineer`,
      { method: 'POST', body: { engineerId }, kind: staffKind() }
    );
  },

  async adminUpgradeProjectType(requestId: string) {
    return request<{ request: LicenseRequestWithUser }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/upgrade-type`,
      { method: 'POST', kind: staffKind() }
    );
  },

  async adminSetGateResult(
    requestId: string,
    payload: {
      gateKey: GateKey;
      status: GateStatus;
      score?: number | null;
      detail?: string | null;
    }
  ) {
    return request<{ gate: QualityGate }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/gates`,
      { method: 'PUT', body: payload, kind: staffKind() }
    );
  },

  async adminDecideApproval(
    requestId: string,
    payload: {
      approvalType: ApprovalType;
      decision: 'approved' | 'rejected';
      releaseNote?: string | null;
      riskAssessment?: string | null;
    }
  ) {
    return request<{ request: LicenseRequestWithUser; approval: HumanApproval }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/approval`,
      { method: 'POST', body: payload, kind: staffKind() }
    );
  },

  /* ============ DONANIM TALEPLERİ ============ */

  async listMyHardwareRequests() {
    return request<{ items: HardwareRequest[] }>('/user/hardware/requests', {
      kind: 'user',
    });
  },

  async createHardwareRequest(payload: CreateHardwareRequestPayload) {
    return request<{ request: HardwareRequest }>('/user/hardware/requests', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async updateHardwareRequest(id: string, payload: CreateHardwareRequestPayload) {
    return request<{ request: HardwareRequest }>(
      `/user/hardware/requests/${encodeURIComponent(id)}`,
      { method: 'PUT', body: payload, kind: 'user' }
    );
  },

  async adminListHardwareRequests(statusFilter?: HardwareRequestStatus) {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return request<{ items: HardwareRequestWithUser[] }>(
      `/admin/hardware/requests${qs}`,
      { kind: staffKind() }
    );
  },

  async adminReviewHardwareRequest(
    id: string,
    payload: {
      action: 'approve' | 'reject' | 'request_feedback';
      adminFeedback?: string | null;
    }
  ) {
    return request<{ request: HardwareRequestWithUser }>(
      `/admin/hardware/requests/${encodeURIComponent(id)}/review`,
      { method: 'POST', body: payload, kind: staffKind() }
    );
  },

  /* ============ DESTEK TALEPLERİ ============ */

  async createSupportRequest(description: string, kind: SubjectKind = 'user') {
    const path =
      kind === 'danisman' || kind === 'arge'
        ? `/governance/${kind}/support/requests`
        : '/user/support/requests';
    return request<{ request: SupportRequest }>(path, {
      method: 'POST',
      body: { description },
      kind,
    });
  },

  async adminListSupportRequests(statusFilter?: SupportRequestStatus) {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return request<{ items: SupportRequestWithUser[] }>(
      `/admin/support/requests${qs}`,
      { kind: staffKind() }
    );
  },

  async adminResolveSupportRequest(id: string) {
    return request<{ request: SupportRequestWithUser }>(
      `/admin/support/requests/${encodeURIComponent(id)}/resolve`,
      { method: 'POST', kind: staffKind() }
    );
  },

  /* ============ KÜTÜPHANE (kitap ödünç) ============ */

  // Kullanıcı
  async listBooks() {
    return request<{ books: Book[] }>('/user/books', { kind: 'user' });
  },
  async borrowBook(bookId: string, periodDays?: 7 | 14 | 30) {
    return request<{ loan: BookLoan }>(
      `/user/books/${encodeURIComponent(bookId)}/borrow`,
      { method: 'POST', body: periodDays ? { periodDays } : {}, kind: 'user' }
    );
  },
  async listMyLoans() {
    return request<{ loans: BookLoan[] }>('/user/loans', { kind: 'user' });
  },
  async returnLoan(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/user/loans/${encodeURIComponent(loanId)}/return`,
      { method: 'POST', kind: 'user' }
    );
  },

  // Admin (GET'ler staff-okunur, mutasyonlar admin)
  async adminListBooks() {
    return request<{ books: Book[] }>('/admin/books', { kind: staffKind() });
  },
  async adminCreateBook(payload: {
    title: string;
    author: string;
    isbn?: string;
    category?: string;
    description?: string;
    coverImageUrl?: string;
    totalCopies: number;
  }) {
    return request<{ book: Book }>('/admin/books', {
      method: 'POST',
      body: payload,
      kind: 'admin',
    });
  },
  async adminUpdateBook(
    id: string,
    payload: Partial<{
      title: string;
      author: string;
      isbn: string;
      category: string;
      description: string;
      coverImageUrl: string;
      totalCopies: number;
      isActive: boolean;
    }>
  ) {
    return request<{ book: Book }>(`/admin/books/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
      kind: 'admin',
    });
  },
  async adminDeleteBook(id: string) {
    return request<{ deleted: boolean }>(`/admin/books/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: 'admin',
    });
  },
  async adminListLoans(statusFilter?: 'pending' | 'active' | 'returned' | 'overdue' | 'rejected') {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return request<{ loans: BookLoan[] }>(`/admin/loans${qs}`, { kind: staffKind() });
  },

  // Kullanıcı: aktif/gecikmiş ödünç için süre uzatma talebi.
  async requestExtension(loanId: string, days: 7 | 14 | 30) {
    return request<{ loan: BookLoan }>(
      `/user/loans/${encodeURIComponent(loanId)}/extend`,
      { method: 'POST', body: { days }, kind: 'user' }
    );
  },

  // Admin: bekleyen ödünç onay/red + süre-uzatma onay/red.
  async adminApproveLoan(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/admin/loans/${encodeURIComponent(loanId)}/approve`,
      { method: 'POST', kind: 'admin' }
    );
  },
  async adminRejectLoan(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/admin/loans/${encodeURIComponent(loanId)}/reject`,
      { method: 'POST', kind: 'admin' }
    );
  },
  async adminApproveExtension(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/admin/loans/${encodeURIComponent(loanId)}/extend/approve`,
      { method: 'POST', kind: 'admin' }
    );
  },
  async adminRejectExtension(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/admin/loans/${encodeURIComponent(loanId)}/extend/reject`,
      { method: 'POST', kind: 'admin' }
    );
  },
};

/**
 * createLicenseRequest / updateLicenseRequest ortak gövdesi.
 * Sadeleştirilmiş form yalnızca çekirdek alanları (ad/amaç/araç/süre) gönderir;
 * geri kalanlar opsiyoneldir (backend null/varsayılan yazar).
 */
export interface LicenseRequestPayload {
  requestTitle: string;
  reason: string;
  items: Array<{
    licenseKey: string;
    licenseName: string;
    vendor?: string | null;
    category?: string | null;
  }>;
  durationMonths: 1 | 3 | 6 | 12;
  expectedBenefit?: string;
  successCriteria?: string;
  projectType?: 'poc' | 'integration';
  estimatedDurationDays?: number | null;
  dataToUse?: string;
  technicalStack?: string | null;
  usesExternalApi?: boolean;
  involvesRealData?: boolean;
}
