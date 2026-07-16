-- ============================================================
-- EMBEDDING/BENZERLİK ÖZELLİĞİNİN KALDIRILMASI
-- ============================================================
-- Semantic search / duplicate-tespiti / iş birliği önerisi özellikleri
-- projeden çıkarıldı (@xenova/transformers bağımlılığı ile birlikte).
-- project_embeddings tablosu artık hiçbir kod yolundan okunmuyor/yazılmıyor
-- → veriyle birlikte kaldırılır. Baseline'dan (schema.pg.sql) da silindi;
-- yeni kurulumlarda tablo hiç oluşmaz.
DROP TABLE IF EXISTS project_embeddings;
