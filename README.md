# Kuveyt Türk AI Lab · Oda Rezervasyon Sistemi

AI Lab çalışma alanlarının (NVIDIA DGX Spark / Mac Studio pod'ları, AI Deneyim Alanı, Tribün) 1, 2 veya 3 aylık periyotlarla rezerve edildiği; kullanıcıların proje fikirlerini sunduğu, admin'in onay/ret/düzeltme akışını yönettiği bir rezervasyon ve proje yaşam döngüsü uygulaması.

Bankacılık güvenlik standartlarına göre geliştirilmiştir — bkz. `docs/security/app_security.md` ve `docs/security/data_security.md`.

## Mimari

```
┌──────────────────┐         ┌──────────────────────────────┐
│  Frontend        │         │  Backend                     │
│  React + Vite    │  HTTPS  │  Express + TypeScript        │
│  Tailwind CSS    │ ───────►│  RS256 JWT (User/Admin AYRI) │
│  React Router    │         │  PostgreSQL (pg)             │
└──────────────────┘         │  Helmet · Rate Limit · CORS  │
                             │  Argon2id · Audit Log        │
                             └──────────────────────────────┘
```

## Kurulum

### Dev (Docker — önerilen)

Tüm stack (PostgreSQL + backend + frontend) tek komutla:

```bash
docker compose up -d --build
# frontend: http://localhost:5173 · backend: http://localhost:4000
```

Kaynak değişiklikleri hot-reload edilir (backend `tsx watch`, frontend Vite HMR). İlk açılışta şema + bootstrap seed (odalar + admin + kitap katalogu) otomatik yüklenir.

### Dev (Docker'sız)

```bash
# Backend
cd backend
npm install
npm run setup            # RSA keypair + DB şema + bootstrap seed
cp .env.example .env     # CSRF_SECRET'ı en az 32 karakter yap
npm run dev              # http://127.0.0.1:4000

# Frontend (ayrı terminal)
cd frontend
npm install
npm run dev              # http://127.0.0.1:5173 — /api backend'e proxy'lenir
```

### Production

Ayrı, sertleştirilmiş stack: multi-stage image, non-root kullanıcı, dışa kapalı DB/backend portları, env'den zorunlu secret, otomatik pg yedek sidecar'ı.

```bash
cp .env.prod.example .env.prod    # güçlü parolalar, CSRF_SECRET, ENCRYPTION_KEY
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
# nginx :80 → statik frontend + /api reverse proxy → backend
```

- **İlk kurulum seed'i (otomatik):** Backend, boş bir DB'de ilk boot'ta çekirdek veriyi (bootstrap admin + odalar + kitap katalogu) **otomatik** yükler — manuel adım yok. Dolu DB'de atlanır (idempotent). Bootstrap admin parolasını `.env.prod`'da `BOOTSTRAP_ADMIN_PASSWORD` ile güçlü verin (boş bırakılırsa varsayılan kullanılır ve uyarı loglanır).
- **JWT anahtarları** image'e gömülmez; `backend/keys/*.pem` salt-okunur volume ile mount edilir (`cd backend && npm run keys:generate`).
- **HTTPS** için önüne TLS terminasyonu yapan bir reverse-proxy/LB konur (`X-Forwarded-Proto` iletmeli; backend `trust proxy` ile okuyup secure cookie üretir).

## İlk Giriş

Seed yalnızca tek bir **bootstrap admin** oluşturur (dev varsayılanı):

| E-posta | Parola |
|---------|--------|
| `admin@klab.test` | `Admin1234!Pass` |

Prod'da e-posta/parola env ile verilir: `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (bkz. `.env.prod.example`).

> ⚠️ İlk girişten sonra bu parolayı **derhal değiştirin** (`/admin` → parola değişikliği).

Kullanıcılar `/register` ile kendileri kayıt olur. **Danışman, Ar-Ge ve İzleyici** yönetişim rolleri seed'lenmez — admin panelinden (**Kullanıcılar → rol atama**, `PUT /api/admin/users/:id/governance-role`) kayıtlı kullanıcılara atanır.

## Roller

| Rol | Erişim |
|-----|--------|
| **Kullanıcı** | Oda rezervasyonu, proje sunumu, bekleme listesi, kütüphane, profil |
| **Admin** (super_admin) | Onay/ret/düzeltme, kullanıcı & rol yönetimi, analitik, denetim, yedek |
| **Analitik Danışman / YZ Ar-Ge** | Yönetişim: yaşam döngüsü, kalite kapıları, insan onayları |
| **İzleyici** | Salt-okunur görüntüleme (doluluk, talepler) |

## Güvenlik Önlemleri

| Kural | Uygulama | Kaynak |
|------|---------|--------|
| RS256 JWT (HS256 yasak) | User/Admin için ayrı 4096-bit RSA keypair | app_security §4 |
| Refresh token rotation | Her refresh'te yeni token, eski revoke | app_security §4 |
| Argon2id parola hash | memoryCost 2^16, timeCost 3 | app_security §7 |
| Brute force koruması | 5 deneme → 15 dk lockout | app_security §4 |
| Parola politikası | Min 12 karakter + karmaşıklık | app_security §4 |
| Rate limiting | Global + auth endpoint özel limit | app_security §6 |
| CORS whitelist | Wildcard yasak, sadece izinli origin | app_security §6 |
| Helmet + CSP | HSTS, X-Frame-Options, no-sniff, CSP | app_security §6 |
| Input validation (Zod) | Whitelist tabanlı, tüm endpoint'lerde | app_security §3 |
| Parameterized queries | Tüm DB sorguları placeholder ile | app_security §3 |
| Race condition koruması | Transaction + uygunluk kontrolü | app_security §10 |
| IDOR koruması | User sadece kendi kaydını görür | app_security §5 |
| Audit log + PII scrubber | Auth/authz/booking olayları; log'da otomatik [REDACTED] | app_security §8 · data_security §4 |
| Admin/User izolasyonu | Ayrı tablo, ayrı key pair, ayrı middleware | app_security §5 |

## Opsiyonel: Görsel Üretimi

Kullanıcıların proje fikrinden AI görsel üretebildiği stüdyo, `FEATURE_VISUALS` bayrağı ile açılır (prod varsayılanı **kapalı** — dış API bağımlılığı yok). Açmak için `.env.prod`'da `FEATURE_VISUALS=true` + bir sağlayıcı anahtarı (`HUGGINGFACE_API_KEY` / `POLLINATIONS_TOKEN` / `GEMINI_API_KEY`) ayarlayıp stack'i `--build` ile yeniden başlatın.

## API'ye Genel Bakış

Rol-bazlı router'lara bölünmüştür; tam liste `backend/src/routes/` altında.

- **Auth** (`/api/auth/*`) — login/register/refresh/logout (e-posta hem `admins` hem `users` tablosunda aranır), admin TOTP MFA, EK-1 beyan onayı
- **User** (`/api/user/*`) — bookings CRUD + iptal/ilerleme, rooms, appointments, waitlist, license/hardware/support talepleri, leaderboard, kütüphane, KVKK veri ihracı/silme
- **Admin** (`/api/admin/*`) — booking inceleme, kullanıcı & rol yönetimi, stats/analytics/audit, yedek, MFA yönetimi (GET'ler danışman/arge/izleyici için salt-okunur)
- **Governance** (`/api/governance/*`) — yaşam döngüsü, kalite kapıları, Stage/Production insan onayları, mühendis ataması
- **Public** (`/api/public/*`) — profil, oda kiosk, görsel (auth gerektirmez)

## Veritabanı Şeması

- **Auth & çekirdek:** `users`, `admins` (admin TOTP MFA secret AES-256-GCM şifreli), `rooms`, `bookings` (status: pending/approved/rejected/feedback_requested/cancelled · lifecycle_stage · progress_note), `appointments`, `waitlist`, `refresh_tokens` (SHA-256 hash), `audit_logs`
- **Yönetişim & talepler:** `license_requests` (+ `license_request_items`), `hardware_requests`, `support_requests`, `quality_gates`, `human_approvals`, `project_stage_events`
- **Kütüphane:** `books` (+ `book_loans`) — ödünç alma/onay/uzatma akışı
- **Etkileşim & sistem:** `showcase_likes`, `showcase_comments`, `notifications`, `visuals` (`FEATURE_VISUALS`), `password_reset_tokens`, `schema_migrations` (versiyonlu migration — `backend/src/db/migrations/`)

## Lisans

İç kurumsal kullanım — Kuveyt Türk AI Lab.
