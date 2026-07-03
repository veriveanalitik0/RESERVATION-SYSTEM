/**
 * Logo component — Kuveyt Türk AI Lab.
 *
 * Yeni logo (Logolar/logo1.png → /public/ai-lab-logo.png) fütüristik
 * AI temalı circuit pattern içerir; biz onu glow + dark backdrop ile sunarız.
 */
interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'dark' | 'light';
  /** Logo'nun arka planına dark glow card uygula. */
  framed?: boolean;
  /** Logonun yanında "AI Lab · Randevu Sistemi" alt metnini göster. */
  showTagline?: boolean;
}

// Logo PNG'si feather'lı saydam kenar bandı içerir (içerik ≈ kutu yüksekliğinin
// %67'si) — yükseklikler bu payı telafi edecek şekilde ~1.5x büyütüldü.
const HEIGHT_MAP = {
  sm: 'h-[4.5rem]',
  md: 'h-24',
  lg: 'h-[7.5rem]',
  xl: 'h-[16.5rem]',
} as const;

const TAGLINE_SIZE = {
  sm: 'text-[10px]',
  md: 'text-[11px]',
  lg: 'text-xs',
  xl: 'text-base',
} as const;

export function Logo({
  size = 'md',
  variant = 'dark',
  framed = false,
  showTagline = false,
}: LogoProps) {
  const heightClass = HEIGHT_MAP[size];
  const taglineSize = TAGLINE_SIZE[size];

  // Feather'lı PNG: beyaz parıltılı zemin kenarlara doğru alfa ile erir,
  // koyu/açık her zeminde kutu görünümü oluşmaz. Tüm sayfalar bunu kullanır.
  const logoSrc = '/ai-lab-logo.png';

  const taglinePrimary =
    variant === 'light' ? 'text-kt-gold-300' : 'text-kt-gold-600';
  const taglineSecondary =
    variant === 'light' ? 'text-white/85' : 'text-kt-green-800';
  const divider =
    variant === 'light' ? 'border-white/25' : 'border-kt-gold-400/30';

  const img = (
    <img
      src={logoSrc}
      alt="Kuveyt Türk AI Lab"
      className={`${heightClass} w-auto object-contain shrink-0
        transition-transform duration-300 ease-out hover:scale-[1.04]`}
      loading="eager"
      decoding="async"
    />
  );

  return (
    <div className="flex items-center gap-3">
      {framed ? (
        <div
          className={`relative rounded-2xl p-2 transition-all overflow-hidden
            bg-gradient-to-br from-kt-green-950 via-kt-green-900 to-kt-green-800
            shadow-glow-cyan ring-1 ring-kt-gold-400/30 hover:ring-kt-gold-400/60`}
        >
          {/* AI grid overlay */}
          <div className="absolute inset-0 bg-neural-grid-dark opacity-40 pointer-events-none" />
          {/* Glow corner accent */}
          <div className="absolute -top-3 -right-3 w-12 h-12 bg-kt-gold-400/40 rounded-full blur-2xl pointer-events-none" />
          <div className="relative">{img}</div>
        </div>
      ) : (
        img
      )}
      {showTagline && (
        <div className={`pl-3 border-l ${divider} leading-tight`}>
          <div
            className={`font-bold tracking-[0.18em] uppercase ${taglineSize} ${taglinePrimary}`}
          >
            AI Lab
          </div>
          <div
            className={`${taglineSecondary} ${
              size === 'sm' ? 'text-xs' : 'text-sm'
            } font-semibold whitespace-nowrap`}
          >
            Randevu Sistemi
          </div>
        </div>
      )}
    </div>
  );
}
