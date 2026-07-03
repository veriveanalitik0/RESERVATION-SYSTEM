/**
 * AI Lab — Yapay Zeka Laboratuvarı teması.
 *
 * Yeni logo'dan (Final logo1.png → /public/ai-lab-logo.png) türetilen palette.
 * Logo GERÇEK renkleri (sips analizi): canlı ÇİM/GRASS yeşili #64AD30, derin
 * yazı yeşili #529D1E (hue ~95°, sarımsı-yeşil — teal/zümrüt DEĞİL), zemin
 * near-white mint #F5F6F4. Palette buna göre:
 *  - Primary: Çim yeşili devre deseni (#6FB02C → #579418 → #2D4A17)
 *  - Secondary / accent: Canlı turuncu (#F97316, #FB923C) — "LABORATUVARI" vurgusu
 *  - Background: Yeşil-beyaz (green-white) — açık zemin #f4fae9 / beyaz
 *  - Glow: Parlak çim (#8BCB44, #B6E07D) — neural parıltı
 *
 * NOT: Eski `kt-*` class isimleri korundu (büyük refactor önlendi); değerleri
 * yeniden tanımlandı. Geriye dönük uyumluluk için `kt-green-*` çim yeşili,
 * `kt-gold-*` turuncu accent, `kt-violet-*` sıcak amber/turuncu rolünde.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        kt: {
          /**
           * Primary brand color — ÇİM/grass yeşili (logo petalleri, hue ~95°).
           * 50-300: hafif backgrounds, 400-600: mid accents, 700-950: derin orman.
           */
          green: {
            50:  '#f4fae9', // yeşil-beyaz zemin tint
            100: '#e5f3ca',
            200: '#cbe89e',
            300: '#aadb69',
            400: '#8bcb44', // parlak çim (logo glow)
            500: '#6fb02c', // logo canlı çim (#64AD30 ≈)
            600: '#579418', // logo derin yazı yeşili (brand primary, #529D1E ≈)
            700: '#457618', // derin çim
            800: '#385d18', // dark card / heading bg
            900: '#2d4a17', // derin orman (text/headings — "YAPAY ZEKA")
            950: '#16280b', // near-black orman
          },
          /**
           * Accent color — turuncu (eski "altın" rolü; logo "LABORATUVARI"/alt petaller).
           * Highlight, badge, focus ring için kullanılır.
           */
          gold: {
            50:  '#fff7ed', // hint of orange
            100: '#ffedd4',
            200: '#fed7a8',
            300: '#fdba74', // açık turuncu glow
            400: '#fb923c', // parlak turuncu
            500: '#f97316', // ana turuncu (logo accent)
            600: '#ec6709', // derin turuncu ("LABORATUVARI")
            700: '#c2560c',
            800: '#9a4310',
            900: '#7c3711',
          },
          /**
           * Sıcak amber/turuncu hint (yeşil+turuncu ile uyumlu — eski violet rolü).
           */
          violet: {
            50:  '#fff7ed',
            100: '#ffedd4',
            300: '#fdba74',
            500: '#f97316',
            600: '#ea670c',
            700: '#c2560c',
          },
          cream:  '#f6fbec', // çok hafif çim-yeşil tint (eski cream)
          ivory:  '#e5f3ca',
          // Mekan render'larından türetilmiş yumuşak vurgular (çim yeşili tonları)
          sage: {
            50:  '#f4fae9',
            100: '#e5f3ca',
            200: '#cbe89e',
            300: '#aadb69',
            400: '#8bcb44',
            500: '#6fb02c',
          },
          // Sıcak vurgular (turuncu tonları — eski pembe "coral")
          coral: {
            50:  '#fff7ed',
            100: '#ffedd5',
            200: '#fed7aa',
            300: '#fdba74',
            400: '#fb923c',
            500: '#f97316',
          },
          oak: {
            50:  '#f1f5f9',
            100: '#e2e8f0',
            200: '#cbd5e1',
            300: '#94a3b8',
            400: '#64748b',
          },
          /**
           * Gri — nötr slate (app yüzeyleri).
           */
          gray: {
            50:  '#f8fafc', // app background
            100: '#f1f5f9',
            200: '#e2e8f0',
            300: '#cbd5e1',
            400: '#94a3b8',
            500: '#64748b',
            600: '#475569',
            700: '#334155',
            800: '#1e293b',
            900: '#0f172a',
          },
        },
        /**
         * Yeni semantic isimler — gelecekte refactor için tercih edilen.
         */
        ai: {
          glow:   '#8BCB44', // parlak çim glow
          cyan:   '#6FB02C', // primary çim yeşili
          blue:   '#579418', // derin çim yeşili
          deep:   '#16280B', // near-black orman
          dark:   '#2D4A17', // derin orman
          accent: '#F97316', // turuncu accent (secondary)
          violet: '#F97316', // turuncu (secondary)
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        // Soft glow shadows — çim yeşili/neural vibe
        'kt-soft':  '0 4px 20px rgba(87, 148, 24, 0.10)',
        'kt-card':  '0 8px 30px rgba(87, 148, 24, 0.18)',
        'kt-green': '0 6px 24px rgba(87, 148, 24, 0.45)',
        'kt-gold':  '0 6px 24px rgba(249, 115, 22, 0.50)',
        // Neon glow — primary çim yeşili, secondary turuncu
        'glow-cyan':    '0 0 20px rgba(111, 176, 44, 0.6), 0 0 40px rgba(111, 176, 44, 0.3)',
        'glow-blue':    '0 0 20px rgba(87, 148, 24, 0.6), 0 0 40px rgba(87, 148, 24, 0.3)',
        'glow-violet':  '0 0 20px rgba(249, 115, 22, 0.5), 0 0 40px rgba(249, 115, 22, 0.25)',
        'inset-glow':   'inset 0 0 16px rgba(111, 176, 44, 0.25)',
        'neon-edge':    '0 0 0 1px rgba(111, 176, 44, 0.4), 0 0 24px rgba(111, 176, 44, 0.35)',
      },
      backgroundImage: {
        // Reusable gradient'lar — çim yeşili/orman + turuncu accent
        'ai-hero':       'linear-gradient(135deg, #0d1c07 0%, #1b3310 35%, #385d18 70%, #6fb02c 100%)',
        'ai-mesh':       'radial-gradient(at 20% 30%, rgba(111, 176, 44, 0.20) 0%, transparent 50%), radial-gradient(at 80% 70%, rgba(249, 115, 22, 0.18) 0%, transparent 50%), radial-gradient(at 50% 50%, rgba(87, 148, 24, 0.12) 0%, transparent 60%)',
        'ai-glow-btn':   'linear-gradient(135deg, #6fb02c 0%, #579418 50%, #457618 100%)',
        'ai-glow-soft':  'linear-gradient(135deg, rgba(111, 176, 44, 0.15) 0%, rgba(249, 115, 22, 0.10) 100%)',
        'ai-card-dark':  'linear-gradient(180deg, #2a4715 0%, #1b3310 100%)',
        'ai-grid':       'linear-gradient(rgba(111, 176, 44, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(111, 176, 44, 0.08) 1px, transparent 1px)',
      },
      animation: {
        'fade-in':       'fadeIn 0.4s ease-out',
        'slide-up':      'slideUp 0.4s ease-out',
        'pulse-gold':    'pulseGold 2s infinite',
        'ken-burns':     'kenBurns 24s ease-in-out infinite alternate',
        'mesh-shift':    'meshShift 18s ease-in-out infinite',
        'float-slow':    'floatSlow 8s ease-in-out infinite',
        'float-medium':  'floatSlow 6s ease-in-out infinite reverse',
        // Yeni AI animasyonlar
        'glow-pulse':    'glowPulse 3s ease-in-out infinite',
        'neural-flow':   'neuralFlow 12s linear infinite',
        'scan-line':     'scanLine 3s linear infinite',
        'circuit-trace': 'circuitTrace 4s ease-in-out infinite',
        'orbit':         'orbit 20s linear infinite',
        'shimmer':       'shimmer 2.5s linear infinite',
        'spotlight':     'spotlight 2s ease .75s 1 forwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to:   { transform: 'translateY(0)',     opacity: '1' },
        },
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(249, 115, 22, 0.55)' },
          '50%':      { boxShadow: '0 0 0 14px rgba(249, 115, 22, 0)' },
        },
        kenBurns: {
          '0%':   { transform: 'scale(1.05) translate(0, 0)' },
          '100%': { transform: 'scale(1.15) translate(-2%, 1%)' },
        },
        meshShift: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%':      { transform: 'translate(8%, -4%) scale(1.08)' },
          '66%':      { transform: 'translate(-4%, 6%) scale(0.95)' },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-20px)' },
        },
        glowPulse: {
          '0%, 100%': {
            boxShadow: '0 0 20px rgba(111, 176, 44, 0.4), 0 0 40px rgba(111, 176, 44, 0.2)',
          },
          '50%': {
            boxShadow: '0 0 32px rgba(111, 176, 44, 0.7), 0 0 60px rgba(111, 176, 44, 0.4)',
          },
        },
        neuralFlow: {
          '0%':   { backgroundPosition: '0% 0%, 0% 0%' },
          '100%': { backgroundPosition: '40px 40px, 40px 40px' },
        },
        scanLine: {
          '0%':   { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        circuitTrace: {
          '0%':   { strokeDashoffset: '100' },
          '100%': { strokeDashoffset: '0' },
        },
        orbit: {
          '0%':   { transform: 'rotate(0deg) translateX(40px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(40px) rotate(-360deg)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        spotlight: {
          '0%':   { opacity: '0', transform: 'translate(-72%, -62%) scale(0.5)' },
          '100%': { opacity: '1', transform: 'translate(-50%, -40%) scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
