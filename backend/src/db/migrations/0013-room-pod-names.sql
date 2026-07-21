-- ============================================================
-- POD ADLARI: Kroki main.html CALISMA_INFO ile eşitleme
-- ============================================================
-- Kaynak-of-truth NETLEŞTİ (2026-07-21, kullanıcı onayı): pod görünen adları
-- Kroki projesindeki main.html CALISMA_INFO etiketleridir. Önceki isim seti
-- (CUDA/Tensor/Triton/JAX/Python/... sıralaması) Kroki reposundaki
-- room_names.txt'ten alınmıştı; o dosya ESKİ kalmış. İki kaynak pod
-- numaralarına farklı adlar dağıttığı için 11 pod yeniden adlanıyor
-- (6-9 ve 11-13 no'lu podlar ile toplantı odası adları zaten doğruydu).
--
-- seed.ts idempotenttir (INSERT ... ON CONFLICT DO NOTHING benzeri) ve var
-- olan satırı GÜNCELLEMEZ; bu yüzden çalışan ortamlar için UPDATE burada.
-- `code` sabit kimliktir, DEĞİŞMEZ — rezervasyon/randevu ilişkileri korunur.
UPDATE rooms SET name = 'Claude' WHERE code = 'AILAB -1D 1-NVD';
UPDATE rooms SET name = 'Gemini' WHERE code = 'AILAB -1D 2-NVD';
UPDATE rooms SET name = 'GPT'    WHERE code = 'AILAB -1D 3-NVD';
UPDATE rooms SET name = 'CUDA'   WHERE code = 'AILAB -1D 4-2xNVD';
UPDATE rooms SET name = 'Tensor' WHERE code = 'AILAB -1D 5-2xMAC';
UPDATE rooms SET name = 'NumPy'  WHERE code = 'AILAB -1D 10-MAC';
UPDATE rooms SET name = 'Matrix' WHERE code = 'AILAB -1D 14-MAC';
UPDATE rooms SET name = 'CNN'    WHERE code = 'AILAB -1D 15-MAC';
UPDATE rooms SET name = 'RNN'    WHERE code = 'AILAB -1D 16-MAC';
UPDATE rooms SET name = 'YOLO'   WHERE code = 'AILAB -1D 17-MAC';
UPDATE rooms SET name = 'Kaggle' WHERE code = 'AILAB -1D 18-MAC';
