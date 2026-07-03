/**
 * Periyodik bakım işleri (cron).
 *
 * - Refresh token cleanup: süresi geçmiş + uzun zamandır revoked olan token'ları siler.
 * - Audit retention: data_security §11 — eski audit_logs N gün sonra silinebilir (config'den).
 *   (Default 365 gün — bankacılık için tipik.)
 *
 * Çalışma: setInterval. Çok-instance ortamında periyodik silme işinin her instance'ta
 * tekrar koşmaması için cron tick'i `runIfCronLeader` (pg_advisory kilidi) ile korunur —
 * yalnız kilidi alan instance prune + VACUUM yapar. Tek-instance'ta kilit hep alınır,
 * davranış aynıdır. NOT: VACUUM transaction içinde çalışamadığından, prune işi leader
 * kilidini tutan tx içinde yapılır, VACUUM ise leader olduğu doğrulandıktan sonra tx
 * dışında best-effort koşar.
 */
import { dbExec, dbOne, dbRun } from '../db/schema';
import { runIfCronLeader } from '../db/cron-lock';
import { markPastAppointmentsCompleted } from './appointment.service';
import { markOverdueLoans } from './book.service';
import { recoverStuckVisuals } from './visual.service';
import { logger } from '../utils/logger';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface MaintenanceConfig {
  /** Süresi geçmiş VE revoked olan refresh token'ları kaç gün sonra sil. */
  refreshTokenGraceDays: number;
  /** audit_logs yaş-bazlı retention (gün). 0 = silme. */
  auditRetentionDays: number;
  /** audit_logs hacim sınırı — en yeni N kayıt tutulur (yaştan bağımsız şişme koruması). 0 = sınırsız. */
  auditMaxRows: number;
  /** Silme sonrası VACUUM çalıştır (ölü tuple alanını geri kazanır). */
  vacuumOnPrune: boolean;
  /** Cron periyodu (ms). */
  intervalMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const DEFAULT_CONFIG: MaintenanceConfig = {
  refreshTokenGraceDays: 30,
  // data_security §11 — bankacılık tipik 1 yıl; ortamına göre AUDIT_RETENTION_DAYS ile kısalt.
  auditRetentionDays: envInt('AUDIT_RETENTION_DAYS', 365),
  // Hacim güvenliği: yüksek log üretiminde audit_logs tablosunun şişmesini önler.
  auditMaxRows: envInt('AUDIT_MAX_ROWS', 200_000),
  vacuumOnPrune: process.env.AUDIT_VACUUM !== 'false',
  intervalMs: 6 * 60 * 60 * 1000, // 6 saat
};

let timer: NodeJS.Timeout | null = null;

/**
 * Yalnız silme işleri (transaction-güvenli — VACUUM HARİÇ). Counts döner.
 * Hem `runMaintenanceOnce` (doğrudan/test) hem leader-korumalı cron tick'i bunu kullanır.
 */
async function pruneOnce(
  cfg: MaintenanceConfig
): Promise<{ refreshTokensDeleted: number; auditLogsDeleted: number }> {
  // 1) Refresh token cleanup
  const tokenCutoff = new Date(Date.now() - cfg.refreshTokenGraceDays * ONE_DAY_MS).toISOString();
  const tokenRes = await dbRun(`DELETE FROM refresh_tokens
       WHERE (expires_at < ? OR revoked = 1)
         AND created_at < ?`, [tokenCutoff, tokenCutoff]);

  // 2) Audit log retention — yaş bazlı
  let auditDeleted = 0;
  if (cfg.auditRetentionDays > 0) {
    const auditCutoff = new Date(
      Date.now() - cfg.auditRetentionDays * ONE_DAY_MS
    ).toISOString();
    auditDeleted += (await dbRun(`DELETE FROM audit_logs WHERE created_at < ?`, [auditCutoff])).changes;
  }

  // 3) Audit log hacim sınırı — en yeni N kayıt tutulur. Yaş retention'ı aşan
  //    yüksek log üretiminde dosyanın patlamasını engeller.
  if (cfg.auditMaxRows > 0) {
    const total = (await dbOne('SELECT COUNT(*) AS c FROM audit_logs', []) as { c: number }).c;
    if (total > cfg.auditMaxRows) {
      auditDeleted += (await dbRun(`DELETE FROM audit_logs
           WHERE id IN (
             SELECT id FROM audit_logs ORDER BY created_at ASC, id ASC LIMIT ?
           )`, [total - cfg.auditMaxRows])).changes;
    }
  }

  return { refreshTokensDeleted: tokenRes.changes, auditLogsDeleted: auditDeleted };
}

/** Silme sonrası ölü tuple alanını geri kazan (best-effort; VACUUM tx-dışı koşmalı). */
async function vacuumIfNeeded(cfg: MaintenanceConfig, totalDeleted: number): Promise<boolean> {
  if (!cfg.vacuumOnPrune || totalDeleted <= 0) return false;
  try {
    await dbExec('VACUUM'); // pg'de de geçerli; best-effort (try/catch)
    return true;
  } catch (err) {
    logger.warn('maintenance_vacuum_failed', { err: (err as Error).message });
    return false;
  }
}

export async function runMaintenanceOnce(config: Partial<MaintenanceConfig> = {}): Promise<{
  refreshTokensDeleted: number;
  auditLogsDeleted: number;
  appointmentsCompleted: number;
  overdueLoans: number;
  stuckVisualsRecovered: number;
  vacuumed: boolean;
}> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { refreshTokensDeleted, auditLogsDeleted } = await pruneOnce(cfg);
  const appointmentsCompleted = await markPastAppointmentsCompleted();
  const overdueLoans = await markOverdueLoans();
  // Çökme/restart sonrası 'generating'/'enhancing' durumunda asılı kalan görselleri
  // 'error' yap → aksi halde regenerateVisual guard'ı kalıcı VISUAL_BUSY döner.
  const stuckVisualsRecovered = await recoverStuckVisuals();
  const totalDeleted = refreshTokensDeleted + auditLogsDeleted;
  const vacuumed = await vacuumIfNeeded(cfg, totalDeleted);

  const result = { refreshTokensDeleted, auditLogsDeleted, appointmentsCompleted, overdueLoans, stuckVisualsRecovered, vacuumed };
  if (totalDeleted > 0 || appointmentsCompleted > 0 || overdueLoans > 0 || stuckVisualsRecovered > 0) {
    logger.info('maintenance_completed', result);
  }
  return result;
}

