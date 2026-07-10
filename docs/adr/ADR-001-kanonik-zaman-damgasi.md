# ADR-001 — TEXT Zaman Damgalarında Kanonik Format

**Durum:** Kabul edildi (2026-07-10) · **Kapsam:** backend/db + tüm servisler

## Bağlam

Şema, SQLite mirasından gelen **TEXT** zaman damgası kolonları kullanır
(`timestamptz` yerine). İki uyumsuz serileştirme birikmişti:

| Kaynak | Format | Örnek |
|---|---|---|
| Şema DEFAULT + `CURRENT_TIMESTAMP` çevirisi (async-db) | boşluk ayraçlı, yerel | `2026-07-10 09:15:00` |
| JS `toISOString()` yazan servisler (~15 site) | `T` ayraçlı, UTC | `2026-07-10T06:15:00.000Z` |

TEXT kolonlarda karşılaştırma **leksikografiktir**; `' ' < 'T'` olduğundan aynı
takvim günündeki karışık-format satırlar yanlış sıralanıyordu. Somut etkiler:
audit/token retention'da sınır-günü erken silme (maintenance.service),
aynı gün biten randevuların cron'da bir gün geç tamamlanması
(appointment.service), gecikmiş ödünç işaretlemede gün kayması riski.

## Karar

1. **Kanonik format:** `YYYY-MM-DD HH:MM:SS`, **yerel saat** (TZ=Europe/Istanbul,
   container/process düzeyinde garanti). Tek yazım noktası:
   `utils/dates.ts → sqlDateTimeLocal()`.
2. **Kural:** DB'deki TEXT zaman kolonuna JS'ten yazan/karşılaştıran her kod
   `sqlDateTimeLocal()` kullanır; `toISOString()` yalnız **DB'ye gitmeyen**
   yanıt alanlarında (örn. `generatedAt`) serbesttir.
3. **Veri normalizasyonu:** `migrations/0009-normalize-timestamp-format.sql`
   tüm `*_at` + `locked_until` TEXT kolonlarındaki ISO satırları tek seferde
   kanonik formata çevirir (şema-generic tarama; elle kolon listesi yok).
4. **Şema tek-kaynak politikası:** `schema.pg.sql` yalnız taze kurulum
   baseline'ı; retro-ALTER bloğu `migrations/0000-baseline-retro-patches.sql`'e
   taşındı. Yeni değişiklik = yeni migration + baseline CREATE güncellemesi.

## Neden `timestamptz`'e geçmedik (şimdilik)

Tam tip geçişi doğru uzun-vade hedefidir, ancak: node-pg `timestamptz`'i JS
`Date` olarak döndürür → tüm API yanıtlarında tarih alanlarının serileştirme
şekli değişir; frontend'de string varsayan (`slice`, leksik kıyas, `>=` string
karşılaştırma) onlarca nokta ve 37 sayfa etkilenir. Bu ADR'nin tek-format +
tek-yazıcı adımı, geçişi ileride **mekanik** hale getirir: tüm yazımlar
`sqlDateTimeLocal()` üzerinden aktığı için kolon tipleri değiştirilirken tek
fonksiyon + DTO serileştirme katmanı güncellenir.

## Sonuçlar

- Leksik karşılaştırmalar artık her satır çifti için doğrudur.
- Yeni kod için kural basit ve grep'lenebilir: DB'ye giden `toISOString()`
  çağrısı kod incelemesinde reddedilir.
- Yerel-saat semantiği bilinçlidir (TR sahası); çok-bölgeli dağıtım gündeme
  gelirse `timestamptz` geçişi öne çekilmelidir.
