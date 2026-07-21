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
        {/* Blur halo katmanları ve yıldız parıltıları KALDIRILDI: üst yarı artık
            logonun kendi panel tonunda (hero-top-wash), bu zeminde halolar leke
            gibi duruyordu. Landing hero ile aynı sade yeşil logo. */}
        <div className="relative aspect-[4/3] h-16 md:h-32">
          <img
            src="/ai-lab-logo-mark.png"
            alt="Kuveyt Türk Yapay Zeka Laboratuvarı"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[60.9%] h-[215%] max-w-none w-auto object-contain pointer-events-none transition-transform duration-700 group-hover:scale-[1.02]"
            loading="eager"
            decoding="async"
          />
        </div>
      </Link>
      {/* Header artık açık (hero-top-wash) zeminde duruyor → link koyu yeşil;
          eski beyaz-üstü-siyah cam varyantı bu zeminde okunmuyordu. */}
      <Link
        to={backTo}
        className="text-sm font-semibold text-kt-green-800 hover:text-kt-green-950 transition-colors bg-white/70 hover:bg-white px-3 py-1.5 rounded-lg border border-kt-green-900/10 shadow-sm"
      >
        {backLabel}
      </Link>
    </header>
  );
}
