/**
 * Feature flag'leri — build-time env ile açılıp kapanır (Vite).
 *
 * Kullanım: frontend/.env(.local) dosyasına `VITE_FEATURE_WEEKDAY_SELECTION=true`
 * yazıp build/dev sunucusunu yeniden başlatın.
 */
export const FEATURES = {
  /**
   * Rezervasyonda haftanın tek tek günlerini seçme (ara gün seçimi).
   * Varsayılan KAPALI: yalnız toplu tarih aralığı seçilir, rezervasyon tüm
   * haftayı kapsar. Açılınca BookingModal/WaitlistModal'da gün seçici görünür.
   */
  weekdaySelection: import.meta.env.VITE_FEATURE_WEEKDAY_SELECTION === 'true',
} as const;
