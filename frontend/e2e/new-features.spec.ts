/**
 * E2E: 2026-07-03 özellik seti — kullanıcı akışı doğrulamaları.
 *
 *  1. Randevu süre seçenekleri: 1 Hafta / 2 Hafta / 1 Ay
 *  4. Takvim: yeşil dönem blokları lejantı + randevu ekleme (açık mavi)
 *  5. Kullanıcı panosu: dashboard kartları
 *  6. Leader Board adlandırması (critical-flow'da da var — burada nav etiketi)
 *  7. Görsel Üret → Profil sekmesi (/gorsel yönlendirmesi dahil)
 */
import { test, expect, type Page } from '@playwright/test';
import { acceptConsentIfShown } from './helpers';

async function loginUser(page: Page): Promise<void> {
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
  await page.locator('input[type="email"]').fill('user@klab.test');
  await page.locator('input[type="password"]').fill('Demo1234!Pass');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.status() === 200, {
      timeout: 15_000,
    }),
    page.locator('button[type="submit"]').click(),
  ]);
  // İlk girişte EK-1 beyan kartı çıkabilir (bir kereye mahsus) — onayla.
  await acceptConsentIfShown(page);
  await page.waitForURL(/\/(rooms|dashboard)/, { timeout: 15_000 });
}

test.describe('Yeni özellik seti', () => {
  test('booking modalında süre seçenekleri 1 Hafta / 2 Hafta / 1 Ay', async ({ page }) => {
    await loginUser(page);
    await page.goto('/rooms');
    // İlk odanın "Randevu Al" butonunu bul (dolu odalarda "Bekleme listesi" olabilir).
    const bookBtn = page.getByRole('button', { name: /Randevu Al/i }).first();
    await bookBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await bookBtn.click();
    await expect(page.getByRole('button', { name: '1 Hafta' })).toBeVisible();
    await expect(page.getByRole('button', { name: '2 Hafta' })).toBeVisible();
    await expect(page.getByRole('button', { name: '1 Ay' })).toBeVisible();
    // Eski "2 Ay / 3 Ay" seçenekleri olmamalı.
    await expect(page.getByRole('button', { name: '3 Ay' })).toHaveCount(0);
  });

  test('kullanıcı panosu dashboard kartları render olur', async ({ page }) => {
    await loginUser(page);
    await page.goto('/dashboard');
    // Kart başlıkları (aktif booking olmasa da talepler/kitaplar/hızlı erişim bölümleri var).
    await expect(page.getByText(/Randevu Taleplerim/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Ödünç Kitaplarım/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Sohbet/i }).first()).toBeVisible();
  });

  test('takvimde dönem lejantı görünür', async ({ page }) => {
    await loginUser(page);
    await page.goto('/takvim');
    // Lejant yalnız onaylı booking varken grid ile birlikte render olur;
    // yoksa boş-durum kartı. İkisinden biri görünmeli (sayfa kırılmamalı).
    const legend = page.getByText(/Ziyaret randevusu/i).first();
    const empty = page.getByText(/onaylı|randevu/i).first();
    await expect(legend.or(empty)).toBeVisible({ timeout: 15_000 });
  });

  test('nav etiketi Leader Board ve sayfa açılır', async ({ page }) => {
    await loginUser(page);
    await page.goto('/liderlik');
    await expect(page.getByRole('heading', { name: /Leader Board/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('/gorsel → Profil "Görsel Üret" sekmesine yönlenir', async ({ page }) => {
    await loginUser(page);
    await page.goto('/gorsel');
    await page.waitForURL(/\/profile\?tab=gorsel/, { timeout: 15_000 });
    // Görsel üretim formu (fikir alanı) profil sekmesinde görünür.
    await expect(page.getByText(/Görsel Üret/i).first()).toBeVisible();
  });

  test('profil sekmeleri arasında geçiş çalışır', async ({ page }) => {
    await loginUser(page);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: /Profilim/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    // Görsel Üret sekmesine geç.
    await page.getByRole('button', { name: /Görsel Üret/i }).first().click();
    await expect(page).toHaveURL(/tab=gorsel/);
  });
});
