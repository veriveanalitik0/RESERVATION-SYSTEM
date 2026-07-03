/**
 * Cron leader-election — pg_advisory kilidiyle.
 *
 * Çok-instance ortamda yalnız TEK instance'ın periyodik (cron) işi çalıştırmasını
 * sağlar. `pg_try_advisory_xact_lock` kullanılır: kilit transaction süresince tutulur
 * ve commit/rollback'te OTOMATİK serbest kalır — bağlantı havuzunda manuel unlock /
 * bağlantı-affinity derdi yoktur. Kilidi alamayan instance (başka biri işi yürütüyor)
 * sessizce atlar.
 *
 * Tek-instance dağıtımda kilit her zaman alınır → davranış birebir aynıdır; bu yalnız
 * ileride yatay ölçeklemeye geçilirse ucuz bir korumadır (Redis gerektirmez).
 *
 * UYARI: work() bir transaction İÇİNDE koşar — içinde VACUUM/COMMIT gibi tx-dışı komut
 * OLMAMALIDIR. Tx-dışı işler (ör. VACUUM) leader olunduğu doğrulandıktan SONRA, bu
 * fonksiyonun dışında çalıştırılmalıdır.
 */
import { dbTx, dbOne } from './schema';

/**
 * `lockKey` için cron liderliğini dener. Liderse work() çalışır ve true döner;
 * değilse work() ÇALIŞMAZ ve false döner.
 */
export async function runIfCronLeader(
  lockKey: string,
  work: () => Promise<void>
): Promise<boolean> {
  return dbTx(async () => {
    const row = (await dbOne(
      'SELECT pg_try_advisory_xact_lock(hashtext(?)) AS locked',
      [lockKey]
    )) as { locked: boolean } | undefined;
    if (!row || row.locked !== true) return false;
    await work();
    return true;
  });
}
