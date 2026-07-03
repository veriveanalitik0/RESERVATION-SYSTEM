-- Waitlist: kullanıcının manuel (periyottan kısa) bitiş tarihi seçebilmesi.
--  - desired_end_date: NULL = start + period ile türetilir (eski davranış korunur).
--    Dolu ise kullanıcının seçtiği bitiş tarihi (start ≤ end ≤ period-türevi).
-- Tx-güvenli (CONCURRENTLY yok). IF NOT EXISTS → yeni kurulumda baseline zaten içerir.

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS desired_end_date TEXT;
