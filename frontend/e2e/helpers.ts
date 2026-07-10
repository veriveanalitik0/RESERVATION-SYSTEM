/**
 * E2E ortak yardımcıları.
 */
import type { Page } from '@playwright/test';

/**
 * EK-1 "Okudum, Kabul Ettim" beyan kartı — user-tabanlı hesaplar için login
 * sonrası BİR KEREYE MAHSUS çıkar (consent_accepted_at NULL ise). Taze seed'li
 * DB'de (CI) ilk user girişinde görünür; onaylanınca bir daha görünmez.
 * Kart çıktıysa: metni sonuna kadar kaydır (onay kutusu şartı) → kutuyu
 * işaretle → "Onaylıyorum ve Devam Et". Çıkmadıysa sessizce döner.
 */
export async function acceptConsentIfShown(page: Page): Promise<void> {
  const acceptBtn = page.getByRole('button', { name: /Onaylıyorum ve Devam Et/i });
  try {
    await acceptBtn.waitFor({ state: 'visible', timeout: 4_000 });
  } catch {
    return; // Kart yok — beyan daha önce onaylanmış.
  }
  // Scroll-to-end şartı: kaydırılabilir beyan bölgesini sonuna indir.
  await page.evaluate(() => {
    const scroller = document.querySelector('.overflow-y-auto.scrollbar-thin');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  const checkbox = page.locator('input[type="checkbox"]');
  await checkbox.check({ timeout: 10_000 }); // scroll sonrası enable olmasını bekler
  await acceptBtn.click();
}
