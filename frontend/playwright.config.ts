import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config.
 *
 * Çalıştırmadan önce:
 *  - Backend ayakta olmalı (http://127.0.0.1:4000)
 *  - Frontend ayakta olmalı (http://127.0.0.1:5173)
 *
 * Komut: npm run e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // sequential — shared DB state
  retries: process.env.CI ? 2 : 0, // CI'da flaky toleransı (job artık bloklayıcı)
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
