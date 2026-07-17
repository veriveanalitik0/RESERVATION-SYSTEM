/**
 * E2E: auth + landing + login + register
 */
import { test, expect } from '@playwright/test';
import { registerAndLogin } from './helpers';

test.describe('Landing & Auth', () => {
  test('landing açılır ve giriş kartı görünür', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kuveyt Türk · Yapay Zeka Laboratuvarı/);
    await expect(page.getByRole('link', { name: /Giriş Yap/i }).first()).toBeVisible();
  });

  test('user kayıt + otomatik giriş → /rooms', async ({ page }) => {
    // Temiz (prod-benzeri) DB'de seed'li demo kullanıcı yok. Kayıt akışı backend'de
    // otomatik login yapar; EK-1 beyanı onaylanınca /rooms'a (veya /dashboard'a)
    // yönlenir — kimlikli oturumun uçtan uca kurulduğunu doğrular.
    await registerAndLogin(page);
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
    // Temiz DB'de bu e-posta kayıtlı olmasa bile backend GENERIC 401 döner
    // (kullanıcı varlığını ifşa etmez) → test hesabın var/yok olmasından bağımsız geçer.
    await page.goto('/login');
    await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await page.locator('input[type="email"]').fill('yok.kullanici@klab.test');
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
