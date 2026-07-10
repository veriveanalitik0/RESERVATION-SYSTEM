/**
 * Auth sayfalarının (Login/Register/ForgotPassword/ResetPassword) ortak
 * arkaplan katman yığını — Landing hero ile aynı görsel sistem:
 * /ai-lab-bg.jpg + ken-burns, koyu navy gradient overlay, neural grid,
 * AI mesh ve glow orb'lar.
 *
 * Kapsayıcı sayfa kökünün `relative ... overflow-hidden` olması beklenir;
 * bileşen yalnızca absolute konumlu katmanları basar.
 */

interface Props {
  /**
   * Üçüncü (yeşil, top-10 right-1/3) glow orb'u da bas.
   * Login/Register'da var, ForgotPassword/ResetPassword'de yok.
   */
  greenOrb?: boolean;
}

export function AuthBackground({ greenOrb = false }: Props) {
  return (
    <>
      {/* 1. Ana görsel + ken-burns */}
      <div className="absolute inset-0">
        <img
          src="/ai-lab-bg.jpg"
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover animate-ken-burns"
          loading="eager"
        />
        {/* 2. Koyu navy gradient overlay — okunabilirlik için */}
        <div className="absolute inset-0 bg-gradient-to-br from-kt-green-950/65 via-kt-green-900/55 to-kt-green-950/80" />
      </div>

      {/* 3. Neural grid */}
      <div className="absolute inset-0 bg-neural-grid-dark opacity-25 pointer-events-none" />
      {/* 4. AI mesh */}
      <div className="absolute inset-0 bg-ai-mesh animate-mesh-shift pointer-events-none" />
      {/* 5. Glow orbs */}
      <div className="absolute top-1/4 left-10 w-96 h-96 bg-kt-gold-400/25 rounded-full blur-[120px] animate-float-slow pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[500px] h-[500px] bg-kt-violet-500/20 rounded-full blur-[140px] animate-float-medium pointer-events-none" />
      {greenOrb && (
        <div className="absolute top-10 right-1/3 w-72 h-72 bg-kt-green-600/30 rounded-full blur-[100px] pointer-events-none" />
      )}
    </>
  );
}
