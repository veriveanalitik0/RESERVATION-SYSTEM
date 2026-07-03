/**
 * E2E: public showcase (auth gerekmez)
 */
import { test, expect } from '@playwright/test';

test('showcase sayfası auth olmadan açılır', async ({ page }) => {
  await page.goto('/showcase');
  await expect(page.getByText(/Vibe Coding Envanteri/i)).toBeVisible();
});

test('showcase arama input çalışır', async ({ page }) => {
  await page.goto('/showcase');
  const search = page.getByPlaceholder(/Proje, ekip üyesi veya teknoloji/i);
  await expect(search).toBeVisible();
  await search.fill('test');
  // Sonuç olsun veya olmasın, crash etmemeli
  await page.waitForTimeout(500);
});
