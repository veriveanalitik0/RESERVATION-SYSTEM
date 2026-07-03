/**
 * OpenTelemetry SDK setup.
 *
 * Modlar:
 *  - OTEL_DISABLED=1 → tamamen kapalı (default, demo modu).
 *  - OTEL_EXPORTER_OTLP_ENDPOINT set → OTLP exporter (Jaeger, Tempo, vs.).
 *  - Aksi halde: NoopProvider (instrument'lar var ama hiçbir yere gitmez).
 *
 * Auto-instrumentation:
 *  - HTTP server (Express)
 *  - pg / PostgreSQL (custom — gerekirse manual span'larla)
 *
 * Manual span örnekleri için: traced() helper.
 *
 * NOT: @opentelemetry/* paketleri opsiyonel (dinamik import).
 * Production'da `npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node`
 * yapılır.
 */
import { logger } from '../utils/logger';

let started = false;

export async function initOtel(): Promise<void> {
  if (started) return;
  if (process.env.OTEL_DISABLED === '1') {
    logger.info('otel_disabled');
    return;
  }

  try {
    // String-based dynamic imports bypass TS module resolution (opsiyonel paketler)
    const sdkModule = (await import('@opentelemetry/sdk-node' as string).catch(() => null)) as
      | { NodeSDK: new (cfg: Record<string, unknown>) => { start: () => void; shutdown: () => Promise<void> } }
      | null;
    const autoInstrModule = (await import(
      '@opentelemetry/auto-instrumentations-node' as string
    ).catch(() => null)) as { getNodeAutoInstrumentations: () => unknown } | null;

    if (!sdkModule || !autoInstrModule) {
      logger.info('otel_packages_missing_using_noop', {
        hint: '`npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node` for production',
      });
      return;
    }

    const { NodeSDK } = sdkModule;
    const { getNodeAutoInstrumentations } = autoInstrModule;

    const sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'klab-randevu',
      // Default OTLP HTTP exporter — endpoint env'den
      instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();
    started = true;
    logger.info('otel_started', {
      service: process.env.OTEL_SERVICE_NAME ?? 'klab-randevu',
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });

    process.on('SIGTERM', () => {
      void sdk.shutdown().catch((err: Error) => logger.warn('otel_shutdown_error', { err: err.message }));
    });
  } catch (err) {
    logger.warn('otel_init_failed', { err: (err as Error).message });
  }
}

/**
 * Manual span helper — kritik kod yollarında.
 * Otomatik fallback: tracer yoksa fonksiyonu olduğu gibi çalıştırır.
 */
export async function traced<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  if (!started) return await fn();
  try {
    interface OtelSpan {
      setStatus(s: { code: number; message?: string }): void;
      recordException(e: Error): void;
      end(): void;
    }
    interface OtelApiModule {
      trace: {
        getTracer(name: string): {
          startActiveSpan<U>(n: string, fn: (span: OtelSpan) => Promise<U>): Promise<U>;
        };
      };
    }
    const apiModule = (await import('@opentelemetry/api' as string).catch(() => null)) as OtelApiModule | null;
    if (!apiModule) return await fn();
    const tracer = apiModule.trace.getTracer('klab-randevu');
    return await tracer.startActiveSpan<T>(name, async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  } catch {
    return await fn();
  }
}
