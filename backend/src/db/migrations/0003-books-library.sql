-- Kütüphane modülü: kitap envanteri + ödünç (loan) kayıtları.
-- Tx-güvenli (CONCURRENTLY yok); migration runner tek tx + advisory kilit altında uygular.
-- IF NOT EXISTS: yeni kurulumda baseline schema.pg.sql zaten oluşturur, burada no-op olur.

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
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'overdue')),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_books_active ON books (is_active, title);
CREATE INDEX IF NOT EXISTS idx_book_loans_user ON book_loans (user_id, status);
CREATE INDEX IF NOT EXISTS idx_book_loans_book ON book_loans (book_id);
CREATE INDEX IF NOT EXISTS idx_book_loans_active ON book_loans (status, due_at);
