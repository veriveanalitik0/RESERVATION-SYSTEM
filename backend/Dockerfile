# Backend (Express + TypeScript) — dev odaklı image.
# Native modüller (argon2 vb.) genelde prebuild iner; inmezse python3/make/g++ ile
# kaynaktan derlenir. Kaynak runtime'da volume-mount edilir (hot-reload),
# node_modules ise named volume ile container'ın linux-native kopyası korunur
# (host'un darwin binary'leri gölgelenmez).
#
# İZİN MODELİ: Container ayrıcalıksız 'node' kullanıcısıyla çalışır ve node_modules
# named volume ile kalıcıdır. Bir named volume, boş bir klasöre İLK bağlandığında
# image içeriğini SAHİPLİĞİYLE kopyalar — bu yüzden node_modules'ın node-sahipli
# olması gerekir (aksi halde Linux host'ta yazma gereken kütüphaneler EACCES verir).
# Bunu 'chown -R' ile sonradan düzeltmek yerine kurulumu baştan 'node' olarak yapıp
# dosyaların doğuştan node sahipli olmasını sağlıyoruz (image şişmez).
FROM node:22-bookworm-slim

WORKDIR /app

# Saat dilimi: randevu/cron tarih hesapları TR gününe göre çalışır.
ENV TZ=Europe/Istanbul

# --- ROOT bölgesi: sistem paketleri (apt) root ayrıcalığı ister ---
# Native bağımlılıkların kaynaktan derlenmesi gerekirse diye build araçları.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# /app'i node'a devret; buradan sonrası ayrıcalıksız kullanıcı.
RUN chown node:node /app

# --- NON-ROOT bölgesi: bağımlılık kurulumu + kaynak ---
# 'node' olarak kurulan node_modules doğuştan node sahipli → named volume ilk
# kopyalamada bu sahipliği taşır, EACCES oluşmaz.
USER node

# Önce manifest → katman cache (kaynak değişince npm install tekrar koşmasın).
COPY --chown=node:node package*.json ./
RUN npm install

# Kaynak (dev'de bind-mount ile gölgelenir; image yine de çalışır halde).
COPY --chown=node:node . .

# Veri dizini (üretilen görseller buraya yazılır) — node zaten /app sahibi olduğu
# için mkdir ayrıcalık sorunu çıkarmaz.
RUN mkdir -p /app/data

EXPOSE 4000

# tsx watch — kod değişince otomatik reload.
CMD ["npm", "run", "dev"]
