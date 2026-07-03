/**
 * DB Initialization Script
 * Schema oluşturur ve demo seed verisini yükler.
 */
import { initSchema, closeDb } from '../src/db/schema';
import { runSeed } from '../src/db/seed';

async function main(): Promise<void> {
  console.log('==============================================');
  console.log('  Kuveyt Türk AI Lab - Database Init');
  console.log('==============================================\n');

  console.log('[DB] Schema oluşturuluyor...');
  await initSchema();
  console.log('[DB] Schema hazır.\n');

  console.log('[DB] Seed data yükleniyor...');
  await runSeed();
  console.log('\n[DB] Hazır.');

  console.log('\n--- DEMO CREDENTIAL ---');
  console.log('User : user@klab.test / Demo1234!Pass');
  console.log('Admin: admin@klab.test / Admin1234!Pass');

  await closeDb();
}

main().catch((err) => {
  console.error('[DB INIT HATA]', err);
  process.exit(1);
});
