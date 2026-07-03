/**
 * Kuveyt Türk AI Lab - Randevu Sistemi (AI Lab oda randevu)
 * Backend entrypoint.
 *
 * Güvenlik: helmet, CORS whitelist, rate limit, audit log, RS256 JWT (User+Admin ayrı).
 */
// OpenTelemetry — auto-instrumentation için EN BAŞTA initialize edilir
import { initOtel } from './observability/otel';
void initOtel();

import { config } from './config/env';
import { initSchema, closeDb } from './db/schema';
import { logger } from './utils/logger';
import { closeAllSse } from './services/sse.service';
import { startWaitlistMaintenance } from './services/waitlist.service';
import { warmupEmbeddings, backfillEmbeddings } from './services/embedding.service';
import { warmupTranslation } from './services/image-gen.service';
import { startMaintenance } from './services/maintenance.service';
import { startBackupCron } from './services/backup.service';
import { buildApp } from './app';

async function start(): Promise<void> {
  const migrationResult = await initSchema();
  logger.info('schema_ready', { applied: migrationResult.applied });
  if (migrationResult.applied.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[KLAB] Uygulanan migrationlar: ${migrationResult.applied.join(', ')}`);
  }

  // Embedding modeli arka planda warm-up, ardından eksik booking embedding'lerini
  // backfill et (idempotent — yalnız embedding'i olmayanları işler). Böylece benzer
  // proje / iş birliği / duplicate-tespiti (#4) re-seed sonrası kutudan çıktığı gibi
  // çalışır; manuel admin backfill gerekmez. Non-blocking.
  void warmupEmbeddings()
    .then(() => backfillEmbeddings())
    .then((r) => {
      if (r.processed > 0) {
        logger.info('embedding_backfill_done', { processed: r.processed, skipped: r.skipped });
      }
    })
    .catch((err) =>
      logger.warn('embedding_warmup_or_backfill_failed', { err: (err as Error).message })
    );

  // Görsel prompt çeviri modelini (HF opus-mt-tr-en) arka planda ısıt — ilk
  // görsel üretiminde soğuk-başlangıç çevirisi zaman aşımına düşmesin. Non-blocking.
  void warmupTranslation();

  // Waitlist promotion cron (yarım dakika periyot)
  startWaitlistMaintenance();

  // Refresh token cleanup + audit retention cron (6 saat)
  startMaintenance();

  // DB backup cron (default 24h)
  startBackupCron();

  const app = buildApp();
  const server = app.listen(config.port, config.host, () => {
    logger.info('server_started', {
      host: config.host,
      port: config.port,
      env: config.nodeEnv,
    });
    // eslint-disable-next-line no-console
    console.log(`\n[KLAB] Backend hazır → http://${config.host}:${config.port}\n`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_signal', { signal });

    // Force-exit guard: uzun-ömürlü bağlantılar/asılı job'lar shutdown'ı sonsuza
    // kadar bloklamasın (timeout sonunda non-zero ile çık → orchestrator restart).
    const forceTimer = setTimeout(() => {
      logger.error('shutdown_forced_timeout');
      process.exit(1);
    }, 15_000);
    forceTimer.unref();

    // 1) Açık SSE stream'lerini kapat (yoksa server.close() asılı kalır).
    closeAllSse();

    server.close(() => {
      // 2) DB pool'u kapat.
      void (async () => {
        try {
          await closeDb();
        } catch (err) {
          logger.warn('db_close_failed', { err: (err as Error).message });
        }
        clearTimeout(forceTimer);
        logger.info('server_closed');
        process.exit(0);
      })();
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Savunma katmanı: kaçan promise rejection'ları process'i öldürmesin (Node >=15
  // varsayılanı crash). Loglanır; kalıcı hata sinyali için uncaughtException'da
  // graceful shutdown tetiklenir.
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', { err: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[KLAB] Başlatma hatası:', err);
  process.exit(1);
});
