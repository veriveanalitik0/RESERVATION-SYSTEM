-- Performans index'leri.
--
-- 1) license_requests.assigned_engineer_id üzerinde index yoktu: bir admin
--    silindiğinde ON DELETE SET NULL'ı uygulamak için tablo taranıyordu; ayrıca
--    "mühendise atanmış talepler" filtresi index'sizdi. Kısmi index (yalnız atanmış
--    satırlar) küçük ve yeterli.
CREATE INDEX IF NOT EXISTS idx_license_requests_engineer
  ON license_requests (assigned_engineer_id)
  WHERE assigned_engineer_id IS NOT NULL;

-- 2) analytics.service günlük sayımları substr(created_at,1,10) / substr(reviewed_at,1,10)
--    üzerinde filtreleyip gruplandırıyor (non-sargable -> tam tablo taraması). Bu
--    ifadelere (functional/expression) index ekleyince tarih-aralığı sorguları
--    ölçekte düz btree gibi kullanılabilir hale gelir.
CREATE INDEX IF NOT EXISTS idx_bookings_created_day
  ON bookings ((substr(created_at, 1, 10)));

CREATE INDEX IF NOT EXISTS idx_bookings_reviewed_day
  ON bookings ((substr(reviewed_at, 1, 10)))
  WHERE reviewed_at IS NOT NULL;
