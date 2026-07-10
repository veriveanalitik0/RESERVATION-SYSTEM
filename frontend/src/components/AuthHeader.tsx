/**
 * Auth sayfalarının ortak üst header'ı: üst-solda Landing hero ile birebir
 * aynı inline logo treatment (blur halo katmanları + yıldız parıltıları +
 * cyan drop-shadow'lu logo img), sağda geri dönüş linki.
 *
 * İki varyant:
 *  - 'overlay' (Login/Register): absolute konumlu header (z-30), 3 katmanlı
 *    blur halo (gold/violet/green) + yıldız parıltıları
 *    + duration-700 group-hover:scale-[1.02].
 *  - 'inline' (ForgotPassword/ResetPassword): normal akışta header (z-10),
 *    2 katmanlı halo (gold/green), yıldız parıltısı yok.
 */
import { Link } from 'react-router-dom';

interface Props {
  /** Sağdaki geri linkinin hedefi (örn. '/' veya '/login'). */
  backTo: string;
  /** Sağdaki geri linkinin metni (örn. '← Ana sayfa' / '← Girişe dön'). */
  backLabel: string;
  /** Header yerleşimi ve logo dekor yoğunluğu — yukarıdaki açıklamaya bak. */
  variant: 'overlay' | 'inline';
}

export function AuthHeader({ backTo, backLabel, variant }: Props) {
  const overlay = variant === 'overlay';
  return (
    <header
      className={
        overlay
          ? 'absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 md:px-10 py-6'
          : 'relative z-10 px-6 md:px-10 py-6 flex items-center justify-between'
      }
    >
      <Link to="/" aria-label="Ana sayfa" className="relative inline-block group">
        {/* Çoklu yumuşak ışık halkaları */}
        <div className="absolute inset-0 -m-8 bg-kt-gold-400/25 rounded-full blur-[60px] animate-glow-pulse pointer-events-none" />
        {overlay && (
          <div className="absolute inset-0 -m-6 bg-kt-violet-500/20 rounded-full blur-[48px] pointer-events-none" />
        )}
        <div className="absolute inset-0 -m-4 bg-kt-green-600/30 rounded-full blur-[36px] pointer-events-none" />

        {overlay && (
          <>
            {/* Yıldız parıltıları */}
            <svg className="absolute -top-4 -right-5 w-7 h-7 text-kt-gold-300 opacity-70 pointer-events-none" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0 L13.5 8.5 L22 12 L13.5 15.5 L12 24 L10.5 15.5 L2 12 L10.5 8.5 Z" className="animate-pulse-gold" />
            </svg>
            <svg className="absolute -bottom-3 -left-4 w-5 h-5 text-kt-gold-300/60 pointer-events-none" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0 L13.5 8.5 L22 12 L13.5 15.5 L12 24 L10.5 15.5 L2 12 L10.5 8.5 Z" />
            </svg>
          </>
        )}

        <div className="relative aspect-[4/3] h-16 md:h-32">
          <img
            src="/ai-lab-logo-hero.png"
            alt="Kuveyt Türk Yapay Zeka Laboratuvarı"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[60.9%] h-[215%] max-w-none w-auto object-contain pointer-events-none transition-transform duration-700 group-hover:scale-[1.02]"
            loading="eager"
            decoding="async"
          />
        </div>
      </Link>
      <Link
        to={backTo}
        className="text-sm font-semibold text-white/80 hover:text-kt-gold-300 transition-colors backdrop-blur-sm bg-black/20 px-3 py-1.5 rounded-lg border border-white/10"
      >
        {backLabel}
      </Link>
    </header>
  );
}
