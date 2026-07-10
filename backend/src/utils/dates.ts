/**
 * Tarih yardımcıları — saat dilimi politikası.
 *
 * Sistem TR sahası için çalışır; "bugün" ve tarih sınırı hesapları process'in
 * yerel saat dilimine (TZ=Europe/Istanbul — config/env.ts'te garanti edilir)
 * göre yapılmalı. `new Date().toISOString()` HER ZAMAN UTC döndürür ve TR'de
 * 00:00-03:00 arasında bir önceki günü üretir — "bugün" için kullanılmamalı.
 */

/** Yerel saat dilimine göre YYYY-MM-DD. */
export function ymdLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * KANONİK SQL zaman damgası formatı — 'YYYY-MM-DD HH:MM:SS' (yerel saat,
 * TZ=Europe/Istanbul). Şema DEFAULT'ları (`to_char(now(),'YYYY-MM-DD HH24:MI:SS')`)
 * ve async-db'nin CURRENT_TIMESTAMP çevirisi ile AYNI formattır; TEXT kolonlarda
 * leksikografik karşılaştırma ancak bu formatla doğru çalışır.
 *
 * KURAL: TEXT timestamp kolonuna JS'ten değer yazarken/karşılaştırırken
 * `toISOString()` DEĞİL bu fonksiyon kullanılmalı ('T' ayracı + UTC kayması
 * sıralamayı bozar — bkz. maintenance.service cutoff düzeltmesi).
 */
export function sqlDateTimeLocal(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  );
}

/**
 * Rezervasyon bitiş tarihi: başlangıç + N ay - 1 gün.
 * Ay taşmasında hedef ayın son gününe kıskaçlanır (31 Oca + 1 ay = 27 Şub;
 * JS'in taşma davranışıyla Mart'a kaymaz). Saf tarih aritmetiği — UTC çıpalı
 * çalışır, saat diliminden bağımsızdır.
 */
export function addMonthsEndDate(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const startDay = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(startDay, lastDayOfTarget));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD + N gün (saf tarih aritmetiği, UTC çıpalı). */
export function addDaysYmd(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type BookingPeriodKey = '1w' | '2w' | '1m';

/**
 * Süre seçeneğinden bitiş tarihi (dahil): 1 hafta = başlangıç+6 gün,
 * 2 hafta = başlangıç+13 gün, 1 ay = addMonthsEndDate kuralı.
 */
export function periodEndDate(startStr: string, period: BookingPeriodKey): string {
  if (period === '1w') return addDaysYmd(startStr, 6);
  if (period === '2w') return addDaysYmd(startStr, 13);
  return addMonthsEndDate(startStr, 1);
}
