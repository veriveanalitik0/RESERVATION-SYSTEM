/**
 * E2E: genel sohbet (rol-bağımsız chat) — `/sohbet`
 */
import { test, expect, Page } from '@playwright/test';
import { registerAndLogin } from './helpers';

async function userLogin(page: Page): Promise<void> {
  // Temiz DB'de seed'li demo kullanıcı yok → test kendi hesabını kaydeder.
  // Kişi listesinde en az bootstrap admin görünür (chat kişileri = tüm user+admin).
  await registerAndLogin(page);
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
