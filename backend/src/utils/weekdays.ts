/**
 * Haftanın günleri ↔ 7-bit maske dönüşümleri.
 *
 * Periyodik rezervasyonlarda haftanın seçili günleri `weekday_mask` kolonunda
 * tutulur (bit 0 = Pazartesi ... bit 6 = Pazar). Çakışma kontrolü
 * `(weekday_mask & ?) != 0` ile yapılır — booking VE waitlist akışları aynı
 * semantiği paylaşmalı (waitlist'in maskeyi yok sayması aşırı rezervasyon
 * üretiyordu).
 */
export const FULL_WEEK_MASK = 127; // Pzt..Paz tüm günler

/** ISO gün dizisini (1=Pzt..7=Paz) 7-bit maskeye çevirir. Boş/undefined → tüm hafta. */
export function weekdaysToMask(weekdays?: number[]): number {
  if (!weekdays || weekdays.length === 0) return FULL_WEEK_MASK;
  let mask = 0;
  for (const d of weekdays) {
    if (d >= 1 && d <= 7) mask |= 1 << (d - 1);
  }
  return mask === 0 ? FULL_WEEK_MASK : mask;
}

/** Maskeyi ISO gün dizisine (1=Pzt..7=Paz) çevirir. */
export function maskToWeekdays(mask: number): number[] {
  const days: number[] = [];
  for (let d = 1; d <= 7; d++) {
    if (mask & (1 << (d - 1))) days.push(d);
  }
  return days;
}
