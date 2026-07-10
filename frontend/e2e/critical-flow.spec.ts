/**
 * E2E: kritik akışlar (#6) — yeni özellikler.
 *
 *  - Showcase feed (#3): tek istekle galeri yüklenir.
 *  - Kiosk (#5b): public oda seçici → tam ekran oda ekranı.
 *  - Leaderboard (#5a): user login → Liderlik sıralaması.
 *
 * Ön koşul: backend (:4000) + frontend (:5173) ayakta (bkz. playwright.config.ts).
 */
import { test, expect } from '@playwright/test';
import { acceptConsentIfShown } from './helpers';

async function loginAsUser(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
  await page.locator('input[type="email"]').fill('user@klab.test');
  await page.locator('input[type="password"]').fill('Demo1234!Pass');
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/auth/login') && r.status() === 200,
      { timeout: 15_000 }
    ),
    page.locator('button[type="submit"]').click(),
  ]);
  // İlk girişte EK-1 beyan kartı çıkabilir (bir kereye mahsus) — onayla.
  await acceptConsentIfShown(page);
  // Aktif booking'i olan kullanıcı /dashboard'a, yoksa /rooms'a yönlenir.
  await page.waitForURL(/\/(rooms|dashboard)/, { timeout: 15_000 });
}

test.describe('Showcase feed (#3)', () => {
  test('galeri TEK /showcase/feed isteğiyle yüklenir', async ({ page }) => {
    const feedCalls: string[] = [];
    const legacyCalls: string[] = [];
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/public/showcase/feed')) feedCalls.push(u);
      else if (
        u.includes('/api/public/showcase/technologies') ||
        u.includes('/api/public/showcase/engagement') ||
        /\/api\/public\/showcase(\?|$)/.test(u)
      ) {
        legacyCalls.push(u);
      }
    });
    // waitForResponse'u navigasyondan ÖNCE kur (race önleme).
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/public/showcase/feed') && r.status() === 200,
        { timeout: 15_000 }
      ),
      page.goto('/showcase'),
    ]);
    await expect(page.getByText(/Vibe Coding Envanteri/i)).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Feed çağrıldı, eski 3 ayrı endpoint ÇAĞRILMADI (batch birleştirme).
    expect(feedCalls.length).toBeGreaterThan(0);
    expect(legacyCalls.length).toBe(0);
  });
});

test.describe('Kiosk (#5b)', () => {
  test('public oda seçici → tam ekran oda ekranı', async ({ page }) => {
    await page.goto('/kiosk');
    await expect(page.getByRole('heading', { name: /Bir oda seçin/i })).toBeVisible();
    // İlk oda kartına tıkla → /kiosk/:roomId
    const firstRoom = page.locator('a[href^="/kiosk/"]').first();
    await expect(firstRoom).toBeVisible({ timeout: 10_000 });
    await firstRoom.click();
    await page.waitForURL(/\/kiosk\/.+/, { timeout: 10_000 });
    // Kiosk ekranında "Oda seç" çıkış linki görünür (görsel ya da idle, ikisi de geçer).
    await expect(page.getByRole('link', { name: /Oda seç/i })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Leaderboard (#5a)', () => {
  test('user login → Liderlik sıralaması görünür', async ({ page }) => {
    await loginAsUser(page);
    // Sıralama API'sini navigasyondan ÖNCE bekle (race önleme).
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/user/leaderboard') && r.status() === 200,
        { timeout: 15_000 }
      ),
      page.goto('/liderlik'),
    ]);
    await expect(page.getByRole('heading', { name: /Leader Board/i })).toBeVisible({
      timeout: 10_000,
    });
    // Tab'lar + skor formülü açıklaması
    await expect(page.getByRole('button', { name: /Kullanıcılar/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Projeler/i })).toBeVisible();
    // Projeler sekmesine geçiş çalışır
    await page.getByRole('button', { name: /Projeler/i }).click();
    await expect(page.getByText(/Skor:/i)).toBeVisible();
  });
});
