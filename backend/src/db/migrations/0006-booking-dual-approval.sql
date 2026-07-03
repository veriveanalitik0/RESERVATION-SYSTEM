-- Çift onay: randevu talebi HEM admin HEM analitik (danışman) tarafından onaylanmalı.
--  - admin_decision / analyst_decision: her rolün kararı.
--    NULL = bekliyor, 'approved' = onayladı, 'rejected' = reddetti.
--  - İkisi de 'approved' → booking 'approved'. Biri 'rejected' → veto ('rejected').
--  - Paralel: herhangi sıra. request_feedback ikisini de NULL'a sıfırlar.
-- Eski kayıtlar: NULL kararlarla başlar (pending'ler iki onay bekler; approved'lar aynen kalır).
-- Tx-güvenli (CONCURRENTLY yok). IF NOT EXISTS → yeni kurulumda baseline zaten içerir.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS admin_decision TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS analyst_decision TEXT;