/**
 * Cron tick'i: leader-korumalı. Prune işi (tx-güvenli) advisory kilidini tutan tx
 * içinde koşar; VACUUM (tx-dışı) yalnız leader olunduğunda, tx dışında çalışır.
 * Leader değilse (başka instance yürütüyor) hiçbir şey yapılmaz.
 */
async function runMaintenanceTick(cfg: MaintenanceConfig): Promise<void> {
  let counts = { refreshTokensDeleted: 0, auditLogsDeleted: 0 };
  let appointmentsCompleted = 0;
  let overdueLoans = 0;
  let stuckVisualsRecovered = 0;
  const wasLeader = await runIfCronLeader('cron:maintenance', async () => {
    counts = await pruneOnce(cfg);
    appointmentsCompleted = await markPastAppointmentsCompleted();
    overdueLoans = await markOverdueLoans();
    stuckVisualsRecovered = await recoverStuckVisuals();
  });
  if (!wasLeader) return;

  const totalDeleted = counts.refreshTokensDeleted + counts.auditLogsDeleted;
  const vacuumed = await vacuumIfNeeded(cfg, totalDeleted);
  if (totalDeleted > 0 || appointmentsCompleted > 0 || overdueLoans > 0 || stuckVisualsRecovered > 0) {
    logger.info('maintenance_completed', { ...counts, appointmentsCompleted, overdueLoans, stuckVisualsRecovered, vacuumed });
  }
}

export function startMaintenance(config: Partial<MaintenanceConfig> = {}): void {
  if (timer) return;
  const cfg = { ...DEFAULT_CONFIG, ...config };
  // İlk çalışma — server start sonrası 10sn bekle
  setTimeout(() => {
    // await edilmeyen çağrıda catch hiç tetiklenmiyordu (kaçan promise).
    void runMaintenanceTick(cfg).catch((err) => {
      logger.warn('maintenance_initial_run_failed', { err: (err as Error).message });
    });
  }, 10_000);
  timer = setInterval(() => {
    void runMaintenanceTick(cfg).catch((err) => {
      logger.warn('maintenance_run_failed', { err: (err as Error).message });
    });
  }, cfg.intervalMs);
}

export function stopMaintenance(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
