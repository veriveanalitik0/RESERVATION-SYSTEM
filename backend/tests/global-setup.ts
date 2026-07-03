/**
 * Vitest global setup — tüm test run'ından ÖNCE bir kez çalışır.
 *
 * klab_test PostgreSQL şemasını sıfırlar (önceki run'ın tüm tabloları/verisi gider).
 * Test dosyaları beforeAll'da initSchema() çağırıp şemayı yeniden kurar; testler
 * sequential çalışır (vitest fileParallelism: false) ve nanoid kimlikleriyle izole.
 *
 * NOT: Docker `klab-postgres` ayakta + `klab_test` veritabanı mevcut olmalı.
 */
import { Client } from 'pg';

export default async function globalSetup(): Promise<void> {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? 'postgres://klab:klab_dev_password@localhost:5432/klab_test';

  // Güvenlik kilidi: DROP SCHEMA CASCADE yıkıcıdır. URL'deki veritabanı adı
  // 'test' içermiyorsa (ör. yanlış porttaki başka projenin Postgres'ine
  // bağlanıldıysa) hiçbir şey silmeden açık hatayla dur.
  const dbName = new URL(connectionString).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(
      `global-setup: '${dbName}' test veritabanı gibi görünmüyor (adında 'test' yok). ` +
        `TEST_DATABASE_URL ile doğru test DB'sini verin — şema silme iptal edildi.`
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  // Bağlanılan sunucu gerçekten beklenen DB mi? (defense-in-depth)
  const check = await client.query('SELECT current_database() AS db');
  if (check.rows[0]?.db !== dbName) {
    await client.end();
    throw new Error(`global-setup: bağlanılan DB '${check.rows[0]?.db}' beklenen '${dbName}' değil.`);
  }
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
}
