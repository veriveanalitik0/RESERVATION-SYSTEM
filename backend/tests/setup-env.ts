/**
 * Vitest için ortak setup — PostgreSQL test veritabanı (klab_test).
 *
 * NOT: Bu dosya `import` edildiği anda `process.env`'i set eder.
 * Bütün test dosyaları en üstte bunu import etmeli:
 *   import './setup-env';
 *
 * Şema sıfırlama tests/global-setup.ts'te (run başında bir kez) yapılır.
 * Docker `klab-postgres` ayakta + `klab_test` veritabanı mevcut olmalı.
 */
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://klab:klab_dev_password@localhost:5432/klab_test';
process.env.CSRF_SECRET = 'test_csrf_secret_minimum_32_chars_value_aaaa';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
// Mevcut key yollarını koru (üretilmiş key'ler var)
process.env.USER_JWT_PRIVATE_KEY_PATH ??= './keys/user_private.pem';
process.env.USER_JWT_PUBLIC_KEY_PATH ??= './keys/user_public.pem';
process.env.ADMIN_JWT_PRIVATE_KEY_PATH ??= './keys/admin_private.pem';
process.env.ADMIN_JWT_PUBLIC_KEY_PATH ??= './keys/admin_public.pem';
