/**
 * DB backup servisi — yalnız PostgreSQL.
 *
 * PostgreSQL'de uygulama-içi atomic snapshot YOKTUR; backup pg_dump /
 * pg_basebackup / managed servis (RDS, Cloud SQL, Azure DB) ile yapılır.
 * Bu servis pg'de NO-OP'tur — arayüz (route + cron) korunur ama dosya yazmaz.
 *
 * GERÇEK YEDEKLEME: docker-compose.prod.yml'deki `postgres-backup` sidecar'ı
 * (pg_dump, gece 02:30, 7g/4h/6a saklama). Prosedür ve restore tatbikatı:
 * docs/backup-restore-runbook.md
 */
import { logger } from '../utils/logger';

interface BackupConfig {
  /** Saat cinsinden backup periyodu. */
  intervalHours: number;
  /** Kaç backup dosyası saklansın. */
  keepCount: number;
}

const DEFAULT_CONFIG: BackupConfig = {
  intervalHours: 24,
  keepCount: 7,
};

export async function runBackupOnce(): Promise<{ file: string; sizeBytes: number }> {
  logger.info('db_backup_skipped_pg', { note: 'pg backup pg_dump/managed ile yapılır' });
  return { file: '', sizeBytes: 0 };
}

export function pruneBackups(_keepCount = DEFAULT_CONFIG.keepCount): number {
  return 0;
}

export function listBackups(): Array<{ file: string; sizeBytes: number; createdAt: string }> {
  return [];
}

export function startBackupCron(_config: Partial<BackupConfig> = {}): void {
  // pg: uygulama-içi backup yok — cron no-op. "Yedek alınıyor" yanılsaması
  // yaratmamak için açıkça loglanır; gerçek yedek postgres-backup sidecar'ında.
  logger.info('db_backup_cron_noop', {
    note: 'Uygulama-içi yedek YOK — pg_dump sidecar kullanılır (docs/backup-restore-runbook.md)',
  });
}

export function stopBackupCron(): void {
  // no-op (cron çalışmıyor)
}
