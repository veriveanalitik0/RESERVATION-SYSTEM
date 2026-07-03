/**
 * Security middleware bundle.
 *
 * Uygulanan koruma katmanları:
 * - helmet:        HSTS, CSP, X-Content-Type-Options, X-Frame-Options (app_security.md §6)
 * - CORS:          Whitelist origin (wildcard yasak — app_security.md §6)
 * - rate-limit:    Brute force ve DoS koruması (app_security.md §6, §10)
 */
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { recordAudit } from '../services/audit.service';
import { logger } from '../utils/logger';

/**
 * CSP direktifleri (app_security §6) — env-aware.
 *
 * style-src 'unsafe-inline' tasarım kararı:
 *   - DEV'de Vite dev server <style> tag'lerini runtime'da inject ediyor;
 *     unsafe-inline olmadan dev sayfası beyaz ekran olur.
 *   - PROD'da Vite build CSS'i extracted bundle'lara çıkardığı için <style>
 *     injection olmaz. React'ın style={{...}} attribute'ları kalır
 *     (7 noktada, hepsi data-driven width/color) ve CSP3 style-src-attr
 *     ile yönetilir.
 *
 * script-src tüm ortamlarda 'self' (unsafe-inline YOK — kritik koruma).
 */
const cspDirectives = (() => {
  const base = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", config.frontendOrigin],
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    baseUri: ["'self'"],
    upgradeInsecureRequests: config.isProduction ? [] : null,
  };

  if (config.isProduction) {
    // Production: sıkı CSP. style-src 'self' + style-src-attr 'unsafe-inline'
    // (React style={{...}} için minimum; <style> injection bloklanır).
    return {
      ...base,
      styleSrc: ["'self'"],
      styleSrcElem: ["'self'"],
      styleSrcAttr: ["'unsafe-inline'"], // CSP3: sadece HTML style="" attr'ı
    };
  }

  // Dev: Vite HMR <style> injection'ı için unsafe-inline gerekli.
  return {
    ...base,
    styleSrc: ["'self'", "'unsafe-inline'"],
  };
})();

export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: cspDirectives,
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: config.isProduction
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  frameguard: { action: 'deny' },
  noSniff: true,
});

/**
 * Permissions-Policy (formerly Feature-Policy): modern tarayıcı API'larını
 * varsayılan olarak kapatır. Uygulamanın geo/camera/mic/usb/payment vb.
 * kullanması gerekmiyor — saldırgan iframe veya supply-chain saldırısı ile
 * bu API'ları çağırmaya çalışsa bile tarayıcı bloklar (defense-in-depth).
 */
export function permissionsPolicyMiddleware(
  _req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction
): void {
  res.setHeader(
    'Permissions-Policy',
    [
      'geolocation=()',
      'camera=()',
      'microphone=()',
      'usb=()',
      'payment=()',
      'magnetometer=()',
      'accelerometer=()',
      'gyroscope=()',
      'interest-cohort=()',
    ].join(', ')
  );
  next();
}

/**
 * Allowed origins: ana FRONTEND_ORIGIN + dev için 127.0.0.1/localhost twin'i.
 * Vite host'u 127.0.0.1 olduğunda tarayıcı Origin'ı 127.0.0.1 gönderir;
 * localhost ile yazılmış FRONTEND_ORIGIN ile eşleşmediği için CORS reddederdi.
 * Production'da config.frontendOrigin (HTTPS prod domain) tek başına yeterli.
 */
const allowedOrigins = new Set<string>([config.frontendOrigin]);
if (!config.isProduction) {
  try {
    const fe = new URL(config.frontendOrigin);
    const twin =
      fe.hostname === 'localhost'
        ? `${fe.protocol}//127.0.0.1${fe.port ? ':' + fe.port : ''}`
        : fe.hostname === '127.0.0.1'
          ? `${fe.protocol}//localhost${fe.port ? ':' + fe.port : ''}`
          : null;
    if (twin) allowedOrigins.add(twin);
  } catch {
    /* invalid URL — skip */
  }
}

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    logger.warn('cors_rejected', { origin });
    return callback(new Error('CORS politikası: izin verilmeyen origin.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-CSRF-Token'],
  maxAge: 86400,
});

/**
 * Rate limit devre dışı bayrağı.
 * DISABLE_RATE_LIMIT=1 set ise: tüm rate-limit middleware'leri no-op olur.
 * Demo/dev/test için pratik; PRODUCTION'da KESİNLİKLE set edilmemeli (app_security §6).
 */
