import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Paylaşılan DTO paketi (#6). Yalnız tip → `import type` ile runtime'da
      // silinir; alias scanner edge-case'i için güvenlik ağı.
      '@klab/shared': path.resolve(__dirname, '../shared/index.d.ts'),
    },
  },
  server: {
    host: true, // tüm arayüzler — Docker container dışından erişim için
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        // Docker'da backend servisine (http://backend:4000), yerelde 127.0.0.1:4000.
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:4000',
        changeOrigin: false,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
