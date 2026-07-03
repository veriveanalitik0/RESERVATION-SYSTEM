# syntax=docker/dockerfile:1
# ============================================================================
# AppSec container-scan hedefi — repo KÖKÜNDEKİ tek, sertleştirilmiş Dockerfile.
# ----------------------------------------------------------------------------
# AppSec pipeline (ahmtcnn/appsec-workflows) container-scan'i kök-öncelikli
# tespitle TEK Dockerfile build edip Trivy ile tarar:
#   docker build -f Dockerfile -t local/app:scan .
# Kök'te Dockerfile yokken recursive ilk bulduğu DEV image'ı (backend/Dockerfile,
# `apt install python3 make g++` → 14 CRITICAL) tarıyordu. Bu dosya, taranan
# image'ı production backend'in ALPINE sürümü yapar:
#   - debian bookworm yerine alpine → perl/sqlite/zlib gibi düzeltilemez debian
#     base CVE'leri YOK; openssl güncel → CRITICAL=0
#   - build araçları yalnız builder stage'inde → runtime'a taşınmaz
#   - ayrıcalıksız (USER node) → SAST missing-user bulgusu yok
#
# NOT: Bu, backend production image'idir (en güvenlik-kritik servis: auth + veri).
# Dev stack docker-compose.yml → backend/Dockerfile kullanmaya devam eder; bu
# dosya o akışı ETKİLEMEZ (compose explicit `context: ./backend` kullanır).
# Build context = repo kökü (shared/ tip kaynağı için).
#
# TARANAN = DAĞITILAN: backend/Dockerfile.prod (docker-compose.prod.yml'in build
# ettiği DAĞITILAN prod image'ı) AYNI sertleştirilmiş node:22-alpine recipe'ini
# kullanır. İki dosya bilinçli olarak hizalıdır; tek fark, deploy edilen sürüm
# (Dockerfile.prod) compose dışı ortamlar için TZ + HEALTHCHECK readiness probe'u
# da içerir. Bu dosyada değişiklik yaparsan Dockerfile.prod'u da hizalı tut.
# ============================================================================

# ---- Stage 1: builder — TS derleme + üretim bağımlılıkları (musl native build) ----
FROM node:22-alpine AS builder
WORKDIR /app

# Native modüller (argon2 vb.) alpine/musl'da kaynaktan derlenir → build araçları.
# Bunlar YALNIZ builder'da kalır; runtime image'ına taşınmaz.
RUN apk add --no-cache python3 make g++

# Önce manifest → bağımlılık katmanı cache'lenir.
COPY backend/package*.json ./
RUN npm ci

# Kaynak + paylaşılan tip kaynağı (type-only; runtime'da silinir).
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY shared /shared
RUN npm run build

# devDependencies'i çıkar — native binary'ler korunur.
RUN npm prune --omit=dev

# Volume-mount için ayrıcalıksız sahipli data dizinleri.
RUN mkdir -p /app/data/models /app/data/visuals

# ---- Stage 2: runtime — yalın alpine, ayrıcalıksız ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Base alpine OS paketlerini yamalı sürümlere yükselt — base image tag'i tazelenene
# kadar libcrypto3/libssl3 gibi openssl CVE'leri (ör. CVE-2026-45447) burada kapanır.
# Node kendi OpenSSL'ini bundle ettiğinden bu OS paketleri uygulama tarafından
# kullanılmaz; yükseltme yalnız Trivy HIGH sayısını 0'a indirir (davranış değişmez).
RUN apk upgrade --no-cache

# Prod runtime'da paket yöneticisi gerekmez. Gömülü npm/npx'i kaldır — hem saldırı
# yüzeyini düşürür hem de npm'in kendi bağımlılıklarındaki CVE'leri (örn. picomatch)
# image'dan tamamen eler. Uygulama yalnız `node dist/index.js` ile çalışır.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# node:alpine, hazır 'node' (uid 1000) kullanıcısı sağlar — ayrıcalıksız çalışır.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/data ./data
COPY --chown=node:node backend/package*.json ./

# JWT anahtarları ve veriler image'e GÖMÜLMEZ → runtime'da volume/secret ile mount.
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
