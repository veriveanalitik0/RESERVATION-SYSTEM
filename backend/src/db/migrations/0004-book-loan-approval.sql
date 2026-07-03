-- Ödünç onay akışı + süre uzatma:
--  - Yeni statüler: 'pending' (admin onayı bekliyor) ve 'rejected' (reddedildi).
--  - period_days: talep edilen ödünç süresi (onayda due_at hesabı için).
--  - extension_requested_*: kullanıcının bekleyen süre-uzatma talebi.
--  - reviewed_by/at: onay/red kararını veren admin.
-- Tx-güvenli (CONCURRENTLY yok). IF NOT EXISTS → yeni kurulumda baseline zaten içerir.

ALTER TABLE book_loans ADD COLUMN IF NOT EXISTS period_days INTEGER NOT NULL DEFAULT 14;
ALTER TABLE book_loans ADD COLUMN IF NOT EXISTS extension_requested_days INTEGER;
ALTER TABLE book_loans ADD COLUMN IF NOT EXISTS extension_requested_at TEXT;
ALTER TABLE book_loans ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE book_loans ADD COLUMN IF NOT EXISTS reviewed_at TEXT;

DO $$ BEGIN
  ALTER TABLE book_loans DROP CONSTRAINT IF EXISTS book_loans_status_check;
  ALTER TABLE book_loans ADD CONSTRAINT book_loans_status_check
    CHECK (status IN ('pending', 'active', 'returned', 'overdue', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_book_loans_pending ON book_loans (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_book_loans_extension ON book_loans (extension_requested_at)
  WHERE extension_requested_at IS NOT NULL;
