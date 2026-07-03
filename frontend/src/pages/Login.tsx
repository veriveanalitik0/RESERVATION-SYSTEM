import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { api, clearCsrfCache } from '../services/api';
import { ymdLocal } from '../lib/utils';
import LoginPage from '@/components/ui/gaming-login';

/**
 * Tek giriş ekranı. Backend hem admins hem users tablosunu kontrol eder.
 * Login başarılıysa response.type ('user' | 'admin') dönüşüne göre yönlendirme yapılır.
 *
 * Görsel: Landing hero ile ortak arkaplan (/ai-lab-bg.jpg + ken-burns + AI mesh
 * orb'ları) + gaming-login style glass dark form card.
 */
export default function Login() {
  const { login, completeMfaLogin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  // MFA ikinci adımı: backend pending token döndüyse TOTP kodu istenir.
  const [mfaPendingToken, setMfaPendingToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  // Sayfa açıldığında cache'lenmiş CSRF token'ı temizle. Backend restart
  // veya session geçişi sonrası bayat token kullanmamak için (bir sonraki
  // istek fresh fetch yapacak).
  useEffect(() => {
    clearCsrfCache();
  }, []);

  async function redirectAfterLogin(kind: string, subject: { fullName: string; governanceRole?: string | null }) {
    // Yönetişim rolüne göre redirect: admin → /admin, danışman → /danisman,
    // ar-ge → /arge. Normal kullanıcı: aktif (onaylı, süresi geçmemiş) randevusu
    // varsa kişisel dashboard'a, yoksa oda seçim ekranına.
    let destination = '/rooms';
    let greetingSuffix = '.';
    if (kind === 'admin') {
      destination = '/admin';
      greetingSuffix = ' — yönetim paneline yönlendiriliyorsunuz.';
    } else if (subject.governanceRole === 'analitik_danisman') {
      destination = '/danisman';
      greetingSuffix = ' — analitik danışman paneline yönlendiriliyorsunuz.';
    } else if (subject.governanceRole === 'yz_arge') {
      destination = '/arge';
      greetingSuffix = ' — Ar-Ge paneline yönlendiriliyorsunuz.';
    } else if (subject.governanceRole === 'izleyici') {
      destination = '/izleyici';
      greetingSuffix = ' — izleme paneline yönlendiriliyorsunuz.';
    } else {
      try {
        const today = ymdLocal();
        const res = await api.listUserBookings();
        const hasActive = res.bookings.some(
          (b) => b.status === 'approved' && b.endDate >= today
        );
        if (hasActive) destination = '/dashboard';
      } catch {
        // Liste alınamazsa varsayılan /rooms'a düş — login engellenmez.
      }
    }
    toast.push('success', `Hoş geldiniz ${subject.fullName}${greetingSuffix}`);
    navigate(destination, { replace: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.mfaRequired && result.mfaPendingToken) {
        // Oturum henüz açılmadı — TOTP adımına geç.
        setMfaPendingToken(result.mfaPendingToken);
        toast.push('info', 'Güvenlik doğrulaması: authenticator kodunuzu girin.');
        return;
      }
      await redirectAfterLogin(result.kind, result.subject);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Giriş başarısız.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !mfaPendingToken) return;
    setLoading(true);
    try {
      const { kind, subject } = await completeMfaLogin(mfaPendingToken, mfaCode);
      setMfaPendingToken(null);
      setMfaCode('');
      await redirectAfterLogin(kind, subject);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'MFA_SESSION_INVALID' || code === 'MFA_SESSION_REQUIRED') {
        // Pending token süresi doldu — baştan giriş gerekir.
        setMfaPendingToken(null);
        setMfaCode('');
        toast.push('error', 'Doğrulama süresi doldu. Lütfen yeniden giriş yapın.');
      } else {
        toast.push('error', (err as Error).message || 'MFA doğrulaması başarısız.');
      }
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(which: 'user' | 'admin' | 'danisman' | 'arge' | 'izleyici' | 'mehmet' | 'furkan' | 'fatih') {
    if (which === 'user') {
      setEmail('user@klab.test');
      setPassword('Demo1234!Pass');
    } else if (which === 'admin') {
      setEmail('admin@klab.test');
      setPassword('Admin1234!Pass');
    } else if (which === 'danisman') {
      // Ayşe Yılmaz — governance_role: analitik_danisman (seed)
      setEmail('ayse.yilmaz@klab.test');
      setPassword('Ayse1234!Pass');
    } else if (which === 'izleyici') {
      // Gözlem Yetkilisi — governance_role: izleyici (seed, salt-okunur)
      setEmail('izleyici@klab.test');
      setPassword('Izleyici1234!');
    } else if (which === 'mehmet') {
      setEmail('mehmet.huyut@klab.test');
      setPassword('Mehmet1234!Pass');
    } else if (which === 'furkan') {
      setEmail('furkan.kocal@klab.test');
      setPassword('Furkan1234!Pass');
    } else if (which === 'fatih') {
      setEmail('fatih.baday@klab.test');
      setPassword('Fatih1234!Pass');
    } else {
      // Burak Şahin — governance_role: yz_arge (seed)
      setEmail('burak.sahin@klab.test');
      setPassword('Burak1234!Pass');
    }
  }

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center px-4 py-12 overflow-hidden bg-kt-green-950">
      {/* ========== ARKAPLAN — Landing hero ile aynı ========== */}
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
      <div className="absolute top-10 right-1/3 w-72 h-72 bg-kt-green-600/30 rounded-full blur-[100px] pointer-events-none" />

      {/* Üst-sol: Landing hero ile birebir aynı inline logo treatment
          — 3 katmanlı blur halo (gold/violet/green) + yıldız parıltıları
          + cyan drop-shadow + duration-700 group-hover:scale-[1.02] */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 md:px-10 py-6">
        <Link to="/" aria-label="Ana sayfa" className="relative inline-block group">
          {/* Çoklu yumuşak ışık halkaları */}
          <div className="absolute inset-0 -m-8 bg-kt-gold-400/25 rounded-full blur-[60px] animate-glow-pulse pointer-events-none" />
          <div className="absolute inset-0 -m-6 bg-kt-violet-500/20 rounded-full blur-[48px] pointer-events-none" />
          <div className="absolute inset-0 -m-4 bg-kt-green-600/30 rounded-full blur-[36px] pointer-events-none" />

          {/* Yıldız parıltıları */}
          <svg className="absolute -top-4 -right-5 w-7 h-7 text-kt-gold-300 opacity-70 pointer-events-none" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0 L13.5 8.5 L22 12 L13.5 15.5 L12 24 L10.5 15.5 L2 12 L10.5 8.5 Z" className="animate-pulse-gold" />
          </svg>
          <svg className="absolute -bottom-3 -left-4 w-5 h-5 text-kt-gold-300/60 pointer-events-none" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0 L13.5 8.5 L22 12 L13.5 15.5 L12 24 L10.5 15.5 L2 12 L10.5 8.5 Z" />
          </svg>

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
          to="/"
          className="text-sm font-semibold text-white/80 hover:text-kt-gold-300 transition-colors backdrop-blur-sm bg-black/20 px-3 py-1.5 rounded-lg border border-white/10"
        >
          ← Ana sayfa
        </Link>
      </header>

      {/* Merkez: glass form card (veya MFA doğrulama adımı) */}
      <div className="relative z-20 w-full max-w-md animate-fade-in">
        {mfaPendingToken ? (
          <form
            onSubmit={handleMfaSubmit}
            className="backdrop-blur-xl bg-black/40 border border-white/10 rounded-2xl p-8 shadow-2xl flex flex-col gap-5"
          >
            <div>
              <h2 className="text-xl font-bold text-white">İki Aşamalı Doğrulama</h2>
              <p className="mt-2 text-sm text-white/70">
                Authenticator uygulamanızdaki 6 haneli kodu veya yedek kodunuzu girin.
              </p>
            </div>
            <input
              autoFocus
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.trim())}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              aria-label="MFA doğrulama kodu"
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-white text-center text-2xl tracking-[0.3em] placeholder:text-white/30 focus:border-kt-gold-300 outline-none"
            />
            <button
              type="submit"
              disabled={loading || mfaCode.length < 6}
              className="w-full py-3 rounded-xl bg-kt-gold-400 hover:bg-kt-gold-300 text-kt-green-950 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Doğrulanıyor…' : 'Doğrula ve Giriş Yap'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMfaPendingToken(null);
                setMfaCode('');
              }}
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              ← Farklı hesapla giriş yap
            </button>
          </form>
        ) : (
          <LoginPage.LoginForm
            email={email}
            password={password}
            remember={remember}
            loading={loading}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onRememberChange={setRemember}
            onSubmit={handleSubmit}
            onDemoFill={fillDemo}
            onHomeClick={() => navigate('/')}
            registerHref="/register"
            forgotHref="/forgot-password"
          />
        )}
      </div>
    </div>
  );
}
