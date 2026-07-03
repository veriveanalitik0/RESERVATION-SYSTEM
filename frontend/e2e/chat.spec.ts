/**
 * E2E: genel sohbet (rol-bağımsız chat) — `/sohbet`
 */
import { test, expect, Page } from '@playwright/test';

async function userLogin(page: Page): Promise<void> {
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
  // Aktif booking'i olan kullanıcı /dashboard'a, yoksa /rooms'a yönlenir.
  await page.waitForURL(/\/(rooms|dashboard)/, { timeout: 15_000 });
}

test('sohbet sayfası açılır + kişi listesi yüklenir', async ({ page }) => {
  await userLogin(page);
  await page.goto('/sohbet');
  await expect(page.getByRole('heading', { name: /^Mesajlar$/ })).toBeVisible({
    timeout: 10_000,
  });
  // Kişi listesi — en az bir kişi gelmeli (contacts endpoint çalışıyor).
  await expect(page.locator('aside button[type="button"]').first()).toBeVisible({
    timeout: 10_000,
  });
});

test('bir kişiyle mesaj gönderilebilir', async ({ page }) => {
  await userLogin(page);
  await page.goto('/sohbet');
  await page.locator('aside button[type="button"]').first().click();
  // Konuşma penceresi açılır — mesaj girişi görünür.
  const input = page.locator('textarea');
  await expect(input).toBeVisible({ timeout: 10_000 });
  const text = `E2E test mesajı ${Date.now()}`;
  await input.fill(text);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/chat/messages') && r.status() === 201,
      { timeout: 15_000 }
    ),
    page.getByRole('button', { name: /Gönder/ }).click(),
  ]);
  // Gönderilen mesaj baloncuğu konuşma penceresinde görünür.
  await expect(page.locator('section').getByText(text)).toBeVisible({
    timeout: 10_000,
  });
});
