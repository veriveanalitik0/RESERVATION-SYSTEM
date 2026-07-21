import { Link } from 'react-router-dom';
import { AnimatedCounter } from '../components/AnimatedCounter';

export default function Landing() {
  return (
    <div className="min-h-screen bg-kt-green-950 text-white">
      {/* ============== HERO ============== */}
      <section className="relative min-h-screen flex flex-col overflow-hidden bg-kt-green-950">
        {/* ===== ARKAPLAN — koyu yeşil devre zemini (Login ile aynı) ===== */}
        <div className="absolute inset-0">
          <img
            src="/ai-lab-bg.jpg"
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover animate-ken-burns"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-kt-green-950/65 via-kt-green-900/55 to-kt-green-950/80" />
        </div>
        <div className="absolute inset-0 bg-neural-grid-dark opacity-25 pointer-events-none" />
        <div className="absolute inset-0 bg-ai-mesh animate-mesh-shift pointer-events-none" />
        <div className="absolute top-1/4 left-10 w-96 h-96 bg-kt-gold-400/25 rounded-full blur-[120px] animate-float-slow pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-[500px] h-[500px] bg-kt-violet-500/20 rounded-full blur-[140px] animate-float-medium pointer-events-none" />
        <div className="absolute top-10 right-1/3 w-72 h-72 bg-kt-green-600/30 rounded-full blur-[100px] pointer-events-none" />
        {/* Üst yarı: logo panelinin tonu, ortada arka plana yumuşak geçiş.
            Orb'ların üstünde, içeriğin (z-10) altında. Bkz. globals.css. */}
        <div className="hero-top-wash" />

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pt-2 pb-6">
          {/* ============ LOGO ============ */}
          {/* Yerleşim kutusu viewport'a göre ölçülenir (100dvh − diğer içerik);
              görsel, kutudan bağımsız absolute merkezlenir → görsel kutu dışına
              taşar ama yerleşimi büyütmez: hero tek ekrana sığar, scroll olmaz. */}
          {/* Görsel artık panelsiz asset (ai-lab-logo-mark.png): PNG'deki yarı
              saydam beyaz panel + parıltı katmanı kaynakta ayıklandı, halo/maske
              hilelerine gerek kalmadı. Sade yeşil logo. */}
          <div className="relative w-full h-[clamp(9rem,calc(100dvh-43rem),25.5rem)] md:h-[clamp(9.5rem,calc(100dvh-37rem),25.5rem)] group">
            <img
              src="/ai-lab-logo-mark.png"
              alt="Kuveyt Türk Yapay Zeka Laboratuvarı"
              className="hero-logo-soft absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[60.9%] h-[215%] max-w-none w-auto object-contain transition-transform duration-700 group-hover:scale-[1.015]"
              loading="eager"
              decoding="async"
            />
          </div>

          <div className="max-w-5xl text-center animate-fade-in mt-12 md:mt-24">
            {/* Üst yarı aydınlatması (hero-top-wash) artık başlığın ÜSTÜNDE
                sona erer → başlık tamamen koyu zeminde, beyaz. Vurgu kelimesi
                parlak yeşil kalır; koyu zeminde de okunur. */}
            <h1 className="h-hero mb-3">
              <span className="text-white">Yapay Zeka Laboratuvarı</span><br />
              <span className="text-kt-green-600">çalışma alanlarını</span>{' '}
              <span className="text-white">projeniz için planlayın.</span>
            </h1>
            <p className="h-hero-sub text-white/80 mb-4">
              Genel Müdürlük <strong className="text-white">-1D</strong> kattaki Yapay Zeka
              Laboratuvarı; <strong className="text-white">NVIDIA DGX Spark</strong>,{' '}
              <strong className="text-white">Mac Studio</strong> ve{' '}
              <strong className="text-white">MacBook Pro</strong> donanımlı çalışma
              istasyonlarını bir araya getirir. Projenizi anlatın, uygun istasyon için izin
              alın ve sizin için en uygun tarihe randevunuzu oluşturun.
            </p>

            {/* Stats grid — koyu zeminde açık çim + turuncu accent */}
            <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-6">
              <div className="text-center">
                <div className="text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-none">
                  <AnimatedCounter end={4} duration={1400} />
                </div>
                <div className="mt-2 text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-kt-green-300">
                  NVIDIA DGX Spark
                </div>
              </div>
              <div className="text-center border-x border-white/10">
                <div className="text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-none">
                  <AnimatedCounter end={19} duration={1600} />
                </div>
                <div className="mt-2 text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-kt-green-300">
                  Mac Studio
                </div>
              </div>
              <div className="text-center">
                <div className="text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-none">
                  <AnimatedCounter end={18} duration={1800} />
                </div>
                <div className="mt-2 text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-kt-gold-300">
                  MacBook Pro
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link to="/login" className="btn-pill-primary btn-pill-lg">
                <span className="btn-pill-shimmer" />
                <span className="relative z-10 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  Giriş Yap
                </span>
              </Link>
              <Link to="/register" className="btn-pill-outline-dark btn-pill-lg">
                <span className="btn-pill-shimmer" />
                <span className="relative z-10 flex items-center gap-2">
                  Kayıt Ol
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7zM20 8v6m-3-3h6" />
                  </svg>
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
