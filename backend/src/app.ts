/**
 * Express app fabrikası — index.ts'ten ayrıldı ki route-level entegrasyon
 * testleri (supertest) sunucuyu dinletmeden app'i import edebilsin.
 *
 * index.ts: boot zinciri (şema, cron'lar, listen, graceful shutdown).
 * app.ts  : yalnız middleware + route kablolaması (yan etkisiz).
 */
import express, { type Request, type Response } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { dbOne } from './db/schema';
import { logger } from './utils/logger';
import {
  corsMiddleware,
  globalRateLimit,
  helmetMiddleware,
  permissionsPolicyMiddleware,
  requestLogger,
} from './middleware/security.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { csrfProtection, csrfTokenHandler } from './middleware/cookie-auth';
import { initSseRoutes } from './services/sse.service';
import { metricsMiddleware, renderMetrics } from './observability/metrics';
import { config } from './config/env';
import { openApiDocument } from './openapi';

import unifiedAuthRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import adminRoutes from './routes/admin.routes';
import governanceRoutes from './routes/governance.routes';
import chatRoutes from './routes/chat.routes';
import showcaseRoutes from './routes/showcase.routes';
import publicRoutes from './routes/public.routes';

export function buildApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmetMiddleware);
  app.use(permissionsPolicyMiddleware);
  app.use(corsMiddleware);
  // Yanıt sıkıştırma — SSE hariç (stream'i buffer'layıp realtime'ı kırar).
  app.use(
    compression({
      filter: (req, res) => {
        if (req.path.startsWith('/api/events')) return false;
        return compression.filter(req, res);
      },
    })
  );
  app.use(express.json({ limit: '512kb' })); // profil fotoğrafı (200KB JPEG + base64 overhead) için
  app.use(cookieParser());
  app.use(requestLogger);
  app.use(metricsMiddleware);
  app.use(globalRateLimit);

  // Liveness — process ayakta mı (bağımlılık kontrolü yok, her zaman hızlı).
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'klab-randevu', time: new Date().toISOString() });
  });

  // Readiness — DB'ye gerçekten bağlanabiliyor mu? Orchestrator/LB bu yeşil
  // olmadan trafik yönlendirmemeli (DB hazır değilken 500 dönmesin).
  app.get('/api/readiness', async (_req: Request, res: Response) => {
    try {
      await dbOne('SELECT 1 AS ok');
      res.json({ status: 'ready' });
    } catch (err) {
      logger.warn('readiness_check_failed', { err: (err as Error).message });
      res.status(503).json({ status: 'not_ready' });
    }
  });

  // Prometheus metrikleri — prod'da METRICS_TOKEN zorunlu (scrape config'inde
  // bearer); token tanımsızsa prod'da kapalı. Dev'de serbest.
  app.get('/api/metrics', async (req: Request, res: Response) => {
    const token = process.env.METRICS_TOKEN;
    if (config.isProduction) {
      const bearer = req.get('authorization')?.split(' ')[1];
      if (!token || bearer !== token) {
        res.status(token ? 401 : 404).end();
        return;
      }
    }
    const { contentType, body } = await renderMetrics();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  });

  // CSRF token endpoint (GET — CSRF korumalı değil, token üretir)
  app.get('/api/csrf', csrfTokenHandler);

  // OpenAPI 3.1 schema (public, no auth)
  app.get('/api/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiDocument);
  });

  // SSE: real-time notification stream (auth bearer query veya cookie ile)
  initSseRoutes(app);

  // Public (auth gerektirmeyen) showcase + odalar
  app.use('/api/public', publicRoutes);

  // Tek auth yüzeyi: /api/auth/*. Eski /api/user/auth ve /api/admin/auth
  // router'ları kaldırıldı — frontend yalnız birleşik akışı kullanıyordu.
  // NOT: /api/admin/auth/change-password admin.routes.ts içinde
  // ('/auth/change-password' + /api/admin mount'u) yaşamaya devam eder.
  app.use('/api/auth', unifiedAuthRoutes);          // Birleşik giriş
  app.use('/api/user', userRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/governance', governanceRoutes);
  app.use('/api/chat', chatRoutes);                 // Rol-bağımsız genel sohbet
  app.use('/api/showcase', showcaseRoutes);         // Rol-bağımsız envanter okuma (beğeni/yorum görüntüleme)

  app.use(notFoundHandler);
  app.use(errorHandler);

  // CSRF middleware globalde uygulanmıyor — auth endpointleri (login/register/refresh)
  // henüz session olmadığından korumadan muaf. State-changing endpointlerde
  // route-level csrfProtection enforce edilecek (user.routes + admin.routes).
  // Bu, geriye uyum + güvenlik dengesi içindir.
  void csrfProtection;

  return app;
}
