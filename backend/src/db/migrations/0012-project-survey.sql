-- ============================================================
-- PROJE SONU ANKETİ (serbest metin)
-- ============================================================
-- Kullanıcının laboratuvarda yürüttüğü projeyi ve deneyimini kendi
-- cümleleriyle anlattığı 3 soruluk açık uçlu anket. Amaç nitel geri bildirim
-- toplamak — kullanıcı başına TEK kayıt DEĞİL, her gösterimde bir kayıt
-- (aynı kişi zamanla birden fazla proje yürütebilir).
--
-- ŞİMDİLİK çıkış akışında (exit_surveys ile birlikte) gösteriliyor; İLERİDE
-- "proje tamamlanma" akışı geldiğinde oraya taşınacak — tablo tasarımı bu
-- yüzden çıkışa değil projeye/anlatıya odaklı tutuldu.
--
-- Tüm alanlar opsiyoneldir; NULL = kullanıcı o soruyu boş bıraktı (anket
-- zorunlu değil, "Atla" ile kapatılabilir → o durumda hiç satır yazılmaz).
--
-- Zaman damgası: ADR-001 gereği TEXT 'YYYY-MM-DD HH:MM:SS' (yerel/Istanbul),
-- tek yazıcı utils/dates.ts → sqlDateTimeLocal().
CREATE TABLE IF NOT EXISTS project_surveys (
  id                TEXT PRIMARY KEY,
  -- Anketi dolduran hesap. Admin/governance hesapları da doldurabilir; hangi
  -- tabloya ait olduğu subject_type ile ayrılır (FK YOK — admins/users ayrı
  -- tablolar ve kayıt silinse de geri bildirim istatistiği korunmalı).
  subject_id        TEXT NOT NULL,
  subject_type      TEXT NOT NULL CHECK (subject_type IN ('user', 'admin')),
  -- 1) Projede neler yapıldı, süreç ve sonuçlar
  project_work      TEXT,
  -- 2) Laboratuvar memnuniyeti / destek yeterliliği
  lab_feedback      TEXT,
  -- 3) Laboratuvarı ve süreçleri iyileştirme önerileri
  improvement       TEXT,
  created_at        TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Admin özet sorgusu tarih aralığına göre filtreler.
CREATE INDEX IF NOT EXISTS idx_project_surveys_created ON project_surveys (substr(created_at, 1, 10));
CREATE INDEX IF NOT EXISTS idx_project_surveys_subject ON project_surveys (subject_type, subject_id);
