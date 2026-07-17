# Claude Code Oturum Kaydı — 16 Temmuz 2026

> **Proje:** RESERVATION SYSTEM (Kuveyt Türk AI Lab — Oda Randevu Sistemi)
> **Tarih:** 2026-07-16
> **Model:** Claude Opus 4.8 (1M context)
> **Sonuç commit'i:** `eaac06c` → `origin/main` (34 dosya, +115 / −2018)

---

## 1. Soru: "Bu projede dışa bağımlılıklar nelerdir?"

İnceleme sonucu çıkan tablo:

### Çalışma zamanı dış servisler
- **Görsel üretim sağlayıcıları** (`IMAGE_PROVIDER` ile seçilir):
  - `router.huggingface.co` — Hugging Face (`HUGGINGFACE_API_KEY`)
  - `gen.pollinations.ai` — Pollinations (`POLLINATIONS_TOKEN`)
  - `generativelanguage.googleapis.com` — Google Gemini (`GEMINI_API_KEY`)
- **Embedding modeli:** `@xenova/transformers` → ilk kullanımda HF Hub'dan ~22MB model indirir (`all-MiniLM-L6-v2`), sonra lokal cache
- **Seed kitap kapakları:** dış CDN'lere `<img src>` (amazon, kitapyurdu, openlibrary, oreilly, manning…) — backend istek atmaz

### Altyapı
- PostgreSQL 16 (`postgres:16-alpine`), Docker/Compose, Node.js ≥ 18

### NPM (öne çıkanlar)
- **Backend:** express, helmet, cors, csrf-csrf, argon2, jsonwebtoken, speakeasy, pg, zod, winston, prom-client, `@xenova/transformers`
- **Frontend:** react 18, react-router-dom 6, three, lucide-react; dev: vite, tailwind, playwright
- **Not:** vite 5.4.x dev-only path-traversal → bilinçli kabul edilmiş risk (AR-001)

**Özet:** Prod'da zorunlu tek dış servis PostgreSQL; görsel sağlayıcılar opsiyonel, embedding modeli ilk indirme sonrası offline.

---

## 2. Soru: "Embedding hangi kısımda kullanılıyor?"

Merkez: `backend/src/services/embedding.service.ts` (MiniLM 384-dim, yüklenemezse TF-IDF fallback).

| Kullanım | Yer |
|---|---|
| Booking create/update → vektör üret, DB'ye yaz | `booking.service.ts` (fire-and-forget) |
| Waitlist terfisinde embedding hesapla | `waitlist.service.ts` |
| Duplicate uyarısı (cosine ≥ 0.80, bloklamaz) | `booking.routes.ts` → `detectDuplicate` |
| Benzer proje keşfi (`/similar`, `/collaborations`) | `discovery.routes.ts` (privacy-safe, showcase opt-in) |
| Admin analitik (`/embedding/status`, `/backfill`, `/similar`) | `analytics.routes.ts` |
| Server boot warm-up + backfill | `index.ts` |
| KVKK purge'da embedding silme | `privacy.service.ts` |

Veri DB'de `project_embeddings` tablosunda JSON olarak saklanıyordu; benzerlik hesabı tamamen sunucu içi.

---

## 3. Karar: Embedding'i sil, görsel üretimi flag'le

Kullanıcı isteği: *"embedding kısmını benzerlik ile ilgili her şeyi projeden komple sil. Görsel üretim kısmını flagla."*

Önemli tespit (işlem öncesi): dosyalar zaten commit'li ve GitHub'a push'lanmıştı → `.gitignore` tek başına işe yaramaz; geçmiş commit'lerde kalmaya devam ederler.

### 3a. Embedding/benzerlik — komple silindi

**Silinen dosyalar:**
- `backend/src/services/embedding.service.ts`
- `backend/tests/embedding-service.test.ts`

**Temizlenen yerler:**
- `index.ts` — warm-up + backfill bloğu
- `booking.service.ts` — create/update/delete embedding çağrıları
- `waitlist.service.ts` — terfi embedding'i
- `privacy.service.ts` — purge'daki `project_embeddings` DELETE'leri + `deletedEmbeddings` alanı
- `booking.routes.ts` — duplicate uyarısı (yanıt artık `{ booking }`)
- `discovery.routes.ts` — `/similar` + `/collaborations` silindi, `/leaderboard` kaldı
- `analytics.routes.ts` — `/embedding/*` + admin `/similar`
- `validators/schemas.ts` — `similarSearchSchema`, `collaborationSchema`
- `openapi.ts` — `SimilarSearchResult` + path'ler
- `shared/index.d.ts` — `SimilarBooking`, `DuplicateMatch`
- Frontend: `api/bookings.ts`, `UserRooms.tsx` (duplicate toast), `types/index.ts`

**DB:**
- `schema.pg.sql` → `project_embeddings` CREATE + FK çıkarıldı
- Yeni migration: `0010-drop-project-embeddings.sql` (`DROP TABLE IF EXISTS`)

**Bağımlılık:** `@xenova/transformers` kaldırıldı; artık gereksiz `protobufjs` override'ı temizlendi.

### 3b. Görsel üretim — `FEATURE_VISUALS` flag'i

Mevcut `FEATURE_WEEKDAY_SELECTION` kalıbı birebir izlendi:

