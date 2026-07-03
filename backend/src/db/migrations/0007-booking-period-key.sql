-- Süre modeli değişikliği: ay-bazlı periodMonths (1/2/3) yerine
-- süre anahtarı period_key ('1w' = 1 hafta, '2w' = 2 hafta, '1m' = 1 ay).
--  - Yeni kayıtlar period_key yazar; period_months NULL bırakılır (miras kolonu).
--  - Eski kayıtlarda period_key NULL kalır — DTO periodMonths ile gösterim yapar.
--  - period_months NOT NULL kaldırılır (yeni satırlar yazmayacak); mevcut
--    CHECK(period_months IN (1,2,3)) NULL'a zaten izin verir, dokunulmaz.
-- Tx-güvenli (CONCURRENTLY yok). IF NOT EXISTS → yeni kurulumda baseline zaten içerir.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS period_key TEXT
  CHECK (period_key IN ('1w', '2w', '1m'));
ALTER TABLE bookings ALTER COLUMN period_months DROP NOT NULL;

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS period_key TEXT
  CHECK (period_key IN ('1w', '2w', '1m'));
ALTER TABLE waitlist ALTER COLUMN period_months DROP NOT NULL;
