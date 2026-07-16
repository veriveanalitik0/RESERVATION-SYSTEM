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
  /**
   * Görsel üretim stüdyosu (VisualStudio). Varsayılan AÇIK; 'false' verilirse
   * profildeki stüdyo gizlenir. Backend karşılığı FEATURE_VISUALS — kapalıyken
   * /user/visuals uçları 503 döner (dış görsel API bağımlılığı yok).
   * Prod build'de kapatmak için: VITE_FEATURE_VISUALS=false.
   */
  visualStudio: import.meta.env.VITE_FEATURE_VISUALS !== 'false',
} as const;
