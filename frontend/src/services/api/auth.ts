/**
 * Kimlik doğrulama API'si — login/register, MFA, şifre sıfırlama/değiştirme,
 * consent ve logout metotları.
 */
import type { ApiError, AuthUser, MfaEnrollResult, MfaStatus, SubjectKind } from '../../types';
import { sessionStore } from '../storage';
import { API_BASE, fetchCsrfToken, request, staffKind } from './core';

/** Çıkış anketi yanıtları — puanlar 1..5, tümü opsiyonel. */
export interface ExitSurveyAnswers {
  overall?: number | null;
  workspace?: number | null;
  bookingEase?: number | null;
  support?: number | null;
  recommend?: number | null;
  comment?: string | null;
}

/**
 * Proje sonu anketi yanıtları — serbest metin, tümü opsiyonel
 * (backend trim sonrası max 4000 karakter kabul eder).
 */
export interface ProjectSurveyAnswers {
  projectWork?: string;
  labFeedback?: string;
  improvement?: string;
}

export const authApi = {
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

  /**
   * EK-1 "Okudum, Kabul Ettim" beyanı onayı — login/register akışındaki onay
   * kartından, oturum açılmış kind'ın token'ıyla çağrılır. İdempotent.
   */
  async acceptConsent(kind: SubjectKind) {
    return request<{ ok: true; consentAcceptedAt: string; version: string }>('/auth/consent', {
      method: 'POST',
      kind,
    });
  },

  /**
   * Çıkış anketi yanıtı — logout'tan ÖNCE, token hâlâ geçerliyken çağrılır.
   * Tüm alanlar opsiyonel; hepsi boşsa backend kayıt yazmaz ({saved:false}).
   */
  async submitExitSurvey(kind: SubjectKind, answers: ExitSurveyAnswers) {
    return request<{ saved: boolean }>('/auth/exit-survey', {
      method: 'POST',
      body: answers,
      kind,
    });
  },

  /**
   * Proje sonu anketi yanıtı — logout'tan ÖNCE, token hâlâ geçerliyken
   * çağrılır. Tüm alanlar opsiyonel serbest metin; hepsi boşsa backend kayıt
   * yazmaz ({saved:false}).
   */
  async submitProjectSurvey(kind: SubjectKind, answers: ProjectSurveyAnswers) {
    return request<{ saved: boolean }>('/auth/project-survey', {
      method: 'POST',
      body: answers,
      kind,
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
};
