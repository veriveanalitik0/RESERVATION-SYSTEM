/**
 * E2E ortak yardımcıları.
 */
import type { Page } from '@playwright/test';

/**
 * Taze bir kullanıcı KAYIT EDER ve oturum açar.
 *
 * Prod'a hazırlık sonrası seed yalnız bootstrap admin içerir — demo kullanıcı
 * (user@klab.test vb.) YOK. Bu yüzden testler kendi benzersiz kullanıcısını
 * oluşturur: `/register` formu doldurulur, backend kayıt sonrası OTOMATİK login
 * yapar (cookie + token döndürür), EK-1 beyanı onaylanır ve /rooms'a yönlenir.
 * Oluşturulan e-postayı döndürür (aynı hesapla tekrar login gerekirse).
 */
export async function registerAndLogin(page: Page): Promise<string> {
  // Benzersiz e-posta — her test izole bir hesapla çalışır (çakışma/yarış olmaz).
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `e2e.${unique}@klab.test`;
  await page.goto('/register');
  await page.waitForSelector('#email', { timeout: 10_000 });
  // Ad-soyad validator'ı yalnız harf/boşluk/tire kabul eder (rakam YOK) —
  // benzersizlik e-postada sağlanır, isim sabit ve rakamsız kalır.
  await page.locator('#fullName').fill('Test Kullanıcısı');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('E2eTestPass1!');
  await page.locator('#passwordConfirm').fill('E2eTestPass1!');
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/auth/register') && r.status() === 201,
      { timeout: 15_000 }
    ),
    page.locator('button[type="submit"]').click(),
  ]);
  // Yeni hesap EK-1 beyanını henüz onaylamadı — çıkarsa onayla.
  await acceptConsentIfShown(page);
  // Aktif booking'i olan kullanıcı /dashboard'a, yoksa /rooms'a yönlenir.
  await page.waitForURL(/\/(rooms|dashboard)/, { timeout: 15_000 });
  return email;
}

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
