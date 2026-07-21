-- ============================================================
-- ÇIKIŞ ANKETİ (deneyim memnuniyeti)
-- ============================================================
-- Kullanıcı "Çıkış" dediğinde gösterilen 5 soruluk kısa anket. Amaç oturum
-- bazında deneyim ölçümü — kullanıcı başına TEK kayıt değil, her çıkışta bir
-- kayıt (zaman içinde trend görülebilsin).
--
-- Puanlar 1..5; NULL = kullanıcı o soruyu boş bıraktı (anket zorunlu değil,
-- "Atla" ile kapatılabilir → o durumda hiç satır yazılmaz).
--
-- Zaman damgası: ADR-001 gereği TEXT 'YYYY-MM-DD HH:MM:SS' (yerel/Istanbul),
-- tek yazıcı utils/dates.ts → sqlDateTimeLocal().
CREATE TABLE IF NOT EXISTS exit_surveys (
  id                TEXT PRIMARY KEY,
  -- Anketi dolduran hesap. Admin/governance hesapları da doldurabilir; hangi
  -- tabloya ait olduğu subject_type ile ayrılır (FK YOK — admins/users ayrı
  -- tablolar ve kayıt silinse de geri bildirim istatistiği korunmalı).
  subject_id        TEXT NOT NULL,
  subject_type      TEXT NOT NULL CHECK (subject_type IN ('user', 'admin')),
  -- 1) Genel memnuniyet
  overall           INTEGER CHECK (overall IS NULL OR overall BETWEEN 1 AND 5),
  -- 2) Çalışma alanı/donanım ihtiyacı karşıladı mı
  workspace         INTEGER CHECK (workspace IS NULL OR workspace BETWEEN 1 AND 5),
  -- 3) Rezervasyon sürecinin kolaylığı
  booking_ease      INTEGER CHECK (booking_ease IS NULL OR booking_ease BETWEEN 1 AND 5),
  -- 4) Destek/iletişim memnuniyeti
  support           INTEGER CHECK (support IS NULL OR support BETWEEN 1 AND 5),
  -- 5) Tavsiye eder mi (NPS benzeri)
  recommend         INTEGER CHECK (recommend IS NULL OR recommend BETWEEN 1 AND 5),
  -- Serbest metin yorum (opsiyonel)
  comment           TEXT,
  created_at        TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Admin özet sorgusu tarih aralığına göre filtreler.
CREATE INDEX IF NOT EXISTS idx_exit_surveys_created ON exit_surveys (substr(created_at, 1, 10));
CREATE INDEX IF NOT EXISTS idx_exit_surveys_subject ON exit_surveys (subject_type, subject_id);
