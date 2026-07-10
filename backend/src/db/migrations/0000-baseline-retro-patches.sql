-- ============================================================
-- BASELINE RETRO-PATCH'LERİ (schema.pg.sql'in eski "ARTIMLI MİGRASYONLAR"
-- bloğundan BİREBİR taşındı — şema tekilleştirme).
-- ============================================================
-- Neden 0000: migration'lar isim sırasıyla koşar; 0002-perf-indexes gibi
-- dosyalar buradaki kolonlara (örn. license_requests.assigned_engineer_id)
-- bağımlıdır. 0000 adı, çok eski bir yedekten geri dönülse bile bu patch'lerin
-- diğer tüm migration'lardan ÖNCE uygulanmasını garanti eder.
--
-- Taze kurulumda tüm kolonlar CREATE TABLE içinde zaten var → bu dosya no-op
-- (IF NOT EXISTS / duplicate_object yakalama). Migration'ları hiç uygulamamış
-- eski bir DB'de eksik kolon/constraint'leri tamamlar.
--
-- YENİ ŞEMA POLİTİKASI: schema.pg.sql yalnız TAZE kurulum baseline'ıdır;
-- bundan sonraki HER değişiklik SADECE yeni bir migrations/NNNN-*.sql dosyası
-- olarak eklenir (baseline'a retro-ALTER eklenmez).

ALTER TABLE users  ADD COLUMN IF NOT EXISTS profile_photo TEXT;
ALTER TABLE users  ADD COLUMN IF NOT EXISTS governance_role TEXT;
ALTER TABLE users  ADD COLUMN IF NOT EXISTS profile_background_url TEXT;
ALTER TABLE users  ADD COLUMN IF NOT EXISTS chat_background_url TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS governance_role TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS showcase_image_url TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS weekday_mask INTEGER NOT NULL DEFAULT 127;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS progress_note TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS progress_updated_at TEXT;

-- İzleyici (salt-okunur görüntüleyici) rolü: mevcut DB'lerde CHECK'leri genişlet.
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_governance_role_check;
  ALTER TABLE users ADD CONSTRAINT users_governance_role_check
    CHECK (governance_role IS NULL OR governance_role IN ('analitik_danisman','yz_arge','izleyici'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_subject_type_check;
  ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_subject_type_check
    CHECK (subject_type IN ('user', 'admin', 'danisman', 'arge', 'izleyici'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Onaylı rezervasyonların iptal akışı: 'cancelled' status'u (mevcut DB'lerde CHECK genişletmesi).
DO $$ BEGIN
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'feedback_requested', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Yönetişim bildirim merkezi (M3): recipient_type'ı danışman/arge/izleyici'ye genişlet.
-- Push'lar bu tiplerle yazılabilsin; aksi halde governance bildirim okuma DAİMA 0 satır
-- döner (CHECK INSERT'i sessizce reddeder → danışman/arge bildirim almaz).
DO $$ BEGIN
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_recipient_type_check;
  ALTER TABLE notifications ADD CONSTRAINT notifications_recipient_type_check
    CHECK (recipient_type IN ('user', 'admin', 'danisman', 'arge', 'izleyici'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Kütüphane sayaç bütünlüğü (L3): müsait kopya toplam kopyayı aşamaz. Önce olası
-- ihlalleri kıskaçla (defensive), sonra CHECK ekle (idempotent).
UPDATE books SET available_copies = total_copies WHERE available_copies > total_copies;
DO $$ BEGIN
  ALTER TABLE books ADD CONSTRAINT books_available_le_total CHECK (available_copies <= total_copies);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- license_requests genişletilmiş kolonları (M14): kolonlar eklenmeden ÖNCE kurulmuş
-- eski DB'lerde de eklensin — 0002'nin assigned_engineer_id index'i bu kolonlara bağımlı.
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS request_title TEXT;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS expected_benefit TEXT;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS success_criteria TEXT;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS project_type TEXT;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS estimated_duration_days INTEGER;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS data_to_use TEXT;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS technical_stack TEXT;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'application';
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS review_track TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS governance_level TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS uses_external_api INTEGER;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS involves_real_data INTEGER;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS stage_entered_at TEXT;
ALTER TABLE license_requests ADD COLUMN IF NOT EXISTS assigned_engineer_id TEXT REFERENCES admins(id) ON DELETE SET NULL;
