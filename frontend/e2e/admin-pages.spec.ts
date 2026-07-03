/**
 * E2E: admin paneli — tüm yeni sayfalar açılır mı + critical UI elementleri
 */
import { test, expect, Page } from '@playwright/test';

async function adminLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill('admin@klab.test');
  await page.locator('input[type="password"]').fill('Admin1234!Pass');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.describe('Admin pages', () => {
  test('takvim sayfası açılır + ay başlığı görünür', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/calendar');
    const monthNames = /Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık/;
    await expect(page.locator('h3', { hasText: monthNames }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('analitik sayfası açılır + stat kartları yüklenir', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/analytics');
    await expect(page.getByText(/Analiz Paneli/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/TOPLAM TALEP/i)).toBeVisible();
  });

  test('güvenlik sayfası açılır + TOTP başlığı', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/security');
    // Sayfa header'ı her zaman görünür; TOTP başlığı async status yüklemesinin ardından
    await expect(page.getByRole('heading', { name: /^Güvenlik$/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /TOTP.*Authenticator/i })).toBeVisible({ timeout: 15_000 });
  });

  test('bekleme sayfası açılır', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/waitlist');
    await expect(page.getByText(/Bekleme Listesi/i)).toBeVisible({ timeout: 10_000 });
  });

  test('kullanıcılar sayfası arama input ile yüklenir', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/users');
    await expect(page.getByPlaceholder(/Ad, e-posta/i)).toBeVisible({ timeout: 10_000 });
  });
});
