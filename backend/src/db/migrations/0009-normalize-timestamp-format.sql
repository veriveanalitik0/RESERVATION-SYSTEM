-- ============================================================
-- ZAMAN DAMGASI FORMAT NORMALİZASYONU (ADR-001)
-- ============================================================
-- Sorun: TEXT timestamp kolonlarında iki uyumsuz format birikmişti:
--   * 'YYYY-MM-DD HH:MM:SS' (yerel)  — şema DEFAULT'ları + CURRENT_TIMESTAMP çevirisi
--   * 'YYYY-MM-DDTHH:MM:SS.sssZ' (ISO/UTC) — JS toISOString() yazan servisler
-- Leksik karşılaştırmada ' ' < 'T' olduğundan aynı-gün sınırlarında yanlış
-- sonuç üretiyordu (retention erken silme, randevu tamamlama gecikmesi vb.).
--
-- Çözüm: tüm yazarlar artık sqlDateTimeLocal() kullanıyor (utils/dates.ts);
-- bu migration mevcut ISO satırları kanonik yerel formata çevirir.
--
-- Yöntem: şemadaki TÜM '*_at' + locked_until TEXT kolonları generic taranır —
-- elle kolon listesi tutulmaz (atlama riski yok). Yalnız 'T' içeren değerler
-- dönüştürülür; boş string / date-only / zaten-kanonik satırlar dokunulmaz.
-- toISOString çıktısı daima 'Z' (UTC) taşıdığından ::timestamptz dönüşümü DB
-- timezone ayarından bağımsız kesindir; hedef dilim açıkça Europe/Istanbul.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = current_schema()
      AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'text'
      AND (c.column_name LIKE '%\_at' ESCAPE '\' OR c.column_name = 'locked_until')
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = to_char((%I::timestamptz) AT TIME ZONE ''Europe/Istanbul'', ''YYYY-MM-DD HH24:MI:SS'') WHERE %I LIKE ''%%T%%''',
      r.table_name, r.column_name, r.column_name, r.column_name
    );
  END LOOP;
END $$;
