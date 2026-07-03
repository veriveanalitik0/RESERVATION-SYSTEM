# Backend (Express + TypeScript) — dev odaklı image.
# Native modüller (better-sqlite3, argon2) genelde prebuild iner; inmezse
# python3/make/g++ ile kaynaktan derlenir. Kaynak runtime'da volume-mount edilir
# (hot-reload), node_modules ise anonim volume ile container'ın linux-native
# kopyası korunur (host'un darwin binary'leri gölgelenmez).
FROM node:22-bookworm-slim

WORKDIR /app

# Saat dilimi: randevu/cron tarih hesapları TR gününe göre çalışır.
ENV TZ=Europe/Istanbul

# Native bağımlılıkların kaynaktan derlenmesi gerekirse diye build araçları.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Önce manifest → katman cache (kaynak değişince npm install tekrar koşmasın).
COPY package*.json ./
RUN npm install

# Kaynak (dev'de bind-mount ile gölgelenir; image yine de çalışır halde).
COPY . .

# Veri dizinleri node-sahipli (model cache + üretilen görseller buraya yazılır).
RUN mkdir -p /app/data && chown -R node:node /app/data

# Non-root sertleştirme: container ayrıcalıksız 'node' kullanıcısıyla çalışır
# (AppSec: dockerfile missing-user). macOS Docker Desktop'ta bind-mount uid-şeffaf;
# Linux dev'de data/ dizini yukarıda node'a chown edildi.
USER node

EXPOSE 4000

# tsx watch — kod değişince otomatik reload.
CMD ["npm", "run", "dev"]