- **Backend:** `config.visualsEnabled` (`FEATURE_VISUALS !== 'false'`, varsayılan açık)
  - Kapalıyken `/user/visuals` + `/chat/background` → **503 FEATURE_DISABLED**
  - `warmupTranslation()` atlanır → HF/Pollinations/Gemini'ye **hiç istek çıkmaz**
- **Frontend:** `FEATURES.visualStudio` (`VITE_FEATURE_VISUALS`, build-time)
  - Gizlenenler: Profil "🎨 Görsel Üret" sekmesi, profil arka planı bölümü, sohbet teması butonu (Chat), showcase kart arkaplan butonu (ShowcaseCard)
- **Prod:** `docker-compose.prod.yml` varsayılanı **KAPALI** (`FEATURE_VISUALS:-false`, frontend build-arg dahil); `frontend/Dockerfile.prod`'a `ARG/ENV VITE_FEATURE_VISUALS` eklendi
- `.env.prod.example`, `backend/.env.example`, `frontend/.env.example` güncellendi
- Prod compose'tan `MODEL_CACHE_DIR` kaldırıldı, embedding'e atıf yapan yorumlar düzeltildi

### 3c. Doğrulama
- Backend `typecheck` + `lint` ✅
- Backend test: **24 dosya / 218 test geçti** ✅ (container içinde, `klab_test` DB)
- Frontend `tsc -b` + `lint` ✅
- Backend restart → migration `0010` uygulandı, `to_regclass('project_embeddings')` = NULL (tablo düştü) ✅
- Flag parse canlı doğrulandı: `FEATURE_VISUALS=false → false`, unset → `true` ✅
- Kalıntı taraması: yalnız yorum/doc satırları kaldı, onlar da temizlendi (README tablo listesi dahil)

---

## 4. Vite EACCES sorunu (prod'a geçişte)

**Hata:**
```
klab-frontend | Error: EACCES: permission denied,
mkdir '/app/node_modules/.vite/deps_temp_afd91693'
```

### Kök sebep (iki katman)
1. **Prod makinede DEV stack çalıştırılmış** — `klab-frontend` dev compose'un adı; Vite dev server prod'a ait değil. Prod stack'te (`docker-compose.prod.yml`) frontend nginx statik build'dir, Vite hiç çalışmaz.
2. **Root-sahipli `node_modules` + non-root kullanıcı** — dev Dockerfile `npm install`'ı root olarak yapar, sonra `USER node`; `frontend_node_modules` named volume ilk oluşturulduğunda root sahipliğiyle kopyalanır → `node` (uid 1000) `.vite` cache'ini yazamaz. macOS Docker Desktop sahipliği şeffaf eşlediği için lokalde görünmez, Linux host'ta patlar.

### Çözümler
| # | Çözüm | Durum |
|---|---|---|
| A | Prod'da prod stack kullan (`-f docker-compose.prod.yml`) — asıl çözüm | Önerildi |
| B | Dev Dockerfile'a `chown -R node:node /app/node_modules` (kalıcı) | Önerildi, **henüz uygulanmadı** |
| C | Volume sahipliğini düzelt (hızlı workaround) | **UYGULANDI** ✅ |

### Uygulanan (C)
```bash
docker run --rm -v randevu-takip_frontend_node_modules:/nm alpine chown -R 1000:1000 /nm
docker start klab-frontend
```
Sonuç: `VITE v5.4.21 ready in 114 ms`, `.vite` dizini `node:node`, yazma testi **OK**.

Not: `klab-backend` o stack'te hâlâ kapalıydı (exit 137) — gerekiyorsa `docker start klab-backend`.

---

## 5. GitHub'a push

- `.gitignore`'a `*.zip` eklendi → **`backend/keys.zip` (JWT anahtarları!) ve `backend/src/config/env.ts.zip` commit'e dahil edilmedi** ve artık yanlışlıkla eklenemez
- Commit: `eaac06c` — *"Embedding/benzerlik özelliği kaldırıldı + görsel üretim FEATURE_VISUALS flag'i arkasına alındı"*
- Push: `502175b..eaac06c  main -> main` → https://github.com/veriveanalitik0/RESERVATION-SYSTEM.git

---

## 6. Açık kalan maddeler

- [ ] **Dockerfile kalıcı EACCES düzeltmesi (çözüm B):** `frontend/Dockerfile` (ve tutarlılık için `backend/Dockerfile`) → `npm install && chown -R node:node /app/node_modules`; ardından ilgili `*_node_modules` volume'ları yeniden oluşturulmalı
- [ ] **Git kimliği:** commit `AI Lab <ailab_mac@AI-Mac-Studio.local>` olarak atıldı; GitHub hesabıyla eşleşmesi için `git config --global user.name/user.email` ayarlanabilir
- [ ] **Geri getirme notu:** silinen embedding kodu geçmişte duruyor → `git show 502175b:backend/src/services/embedding.service.ts`
- [ ] Görsel üretimi prod'da açmak için: `.env.prod`'da `FEATURE_VISUALS=true` + sağlayıcı anahtarı + `--build` ile yeniden ayağa kaldır (frontend flag'i build-time gömülür)

## 7. Prod dışa bağımlılık — son durum

| Bağımlılık | Durum |
|---|---|
| PostgreSQL | Compose içinde (tek zorunlu bileşen) |
| HF / Pollinations / Gemini | Flag kapalıyken **sıfır istek** (prod varsayılanı kapalı) |
| HF Hub model indirme | **Tamamen kalktı** |
| Docker Hub imajları + npm registry | Yalnız build-time |
