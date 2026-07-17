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

  console.log('\n--- BOOTSTRAP ADMIN (ilk girişten sonra parolayı DEĞİŞTİRİN) ---');
  console.log('Admin: admin@klab.test / Admin1234!Pass');
  console.log('Not: Arge/danışman/izleyici rolleri admin panelinden atanır.');

  await closeDb();
}

main().catch((err) => {
  console.error('[DB INIT HATA]', err);
  process.exit(1);
});
