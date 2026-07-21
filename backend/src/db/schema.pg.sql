-- Konsolide PostgreSQL şeması — TAZE KURULUM BASELINE'ı (elle bakımlı).
-- Geçmişte scripts/gen-pg-schema.ts ile SQLite şemasından üretiliyordu (#2); o
-- otomatik-üretim akışı TERK EDİLDİ ve script kaldırıldı.
--
-- ŞEMA POLİTİKASI (tek kaynak kuralı):
--  * Bu dosya yalnız YENİ kurulumda tabloları oluşturur (CREATE ... IF NOT
--    EXISTS; her boot'ta idempotent koşar ama mevcut tabloya kolon EKLEMEZ).
--  * Var olan DB'lere yönelik HER değişiklik SADECE migrations/NNNN-*.sql
--    dosyası olarak eklenir (bkz. migrations/README.md). Bu dosyanın dibinde
--    retro-ALTER bloğu TUTULMAZ — eski blok migrations/0000-baseline-retro-
--    patches.sql'e taşındı.
--  * Yeni kolon eklerken: (1) migrations/NNNN-*.sql yaz, (2) taze kurulum
--    eksiksiz olsun diye buradaki CREATE TABLE tanımını da güncelle. İki yer —
--    üçüncü yer yok.

CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user' CHECK(role = 'user'),
          department TEXT,
          title TEXT,
          manager TEXT,
          phone TEXT,
          bio TEXT,
          project_idea TEXT,
          failed_login_count INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          status INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        , profile_photo TEXT, governance_role TEXT
          CHECK(governance_role IS NULL OR
                governance_role IN ('analitik_danisman','yz_arge','izleyici'))
          , profile_background_url TEXT, chat_background_url TEXT);

CREATE TABLE IF NOT EXISTS admins (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin', 'super_admin')),
          failed_login_count INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          status INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        , totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_backup_codes TEXT, governance_role TEXT
          CHECK(governance_role IS NULL OR
                governance_role IN ('analitik_danisman','lab_muhendisi','yz_arge')));

CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          district TEXT NOT NULL,
          neighborhood TEXT NOT NULL,
          capacity INTEGER NOT NULL DEFAULT 4,
          description TEXT,
          theme TEXT NOT NULL DEFAULT 'agent',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        , equipment TEXT NOT NULL DEFAULT '', room_type TEXT NOT NULL DEFAULT 'pod', specs TEXT);

CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          subject_id TEXT,
          subject_type TEXT,
          ip_address TEXT,
          user_agent TEXT,
          success INTEGER NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS waitlist (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          -- MİRAS: eski ay-bazlı süre (yeni kayıtlar period_key kullanır, burası NULL).
          period_months INTEGER CHECK(period_months IN (1, 2, 3)),
          -- Süre anahtarı: 1 hafta / 2 hafta / 1 ay.
          period_key TEXT CHECK(period_key IN ('1w', '2w', '1m')),
          desired_start_date TEXT NOT NULL,
          -- NULL = start + period ile türetilir; dolu ise kullanıcının manuel (kısa) bitişi.
          desired_end_date TEXT,
          project_name TEXT NOT NULL,
          project_description TEXT NOT NULL,
          help_needed TEXT NOT NULL,
          technologies TEXT NOT NULL,
          weekday_mask INTEGER NOT NULL DEFAULT 127,
          position INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'waiting'
            CHECK(status IN ('waiting', 'promoted', 'expired', 'cancelled')),
          promoted_booking_id TEXT,
          notified_at TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS showcase_likes (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          UNIQUE(booking_id, user_id)
        );

CREATE TABLE IF NOT EXISTS showcase_comments (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          user_full_name TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS license_request_items (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          license_key TEXT NOT NULL,
          license_name TEXT NOT NULL,
          vendor TEXT,
          category TEXT,
          item_order INTEGER NOT NULL DEFAULT 0
        );

CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          recipient_id TEXT NOT NULL,
          recipient_type TEXT NOT NULL
            CHECK(recipient_type IN ('user', 'admin', 'danisman', 'arge', 'izleyici')),
          category TEXT NOT NULL
            CHECK(category IN ('booking', 'license', 'waitlist', 'message', 'system')),
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          link TEXT,
          read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS quality_gates (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          gate_key TEXT NOT NULL
            CHECK(gate_key IN ('build','code_review','architecture','framework','security')),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','passed','failed')),
          score INTEGER,
          threshold INTEGER,
          detail TEXT,
          evaluated_at TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          UNIQUE(request_id, gate_key)
        );

CREATE TABLE IF NOT EXISTS human_approvals (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          approval_type TEXT NOT NULL CHECK(approval_type IN ('stage','production')),
          decision TEXT NOT NULL DEFAULT 'pending'
            CHECK(decision IN ('pending','approved','rejected')),
          approver_id TEXT,
          release_note TEXT,
          risk_assessment TEXT,
          decided_at TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS appointments (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          start_at TEXT NOT NULL,
          end_at TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'scheduled'
            CHECK(status IN ('scheduled','cancelled','completed')),
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          CHECK(start_at < end_at)
        );

-- Kütüphane modülü (#kütüphane): kitap envanteri + ödünç kayıtları.
CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          isbn TEXT,
          category TEXT,
          description TEXT,
          cover_image_url TEXT,
          total_copies INTEGER NOT NULL DEFAULT 1 CHECK (total_copies >= 0),
          available_copies INTEGER NOT NULL DEFAULT 1 CHECK (available_copies >= 0),
          -- Sayaç bütünlüğü (L3): müsait kopya toplamı aşamaz (0000 migration'ı
          -- eski DB'lerde adlandırılmış constraint olarak ekler; taze kurulumda buradan gelir).
          CONSTRAINT books_available_le_total CHECK (available_copies <= total_copies),
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS book_loans (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          borrowed_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          due_at TEXT NOT NULL,
          returned_at TEXT,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'active', 'returned', 'overdue', 'rejected')),
          period_days INTEGER NOT NULL DEFAULT 14,
          extension_requested_days INTEGER,
          extension_requested_at TEXT,
          reviewed_by TEXT,
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          subject_id TEXT NOT NULL,
          subject_type TEXT NOT NULL
            CHECK(subject_type IN ('user', 'admin', 'danisman', 'arge', 'izleyici')),
          expires_at TEXT NOT NULL,
          revoked INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          parent_id TEXT,
          used_at TEXT
        );

CREATE TABLE IF NOT EXISTS "project_stage_events" (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          from_stage TEXT,
          to_stage TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT CHECK(actor_type IS NULL OR
            actor_type IN ('user','admin','danisman','arge','system')),
          note TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS "bookings" (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            room_id TEXT NOT NULL,
            -- MİRAS: eski ay-bazlı süre (yeni kayıtlar period_key kullanır, burası NULL).
            period_months INTEGER CHECK(period_months IN (1, 2, 3)),
            -- Süre anahtarı: 1 hafta / 2 hafta / 1 ay.
            period_key TEXT CHECK(period_key IN ('1w', '2w', '1m')),
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            project_name TEXT NOT NULL,
            project_description TEXT NOT NULL,
            help_needed TEXT NOT NULL,
            technologies TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending', 'approved', 'rejected', 'feedback_requested', 'cancelled')),
            admin_feedback TEXT,
            reviewed_by TEXT,
            reviewed_at TEXT,
            -- Çift onay: her rolün kararı (NULL=bekliyor, 'approved'/'rejected').
            admin_decision TEXT,
            analyst_decision TEXT,
            created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
            updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
            showcase_visible INTEGER NOT NULL DEFAULT 1,
            showcase_highlight INTEGER NOT NULL DEFAULT 0,
            lifecycle_stage TEXT NOT NULL DEFAULT 'application'
              CHECK(lifecycle_stage IN ('application','development','stage','production','live')),
            stage_entered_at TEXT NOT NULL DEFAULT '',
            review_track TEXT NOT NULL DEFAULT 'standard'
              CHECK(review_track IN ('standard','swat')),
            stage_advance_requested_at TEXT,
            stage_advance_note TEXT, weekday_mask INTEGER NOT NULL DEFAULT 127, showcase_image_url TEXT,
            progress_note TEXT,
            progress_updated_at TEXT
          );

CREATE TABLE IF NOT EXISTS "license_requests" (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            license_key TEXT NOT NULL,
            license_name TEXT NOT NULL,
            vendor TEXT,
            category TEXT,
            reason TEXT NOT NULL,
            duration_months INTEGER NOT NULL CHECK(duration_months IN (1, 3, 6, 12)),
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending', 'approved', 'rejected', 'feedback_requested')),
            admin_feedback TEXT,
            reviewed_by TEXT,
            reviewed_at TEXT,
            created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
            updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
            request_title TEXT,
            expected_benefit TEXT,
            success_criteria TEXT,
            project_type TEXT
              CHECK(project_type IS NULL OR project_type IN ('poc', 'integration')),
            estimated_duration_days INTEGER
              CHECK(estimated_duration_days IS NULL OR (estimated_duration_days BETWEEN 1 AND 365)),
            data_to_use TEXT,
            technical_stack TEXT,
            lifecycle_stage TEXT NOT NULL DEFAULT 'application'
              CHECK(lifecycle_stage IN ('application','development','stage','production','live')),
            review_track TEXT NOT NULL DEFAULT 'standard'
              CHECK(review_track IN ('standard','swat')),
            governance_level TEXT NOT NULL DEFAULT 'basic'
              CHECK(governance_level IN ('basic','full')),
            uses_external_api INTEGER,
            involves_real_data INTEGER,
            stage_entered_at TEXT,
            assigned_engineer_id TEXT REFERENCES admins(id) ON DELETE SET NULL
          );

CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          sender_kind TEXT NOT NULL CHECK(sender_kind IN ('user','admin')),
          recipient_id TEXT NOT NULL,
          recipient_kind TEXT NOT NULL CHECK(recipient_kind IN ('user','admin')),
          body TEXT NOT NULL,
          read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS hardware_requests (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          equipment_type TEXT NOT NULL
            CHECK(equipment_type IN ('mouse','keyboard','camera','monitor','headset','other')),
          equipment_detail TEXT,
          quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 20),
          reason TEXT NOT NULL,
          urgency TEXT NOT NULL DEFAULT 'normal'
            CHECK(urgency IN ('low','normal','high')),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','approved','rejected','feedback_requested')),
          admin_feedback TEXT,
          reviewed_by TEXT,
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS support_requests (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          description TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK(status IN ('open','resolved')),
          resolved_by TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

CREATE TABLE IF NOT EXISTS visuals (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          room_id TEXT,
          fikir TEXT NOT NULL,
          tema TEXT,
          prompt_en TEXT,
          image_url TEXT,
          seed INTEGER,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','enhancing','generating','ready','error')),
          error_message TEXT,
          variant_index INTEGER NOT NULL DEFAULT 0,
          variants TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
          updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        );

DO $$ BEGIN
  ALTER TABLE waitlist ADD CONSTRAINT fk_waitlist_1 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE waitlist ADD CONSTRAINT fk_waitlist_2 FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE waitlist ADD CONSTRAINT fk_waitlist_3 FOREIGN KEY (promoted_booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE showcase_likes ADD CONSTRAINT fk_showcase_likes_5 FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE showcase_likes ADD CONSTRAINT fk_showcase_likes_6 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE showcase_comments ADD CONSTRAINT fk_showcase_comments_7 FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE showcase_comments ADD CONSTRAINT fk_showcase_comments_8 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE license_request_items ADD CONSTRAINT fk_license_request_items_9 FOREIGN KEY (request_id) REFERENCES license_requests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE password_reset_tokens ADD CONSTRAINT fk_password_reset_tokens_10 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE quality_gates ADD CONSTRAINT fk_quality_gates_11 FOREIGN KEY (request_id) REFERENCES license_requests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE human_approvals ADD CONSTRAINT fk_human_approvals_12 FOREIGN KEY (request_id) REFERENCES license_requests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE human_approvals ADD CONSTRAINT fk_human_approvals_13 FOREIGN KEY (approver_id) REFERENCES admins(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT fk_appointments_14 FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT fk_appointments_15 FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT fk_appointments_16 FOREIGN KEY (room_id)    REFERENCES rooms(id)    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT fk_bookings_17 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT fk_bookings_18 FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE license_requests ADD CONSTRAINT fk_license_requests_19 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Çıkış anketi — oturum bazında deneyim memnuniyeti (bkz. migration 0011).
-- subject_id'ye FK YOK: admins/users ayrı tablolar ve hesap silinse de geri
-- bildirim istatistiği korunmalı.
CREATE TABLE IF NOT EXISTS exit_surveys (
          id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL,
          subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'admin')),
          overall INTEGER CHECK (overall IS NULL OR overall BETWEEN 1 AND 5),
          workspace INTEGER CHECK (workspace IS NULL OR workspace BETWEEN 1 AND 5),
          booking_ease INTEGER CHECK (booking_ease IS NULL OR booking_ease BETWEEN 1 AND 5),
          support INTEGER CHECK (support IS NULL OR support BETWEEN 1 AND 5),
          recommend INTEGER CHECK (recommend IS NULL OR recommend BETWEEN 1 AND 5),
          comment TEXT,
          created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

DO $$ BEGIN
  ALTER TABLE hardware_requests ADD CONSTRAINT fk_hardware_requests_20 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE support_requests ADD CONSTRAINT fk_support_requests_21 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE visuals ADD CONSTRAINT fk_visuals_22 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE visuals ADD CONSTRAINT fk_visuals_23 FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_exit_surveys_created ON exit_surveys(substr(created_at, 1, 10));
CREATE INDEX IF NOT EXISTS idx_exit_surveys_subject ON exit_surveys(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE status != 3;
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email) WHERE status != 3;
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_logs(subject_id, subject_type);
CREATE INDEX IF NOT EXISTS idx_waitlist_room ON waitlist(room_id, status, position);
CREATE INDEX IF NOT EXISTS idx_waitlist_user ON waitlist(user_id, status);
CREATE INDEX IF NOT EXISTS idx_showcase_likes_booking ON showcase_likes(booking_id);
CREATE INDEX IF NOT EXISTS idx_showcase_comments_booking ON showcase_comments(booking_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_request_items_request
          ON license_request_items(request_id, item_order);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
          ON notifications(recipient_id, recipient_type, read, created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_hash
          ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_user
          ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_quality_gates_request
          ON quality_gates(request_id);
CREATE INDEX IF NOT EXISTS idx_human_approvals_request
          ON human_approvals(request_id);
CREATE INDEX IF NOT EXISTS idx_appointments_user
          ON appointments(user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_room
          ON appointments(room_id, start_at, end_at);
-- Appointment ısı-haritası + oda/admin takvimi: status + tarih aralığı taraması
-- (oda filtresiz). getRoomAppointmentHeatmap / listAllAppointments için.
CREATE INDEX IF NOT EXISTS idx_appointments_schedule
          ON appointments(status, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_appointments_booking
          ON appointments(booking_id, status);
CREATE INDEX IF NOT EXISTS idx_users_governance_role
          ON users(governance_role) WHERE governance_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_subject
          ON refresh_tokens(subject_id, subject_type);
CREATE INDEX IF NOT EXISTS idx_refresh_hash
          ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_parent
          ON refresh_tokens(parent_id);
CREATE INDEX IF NOT EXISTS idx_stage_events_request
          ON project_stage_events(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(room_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_showcase ON bookings(status, showcase_visible)
            WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_bookings_lifecycle ON bookings(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_bookings_review_track ON bookings(review_track)
            WHERE review_track = 'swat';
CREATE INDEX IF NOT EXISTS idx_bookings_advance_pending ON bookings(stage_advance_requested_at)
            WHERE stage_advance_requested_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_license_requests_user ON license_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_license_requests_status ON license_requests(status);
CREATE INDEX IF NOT EXISTS idx_license_requests_lifecycle ON license_requests(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_license_requests_track ON license_requests(review_track);
CREATE INDEX IF NOT EXISTS idx_chat_pair
          ON chat_messages(sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_recipient_unread
          ON chat_messages(recipient_id, read);
CREATE INDEX IF NOT EXISTS idx_hardware_requests_user
          ON hardware_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_hardware_requests_status
          ON hardware_requests(status);
CREATE INDEX IF NOT EXISTS idx_support_requests_status
          ON support_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_support_requests_user
          ON support_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_visuals_user ON visuals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visuals_room ON visuals(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_active ON books(is_active, title);
CREATE INDEX IF NOT EXISTS idx_book_loans_user ON book_loans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_book_loans_book ON book_loans(book_id);
CREATE INDEX IF NOT EXISTS idx_book_loans_active ON book_loans(status, due_at);
-- NOT: idx_book_loans_pending / idx_book_loans_extension index'leri migration
-- 0004'te (ilgili kolon eklendikten SONRA) oluşturulur. Baseline'a KOYULMAZ; aksi
-- halde mevcut DB'lerde kolon henüz yokken bu index baseline'da patlar (0004 öncesi).

-- NOT: Eski "ARTIMLI MİGRASYONLAR" retro-ALTER bloğu migrations/0000-baseline-
-- retro-patches.sql'e taşındı (şema tekilleştirme). Yeni değişiklikler için
-- baseline'a retro-ALTER EKLEMEYİN — dosya başındaki şema politikasına bakın.
