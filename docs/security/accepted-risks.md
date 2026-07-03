# Kabul Edilen Güvenlik Riskleri (Accepted Risks)

Bu dosya, bilinçli olarak ertelenen / kabul edilen güvenlik bulgularını ve
gerekçelerini kayıt altına alır. Her madde; etki, gerekçe, telafi edici kontrol
ve yeniden değerlendirme tetikleyicisi ile birlikte tutulur.

---

## AR-001 — Vite 5.4.x dev-only path-traversal (GHSA)

- **Tarih:** 2026-06-15
- **Bileşen:** `frontend` → `vite` (kurulu sürüm 5.4.21, manifest `^5.4.11`)
- **Sınıflandırma:** devDependency, yalnızca geliştirme sunucusu (`vite dev`)
  yüzeyini etkileyen path-traversal sınıfı bir uyarı.
- **Durum:** KABUL EDİLDİ / ERTELENDİ

### Etki

Açık, yalnızca çalışan **Vite dev sunucusunda** (`npm run dev`, varsayılan
port 5173) sömürülebilir. Production'da Vite **çalışmaz**: prod imajı
(`frontend/Dockerfile.prod`) `vite build` ile statik dosya üretir ve bunları
`nginx:1.27-alpine` ile servis eder. Yani üretim çalışma zamanında Vite süreci
yoktur → bu açığın production saldırı yüzeyi **yoktur**.

### Gerekçe (neden ertelendi)

- `vite` bir **devDependency**'dir; prod runtime'ına dahil edilmez.
- Prod, **nginx statik build** ile servis eder; Vite dev sunucusu üretimde hiç
  başlatılmaz.
- Düzeltme yalnızca Vite'in major sürüm (8.x) geçişinde net stabilize oluyor;
  bu major geçiş şu an **ertelendi** (React/tooling uyumu + regresyon riski).
- CI `npm audit`'leri zaten `--omit=dev` ile prod bağımlılıklarını denetler ve
  bilgilendirme amaçlı `continue-on-error` ile çalışır (bkz. `.github/workflows/ci.yml`).

### Telafi edici kontroller

- Dev sunucusu yalnız geliştirici makinelerinde / güvenli ağda çalışır; internete
  açılmaz.
- Prod dağıtımı statik + nginx; Vite süreci yok.

### Yeniden değerlendirme tetikleyicisi

- Vite 8.x'e (veya açığın 5.x serisine geri-port edildiği bir yamaya) geçiş
  planlandığında bu madde kapatılır.
- Açığın dev-only olmaktan çıkıp prod build çıktısını etkilediği yeni bir advisory
  yayınlanırsa derhal yeniden değerlendirilir.
