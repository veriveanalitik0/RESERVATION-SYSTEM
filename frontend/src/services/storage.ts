/**
 * Token storage. Demo amaçlı sessionStorage kullanır.
 *
 * Not (app_security.md §6): Production'da HttpOnly+Secure cookie tercih edilir.
 * sessionStorage XSS'e açıktır; production'da CSP, Trusted Types ve cookie tabanlı
 * yaklaşım birlikte uygulanmalı. Demo için kabul edilebilir tehdit modeli.
 */
import type { AuthTokens, AuthUser, SubjectKind } from '../types';

const KEY_PREFIX = 'klab:';

interface StoredSession {
  tokens: AuthTokens;
  subject: AuthUser;
  kind: SubjectKind;
  expiresAt: number;
}

function key(kind: SubjectKind): string {
  return `${KEY_PREFIX}${kind}`;
}

export const sessionStore = {
  save(kind: SubjectKind, tokens: AuthTokens, subject: AuthUser): void {
    const data: StoredSession = {
      tokens,
      subject,
      kind,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    };
    sessionStorage.setItem(key(kind), JSON.stringify(data));
  },

  get(kind: SubjectKind): StoredSession | null {
    const raw = sessionStorage.getItem(key(kind));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  },

  clear(kind: SubjectKind): void {
    sessionStorage.removeItem(key(kind));
  },

  updateTokens(kind: SubjectKind, tokens: AuthTokens): void {
    const current = this.get(kind);
    if (!current) return;
    const updated: StoredSession = {
      ...current,
      tokens,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    };
    sessionStorage.setItem(key(kind), JSON.stringify(updated));
  },
};

export type { StoredSession };
