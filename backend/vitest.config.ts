import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 15_000,
    pool: 'forks',
    fileParallelism: false, // tek pg test DB paylaşıldığından sequential
    globalSetup: ['./tests/global-setup.ts'], // run başında pg şema sıfırlama
    coverage: {
      // include verilmezse yalnız import edilen dosyalar rapora girer ve
      // kapsam olduğundan YÜKSEK görünür (test edilmeyen dosyalar görünmez).
      include: ['src/**/*.ts'],
      exclude: ['src/db/seed.ts', 'src/db/seed-books.ts', 'src/openapi.ts'],
      reporter: ['text-summary', 'html'],
      // Minimum kapsam eşikleri — REGRESYON BARİYERİ (ratchet): mevcut ölçülen
      // kapsamın (≈%38 satır / %32 dal, 174 test) hemen altına ayarlandı. Amaç
      // CI'ı kırmadan kapsamın DÜŞMESİNİ engellemek; test eklendikçe kademeli
      // yükseltin. NOT: değerler gerçek koşumla doğrulanmıştır (uydurma değil).
      thresholds: {
        lines: 37,
        functions: 35,
        statements: 37,
        branches: 31,
      },
    },
  },
});