const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMIT === '1';

const noopMiddleware = (_req: Request, _res: Response, next: NextFunction): void => next();

export const globalRateLimit = RATE_LIMIT_DISABLED
  ? noopMiddleware
  : rateLimit({
      windowMs: config.rateLimitWindowMs,
      // Dev ortamında 10x daha yüksek limit — Vite proxy + StrictMode + HMR
      // beklemediğimiz şekilde sayaca dahil oluyor. Production'da config değeri kullanılır.
      max: config.isProduction ? config.rateLimitMaxRequests : config.rateLimitMaxRequests * 10,
      standardHeaders: true,
      legacyHeaders: false,
      // Health/readiness/metrics muaf — orchestrator/healthcheck/scrape sıkça poll eder;
      // loopback IP bucket'ında birikip 429 → konteyner unhealthy olmasın (L2).
      skip: (req) =>
        req.path === '/api/health' ||
        req.path === '/api/readiness' ||
        req.path === '/api/metrics' ||
        (!config.isProduction && req.method === 'GET'),
      message: { error: 'Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.' },
      handler: (req: Request, res: Response) => {
        recordAudit({
          eventType: 'rate_limit.exceeded',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
          details: { path: req.path, scope: 'global' },
        });
        res.status(429).json({ error: 'Çok fazla istek gönderildi.' });
      },
    });

export const authRateLimit = RATE_LIMIT_DISABLED
  ? noopMiddleware
  : rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.authRateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: { error: 'Çok fazla deneme. Lütfen biraz bekleyin.' },
      handler: (req: Request, res: Response) => {
        recordAudit({
          eventType: 'rate_limit.exceeded',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
          details: { path: req.path, scope: 'auth' },
        });
        res.status(429).json({ error: 'Çok fazla deneme. Lütfen biraz bekleyin.' });
      },
    });

/**
 * Her isteği SAYAN sıkı limiter — forgot-password / register gibi DAİMA "başarılı"
 * (200/201) dönen uçlar için. authRateLimit `skipSuccessfulRequests:true` olduğundan
 * bu uçlarda etkisiz kalır (kullanıcı-enumerasyonu / kitlesel kayıt suistimaline açık);
 * bu limiter başarı/başarısızlık ayırmadan IP başına sayar (M15).
 */
export const sensitiveActionRateLimit = RATE_LIMIT_DISABLED
  ? noopMiddleware
  : rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.authRateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false,
      message: { error: 'Çok fazla istek. Lütfen biraz bekleyin.' },
      handler: (req: Request, res: Response) => {
        recordAudit({
          eventType: 'rate_limit.exceeded',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
          details: { path: req.path, scope: 'sensitive' },
        });
        res.status(429).json({ error: 'Çok fazla istek. Lütfen biraz bekleyin.' });
      },
    });

/**
 * Pahalı kaynak (harici görsel üretimi vb.) için KULLANICI-BAŞI rate-limit.
 * Global limiter IP-başıdır; bu limiter authenticated subjectId'ye göre sayar,
 * böylece tek bir hesap harici ücretli model çağrılarını suistimal ederek
 * fatura/kontenjan tüketemez (Denial-of-Wallet — OWASP LLM10, app_security §2).
 * requireUser SONRASI kullanılmalı (req.auth dolu olmalı).
 */
const EXPENSIVE_ACTION_MAX = config.isProduction ? 30 : 300;

export const expensiveActionRateLimit = RATE_LIMIT_DISABLED
  ? noopMiddleware
  : rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: EXPENSIVE_ACTION_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      // IP yerine kimlik: aynı hesap farklı IP'lerden de gelse tek sayaçta toplanır.
      keyGenerator: (req: Request): string => req.auth?.subjectId ?? 'anonymous',
      message: { error: 'Çok fazla görsel üretim isteği. Lütfen biraz bekleyin.' },
      handler: (req: Request, res: Response) => {
        recordAudit({
          eventType: 'rate_limit.exceeded',
          subjectId: req.auth?.subjectId,
          subjectType: req.auth?.subjectType,
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
          details: { path: req.path, scope: 'expensive' },
        });
        res.status(429).json({ error: 'Çok fazla görsel üretim isteği. Lütfen biraz bekleyin.' });
      },
    });

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  logger.info('request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
}
