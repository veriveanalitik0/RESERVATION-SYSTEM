/**
 * Environment configuration loader.
 * data_security.md §1: Secret'lar runtime'da .env veya vault'tan yüklenir.
 * Eksik kritik değerlerde process fail-fast yapar.
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Saat dilimi politikası: sistem TR sahası için çalışır — tarih sınırları
// (randevu başlangıç/bitiş, cron expiry, "bugün" kontrolleri) Europe/Istanbul
// gününe göre hesaplanmalı. Container'lar TZ env'iyle başlar (compose/Dockerfile);
// bu satır TZ verilmeden çalıştırılan ortamlar için güvenlik ağıdır.
process.env.TZ ??= 'Europe/Istanbul';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[CONFIG] Zorunlu environment değişkeni eksik: ${key}. ` +
        `.env.example dosyasını .env olarak kopyalayın ve doldurun.`
    );
  }
  return value;
}

function optionalInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadKey(envKey: string, label: string): string {
  const path = requireEnv(envKey);
  const absolutePath = resolve(process.cwd(), path);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `[CONFIG] ${label} bulunamadı: ${absolutePath}. ` +
        `Önce 'npm run keys:generate' komutunu çalıştırın.`
    );
  }
  return readFileSync(absolutePath, 'utf8');
}

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  port: number;
  host: string;
  frontendOrigin: string;

  userJwtPrivateKey: string;
  userJwtPublicKey: string;
  adminJwtPrivateKey: string;
  adminJwtPublicKey: string;

  userAccessTokenTtl: number;
  userRefreshTokenTtl: number;
  adminAccessTokenTtl: number;
  adminRefreshTokenTtl: number;

  jwtIssuer: string;
  userJwtAudience: string;
  adminJwtAudience: string;

  csrfSecret: string;

  maxLoginAttempts: number;
  loginLockoutMinutes: number;

  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  authRateLimitMax: number;

  logLevel: string;

  /**
   * Haftanın tek tek günlerini seçerek rezervasyon (ara gün seçimi).
   * Frontend FEATURES.weekdaySelection ile aynı semantik (FEATURE_WEEKDAY_SELECTION).
   * KAPALI (varsayılan): rezervasyon tüm haftayı kapsar → oda müsaitliği TARİH
   * bazlı hesaplanır (bugünü kapsayan herhangi bir booking odayı doldurur).
   * AÇIK: gün-bazlı (weekday_mask) kısmi müsaitlik.
   */
  weekdaySelection: boolean;
}

function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  const csrfSecret = requireEnv('CSRF_SECRET');
  if (csrfSecret.length < 32) {
    throw new Error('[CONFIG] CSRF_SECRET minimum 32 karakter olmalı.');
  }

  // PROD GUARD: rate-limit / seed kaçaklarını üretimde reddet (yanlış config ile
  // brute-force koruması kapanmasın / demo veri sızmasın — fail-fast).
  if (nodeEnv === 'production') {
    if (process.env.DISABLE_RATE_LIMIT === '1') {
      throw new Error('[CONFIG] DISABLE_RATE_LIMIT production ortamında kullanılamaz.');
    }
    if (process.env.ALLOW_PROD_SEED === 'true') {
      // logger config'i import ettiğinden burada console kullanılır (circular import'tan kaçınma).
       
      console.warn('[CONFIG] UYARI: ALLOW_PROD_SEED=true → demo seed prod DB\'ye yüklenebilir. Yalnız ilk kurulum için açın.');
    }
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: optionalInt('PORT', 4000),
    host: process.env.HOST ?? '127.0.0.1',
    frontendOrigin: requireEnv('FRONTEND_ORIGIN'),

    userJwtPrivateKey: loadKey('USER_JWT_PRIVATE_KEY_PATH', 'User JWT private key'),
    userJwtPublicKey: loadKey('USER_JWT_PUBLIC_KEY_PATH', 'User JWT public key'),
    adminJwtPrivateKey: loadKey('ADMIN_JWT_PRIVATE_KEY_PATH', 'Admin JWT private key'),
    adminJwtPublicKey: loadKey('ADMIN_JWT_PUBLIC_KEY_PATH', 'Admin JWT public key'),

    userAccessTokenTtl: optionalInt('USER_ACCESS_TOKEN_TTL', 900),
    userRefreshTokenTtl: optionalInt('USER_REFRESH_TOKEN_TTL', 604800),
    adminAccessTokenTtl: optionalInt('ADMIN_ACCESS_TOKEN_TTL', 900),
    adminRefreshTokenTtl: optionalInt('ADMIN_REFRESH_TOKEN_TTL', 604800),

    jwtIssuer: process.env.JWT_ISSUER ?? 'klab-randevu',
    userJwtAudience: process.env.USER_JWT_AUDIENCE ?? 'klab-user',
    adminJwtAudience: process.env.ADMIN_JWT_AUDIENCE ?? 'klab-admin',

    csrfSecret,

    maxLoginAttempts: optionalInt('MAX_LOGIN_ATTEMPTS', 5),
    loginLockoutMinutes: optionalInt('LOGIN_LOCKOUT_MINUTES', 15),

    rateLimitWindowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 900000),
    rateLimitMaxRequests: optionalInt('RATE_LIMIT_MAX_REQUESTS', 200),
    authRateLimitMax: optionalInt('AUTH_RATE_LIMIT_MAX', 10),

    logLevel: process.env.LOG_LEVEL ?? 'info',

    weekdaySelection: process.env.FEATURE_WEEKDAY_SELECTION === 'true',
  };
}

export const config: AppConfig = loadConfig();
