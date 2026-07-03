# Versiyonlu Migration'lar

Şema değişiklikleri artık buraya **numaralı SQL dosyaları** olarak eklenir:

```
src/db/migrations/
  0001-ornek-degisiklik.sql
  0002-yeni-kolon.sql
```

## Kurallar

- Dosya adı `NNNN-aciklama.sql` formatında; runner ada göre sıralar ve
  `schema_migrations` tablosuna işlenmemiş olanları **tek bir transaction içinde,
  `pg_advisory_xact_lock` ile** uygular (çok-instance boot yarışına karşı; biri
  migrate ederken diğeri bekler, sonra zaten uygulananları atlar). Batch bölünmezdir:
  bir migration başarısız olursa tüm batch geri alınır, boot durur.
- Migration'lar **transaction-güvenli** olmalı: `CREATE INDEX CONCURRENTLY`, `VACUUM`
  gibi tx-dışı komutlar KULLANILAMAZ (gerekiyorsa ayrı/manuel uygulanmalı).
- Bir kez uygulanan dosya DEĞİŞTİRİLMEZ — düzeltme gerekiyorsa yeni dosya ekleyin.
- `schema.pg.sql` BASELINE'dır: yeni kurulumda tabloları oluşturur ve her boot'ta
  idempotent çalışır. Geçmişte oraya eklenen `ALTER ... IF NOT EXISTS` blokları
  geriye uyum için kalır; YENİ değişiklikler buraya (migrations/) yazılmalı.
- Migration'lar boot sırasında `initSchema()` içinde otomatik koşar; ayrıca
  `npm run db:init` de uygular.

## Örnek

```sql
-- 0001-bookings-priority.sql
ALTER TABLE bookings ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_bookings_priority ON bookings(priority);
```
