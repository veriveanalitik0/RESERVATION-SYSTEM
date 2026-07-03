# Frontend (Vite + React) — dev odaklı image.
# Native modül yok; slim yeterli. Kaynak runtime'da volume-mount edilir (HMR).
FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Non-root sertleştirme: ayrıcalıksız 'node' kullanıcısı (AppSec: dockerfile missing-user).
# Vite dev bind-mount kaynağıyla çalışır; node_modules okuma erişimi yeterli.
USER node

EXPOSE 5173

# Vite dev — tüm arayüzlere bind (container dışından erişim için).
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
