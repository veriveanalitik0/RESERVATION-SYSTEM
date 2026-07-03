/**
 * E2E: auth + landing + login + register
 */
import { test, expect } from '@playwright/test';

test.describe('Landing & Auth', () => {
  test('landing açılır ve giriş kartı görünür', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kuveyt Türk · Yapay Zeka Laboratuvarı/);
    await expect(page.getByRole('link', { name: /Giriş Yap/i }).first()).toBeVisible();
  });

  test('user login → /rooms', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await page.locator('input[type="email"]').fill('user@klab.test');
    await page.locator('input[type="password"]').fill('Demo1234!Pass');
    // Submit & wait for network
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.status() === 200, {
        timeout: 15_000,
      }),
      page.locator('button[type="submit"]').click(),
    ]);
    expect(resp.status()).toBe(200);
    // Login sonrası: aktif booking'i olan kullanıcı /dashboard'a, yoksa /rooms'a
    // yönlenir (Login.tsx redirectAfterLogin). İkisi de geçerli kimlikli giriştir.
    await page.waitForURL(/\/(rooms|dashboard)/, { timeout: 15_000 });
  });

  test('admin login → /admin', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await page.locator('input[type="email"]').fill('admin@klab.test');
    await page.locator('input[type="password"]').fill('Admin1234!Pass');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.status() === 200, {
        timeout: 15_000,
      }),
      page.locator('button[type="submit"]').click(),
    ]);
    expect(resp.status()).toBe(200);
    await page.waitForURL(/\/admin/, { timeout: 15_000 });
  });

  test('hatalı parola → AUTH_FAILED hatası', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await page.locator('input[type="email"]').fill('user@klab.test');
    await page.locator('input[type="password"]').fill('WrongPassword!1');
    await page.locator('button[type="submit"]').click();
    // Backend dönmesini bekle
    await page.waitForResponse(
      (r) => r.url().includes('/api/auth/login') && r.status() === 401,
      { timeout: 15_000 }
    );
    // Toast veya inline error gösterilmeli
    await expect(
      page
        .getByText(/E-posta veya parola hatalı|geçersiz|başarısız/i)
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
