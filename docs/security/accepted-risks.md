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

---

## AR-002 — Access token sessionStorage'da (XSS'e açık depolama)

- **Tarih:** 2026-07-10
- **Bileşen:** `frontend/src/services/storage.ts` (sessionStore)
- **Durum:** KABUL EDİLDİ / ERTELENDİ (demo tehdit modeli)

### Etki

Access token (15 dk ömürlü) `sessionStorage`'da tutulur; başarılı bir XSS
token'ı okuyabilir. README "bankacılık standartlarına uygun" iddiasıyla
gerilim yaratır — bu kayıt, farkın bilinçli olduğunu belgeler.

### Gerekçe

- Refresh token zaten **HttpOnly+Secure cookie**'dedir (XSS okuyamaz);
  sessionStorage'daki yalnız kısa ömürlü access token'dır.
- CSP `script-src 'self'` (unsafe-inline yok) + Zod input validasyonu XSS
  yüzeyini daraltır; demo ortamında gerçek müşteri verisi yoktur.
- Tam cookie-tabanlı access token, SSE/queryparam auth akışının yeniden
  tasarımını gerektirir — demo kapsamında ertelendi.

### Telafi edici kontroller

- 15 dk access TTL + refresh rotation + reuse-detection (çalınan refresh
  tekrar kullanılırsa tüm zincir revoke edilir).
- Tek-aktif-oturum politikası: yeni login eski refresh'leri revoke eder.

### Yeniden değerlendirme tetikleyicisi

- Gerçek kurumsal veriyle pilot/prod kullanım kararı → cookie-tabanlı access
  token + Trusted Types zorunlu hale gelir.

---

## AR-003 — EK-1 beyan zorunluluğu istemci-tarafı (sunucu middleware'i yok)

- **Tarih:** 2026-07-10
- **Bileşen:** `frontend/src/components/ProtectedRoute.tsx` (ConsentGate),
  `POST /api/auth/consent`
- **Durum:** KABUL EDİLDİ / ERTELENDİ

### Etki

EK-1 "Okudum, Kabul Ettim" beyanı UI'da iki katmanla zorlanır (login/register
adımı + ProtectedRoute kapısı); ancak API'ye **doğrudan** istek atan bir
kullanıcı (curl/Postman) beyan onayı olmadan user endpoint'lerini çağırabilir.
Uygulama arayüzünden atlatma yolu kapatılmıştır.

### Gerekçe

- Sunucu-tarafı zorlamak `requireUser`/`requireAnySubject` guard'larına consent
  kontrolü eklemeyi ve tüm route testlerinin consent'li fixture'larla
  güncellenmesini gerektirir; demo kapsam/fayda dengesinde ertelendi.
- Onay audit'lidir (`user.consent.accepted`) ve DB'de tarih damgasıyla kalıcıdır;
  uyum raporlaması sunucu verisinden yapılabilir.

### Yeniden değerlendirme tetikleyicisi

- Gerçek kullanıcı verisiyle kullanım veya denetim (compliance) gereksinimi →
  `buildAuthMiddleware`'e consent kontrolü (admin + /api/auth/consent hariç)
  eklenir; test fixture'ları consent'li kullanıcı üretir.
