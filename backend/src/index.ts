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
import { seedIfEmpty } from './db/seed';
import { warmupTranslation } from './services/image-gen.service';
import { startMaintenance } from './services/maintenance.service';
import { startBackupCron } from './services/backup.service';
import { buildApp } from './app';

async function start(): Promise<void> {
  const migrationResult = await initSchema();
  logger.info('schema_ready', { applied: migrationResult.applied });
  if (migrationResult.applied.length > 0) {

    console.log(`[KLAB] Uygulanan migrationlar: ${migrationResult.applied.join(', ')}`);
  }

  // İlk-kurulum otomasyonu: DB boşsa (hiç admin yoksa) çekirdek seed'i (oda +
  // bootstrap admin + kitap katalogu) otomatik yükle. Idempotent + yalnız boş
  // DB'de çalışır → prod'da manuel seed adımı GEREKMEZ. Seed hatası boot'u
  // durdurmasın (loglanır); dolu DB'de sessizce atlanır.
  try {
    if (await seedIfEmpty()) {
      logger.info('bootstrap_seed_applied');
    }
  } catch (err) {
    logger.error('bootstrap_seed_failed', { err: (err as Error).message });
  }

  // Görsel prompt çeviri modelini (HF opus-mt-tr-en) arka planda ısıt — ilk
  // görsel üretiminde soğuk-başlangıç çevirisi zaman aşımına düşmesin. Non-blocking.
  // FEATURE_VISUALS=false → özellik kapalı, dış API'ye warm-up isteği de atılmaz.
  if (config.visualsEnabled) void warmupTranslation();

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
   
  console.error('[KLAB] Başlatma hatası:', err);
  process.exit(1);
});
