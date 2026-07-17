# Frontend (Vite + React) — dev odaklı image.
# Native modül yok; slim yeterli. Kaynak runtime'da volume-mount edilir (HMR).
#
# İZİN MODELİ (kritik): Container ayrıcalıksız 'node' kullanıcısıyla çalışır.
# node_modules named volume ile kalıcıdır ve Vite dev, cache'ini
# node_modules/.vite altına YAZAR. Bu yüzden node_modules'ın node-sahipli olması
# ŞART — aksi halde Linux host'ta EACCES (root-sahipli klasöre node yazamaz).
# Çözüm: kurulumdan ÖNCE 'USER node'a geç → node_modules doğuştan node sahipli
# olur (sonradan `chown -R` ile ~200MB'ı yeniden etiketlemeye gerek kalmaz).
FROM node:22-bookworm-slim

WORKDIR /app

# /app'in sahibini node yap (tek klasör — maliyeti sıfıra yakın). Buradan sonraki
# tüm komutlar node olarak çalışır → kurulan dosyalar node sahipli doğar.
RUN chown node:node /app
USER node

# Önce manifest → katman cache (kaynak değişince npm install tekrar koşmasın).
# --chown: kopyalanan dosyalar da node sahipli gelsin.
COPY --chown=node:node package*.json ./
RUN npm install

# Kaynak (dev'de bind-mount ile gölgelenir; image yine de çalışır halde).
COPY --chown=node:node . .

EXPOSE 5173

# Vite dev — tüm arayüzlere bind (container dışından erişim için).
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
