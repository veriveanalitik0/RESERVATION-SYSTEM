/**
 * Prometheus metrikleri — prom-client.
 *
 * OTel paketleri kurulu olmadığından (otel.ts noop'a düşüyor) izlenebilirlik
 * fiilen yoktu; bu modül minimum çalışan katmanı sağlar:
 *  - Node process default metrikleri (CPU, bellek, event loop lag, GC)
 *  - HTTP istek süresi histogramı (method / route / status)
 *
 * /api/metrics endpoint'i app.ts'te tanımlıdır. Production'da METRICS_TOKEN
 * zorunludur (Prometheus scrape config'inde bearer olarak verilir); token
 * tanımlı değilse endpoint prod'da kapalıdır.
 */
import client from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

export const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry, prefix: 'klab_' });

const httpRequestDuration = new client.Histogram({
  name: 'klab_http_request_duration_seconds',
  help: 'HTTP istek süresi (saniye)',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

/**
 * Yol normalizasyonu — nanoid/uuid path segmentleri ':id'ye indirgenir;
 * aksi halde her kayıt için ayrı zaman serisi oluşur (kardinalite patlaması).
 */
function normalizeRoute(path: string): string {
  return (
    path
      .split('/')
      .map((seg) => (/^[A-Za-z0-9_-]{12,}$/.test(seg) ? ':id' : seg))
      .slice(0, 5)
      .join('/') || '/'
  );
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // SSE stream'leri histogramı bozar (saatlerce açık kalır) — ölçme.
  if (req.path.startsWith('/api/events')) {
    next();
    return;
  }
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({
      method: req.method,
      route: normalizeRoute(req.path),
      status: String(res.statusCode),
    });
  });
  next();
}

export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return {
    contentType: metricsRegistry.contentType,
    body: await metricsRegistry.metrics(),
  };
}
