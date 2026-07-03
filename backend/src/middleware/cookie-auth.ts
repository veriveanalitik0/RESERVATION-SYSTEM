/**
 * Cookie-based auth helpers + CSRF protection.
 *
 * Güvenlik:
 * - app_security.md §6: Refresh token HttpOnly + Secure + SameSite=Strict cookie'de tutulur.
 *   Access token ise frontend memory'sinde (asla cookie'de değil — CSRF surface'ını küçültür).
 * - CSRF: csrf-csrf "double submit" patterni — cookie + custom header karşılaştırması.
 *   GET'lerde CSRF gerekmez, mutation'larda zorunlu.
 * - Demo'da Secure flag development'ta false; production'da config.isProduction true ise true.
 */
import { doubleCsrf } from 'csrf-csrf';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { HttpError } from './error.middleware';
import { recordAudit } from '../services/audit.service';
import { logger } from '../utils/logger';

/* ============================================================
 * REFRESH TOKEN COOKIE'LERİ
 * ============================================================ */

export const REFRESH_COOKIE_USER = 'klab_rt_user';
export const REFRESH_COOKIE_ADMIN = 'klab_rt_admin';
export const REFRESH_COOKIE_DANISMAN = 'klab_rt_danisman';
export const REFRESH_COOKIE_ARGE = 'klab_rt_arge';
const REFRESH_COOKIE_IZLEYICI = 'klab_rt_izleyici';

import type { SubjectKind } from '../types/auth.types';

export function refreshCookieName(kind: SubjectKind): string {
  switch (kind) {
    case 'user': return REFRESH_COOKIE_USER;
    case 'admin': return REFRESH_COOKIE_ADMIN;
    case 'danisman': return REFRESH_COOKIE_DANISMAN;
    case 'arge': return REFRESH_COOKIE_ARGE;
    case 'izleyici': return REFRESH_COOKIE_IZLEYICI;
  }
}

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
  maxAge: number;
}

function refreshCookieOptions(kind: SubjectKind): CookieOptions {
  const ttl = kind === 'admin' ? config.adminRefreshTokenTtl : config.userRefreshTokenTtl;
  return {
    httpOnly: true,
    secure: config.isProduction, // dev'de http için false
    sameSite: 'strict',
    path: '/api',
    maxAge: ttl * 1000,
  };
}

export function setRefreshCookie(res: Response, kind: SubjectKind, token: string): void {
  res.cookie(refreshCookieName(kind), token, refreshCookieOptions(kind));
}

export function clearRefreshCookie(res: Response, kind: SubjectKind): void {
  res.clearCookie(refreshCookieName(kind), { path: '/api' });
}

export function getRefreshCookie(req: Request, kind: SubjectKind): string | null {
  const raw = (req.cookies?.[refreshCookieName(kind)] as string | undefined) ?? null;
  return typeof raw === 'string' && raw.length >= 20 ? raw : null;
}

/* ============================================================
 * CSRF — Double-submit token (csrf-csrf)
 * ============================================================ */

const { generateToken, doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => config.csrfSecret,
  getSessionIdentifier: (req) =>
    (req.cookies?.[REFRESH_COOKIE_USER] as string | undefined) ??
    (req.cookies?.[REFRESH_COOKIE_ADMIN] as string | undefined) ??
    (req.cookies?.[REFRESH_COOKIE_DANISMAN] as string | undefined) ??
    (req.cookies?.[REFRESH_COOKIE_ARGE] as string | undefined) ??
    (req.cookies?.[REFRESH_COOKIE_IZLEYICI] as string | undefined) ??
    (req.ip ?? 'anonymous'),
  cookieName: 'klab_csrf',
  cookieOptions: {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req: Request) =>
    (req.headers['x-csrf-token'] as string | undefined) ?? '',
});

/**
 * CSRF token üretimi: client uygulaması fetch öncesi bu endpoint'i çağırıp
 * X-CSRF-Token header'ında bu değeri gönderir.
 *
 * Önemli: token + cookie aynı session'a (refresh cookie veya IP) bağlanır.
 *
 * `overwrite: true` — eğer browser'da geçersiz/stale klab_csrf cookie varsa
 * (örneğin backend restart sonrası refresh cookie session id'si artık DB'de
 * yok) library default'u `validateOnReuse: true` olduğu için 403 fırlatır.
 * Bizim için /api/csrf çağrısı her zaman fresh token üretmeli — overwrite=true
 * eski geçersiz cookie'yi sessizce yeni token ile değiştirir. Güvenlik etkisi
 * yok: zaten her CSRF token kullanıcıya direkt veriliyor (gizli değil).
 */
export function csrfTokenHandler(req: Request, res: Response): void {
  // generateToken(req, res, overwrite, validateOnReuse) — 3. parametre boolean.
  const token = generateToken(req, res, true);
  res.json({ csrfToken: token });
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  try {
    doubleCsrfProtection(req, res, (err?: unknown) => {
      if (err) {
        recordAudit({
          eventType: 'csrf.failure',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
          details: { path: req.path, reason: (err as Error).message ?? 'invalid' },
        });
        next(new HttpError(403, 'CSRF doğrulaması başarısız.', 'CSRF_INVALID'));
        return;
      }
      next();
    });
  } catch (err) {
    if (err === invalidCsrfTokenError) {
      recordAudit({
        eventType: 'csrf.failure',
        ipAddress: req.ip,
        success: false,
        details: { path: req.path },
      });
      next(new HttpError(403, 'CSRF doğrulaması başarısız.', 'CSRF_INVALID'));
      return;
    }
    logger.error('csrf_middleware_error', { err: (err as Error).message });
    next(new HttpError(403, 'CSRF doğrulaması başarısız.', 'CSRF_INVALID'));
  }
}
