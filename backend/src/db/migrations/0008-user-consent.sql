-- EK-1 "Okudum, Kabul Ettim" beyanı — kullanıcı bazında bir kereye mahsus onay.
-- consent_accepted_at NULL ise kullanıcı beyanı henüz onaylamamıştır; login/register
-- akışında onay kartı gösterilir. Versiyon, beyan metni güncellenirse yeniden
-- onay istenebilmesi için saklanır.
ALTER TABLE users ADD COLUMN consent_accepted_at TEXT;
ALTER TABLE users ADD COLUMN consent_version TEXT;
