import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { clearCsrfCache } from '../services/api';

/**
 * Kullanıcı kayıt sayfası. Login ekranı ile birebir aynı görsel sistem:
 *  - /ai-lab-bg.jpg + ken-burns + AI mesh + glow orb'lar + neural grid
 *  - Üst-sol logo + ana sayfaya dön linki
 *  - Merkezde glass dark card (bg-black/55 backdrop-blur)
 *
 * Backend §4 parola politikasını uygular (min 12 + karmaşıklık).
 *
 * Rol seçimi YOKTUR: tüm kayıtlar normal "kullanıcı" olarak oluşturulur.
 * Yönetişim rolleri (analitik danışman / YZ-Ar-Ge) yalnızca admin tarafından
 * "Kullanıcılar" ekranından atanır (privilege escalation'a karşı, backend
 * registerSchema rolü zaten kabul etmiyor).
 */
export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    clearCsrfCache();
  }, []);

  const passwordChecks = {
    length: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };
  const score = Object.values(passwordChecks).filter(Boolean).length;
  const allValid = score === 5;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const newErrors: Record<string, string> = {};
    if (fullName.trim().length < 3) newErrors.fullName = 'Ad-soyad en az 3 karakter olmalı.';
    if (!email.includes('@')) newErrors.email = 'Geçerli bir e-posta girin.';
    if (!allValid) newErrors.password = 'Parola tüm kriterleri karşılamalı.';
    if (password !== passwordConfirm) newErrors.passwordConfirm = 'Parolalar eşleşmiyor.';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    setLoading(true);
    try {
      // SECURITY (C2): Kayıt her zaman normal "kullanıcı" oluşturur. Yönetişim
      // rolü (analitik danışman / YZ-Ar-Ge) burada atanamaz — backend
      // registerSchema rolü kabul etmez ve governance_role=NULL kaydedilir.
      // Rol atamasını yalnızca admin "Kullanıcılar" ekranından yapar.
      const { subject } = await register({
        email,
        password,
        passwordConfirm,
        fullName,
      });
      toast.push('success', `Hoş geldiniz ${subject.fullName}! Hesabınız oluşturuldu.`);
      navigate('/rooms', { replace: true });
    } catch (err) {
      const e = err as { message?: string; issues?: Array<{ path: string; message: string }> };
      if (e.issues?.length) {
        // Yalnız ekranda gösterilen alanların hatası inline basılır; backend
        // başka bir path (örn. body.*) dönerse sessizce kaybolmasın diye
        // eşleşmeyenleri toast ile göster.
        const KNOWN = new Set(['fullName', 'email', 'password', 'passwordConfirm']);
        const fieldErrors: Record<string, string> = {};
        const unmatched: string[] = [];
        for (const issue of e.issues) {
          if (KNOWN.has(issue.path)) fieldErrors[issue.path] = issue.message;
          else unmatched.push(issue.message);
        }
        if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
        if (unmatched.length || Object.keys(fieldErrors).length === 0) {
          toast.push('error', unmatched[0] || e.message || 'Kayıt başarısız. Bilgileri kontrol edin.');
        }
      } else {
        toast.push('error', e.message || 'Kayıt başarısız.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center px-4 py-12 overflow-hidden bg-kt-green-950">
      {/* ========== ARKAPLAN — Login ile birebir aynı katmanlar ========== */}
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

      {/* Üst header — Login ile aynı logo treatment */}
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 md:px-10 py-6">
        <Link to="/" aria-label="Ana sayfa" className="relative inline-block group">
          <div className="absolute inset-0 -m-8 bg-kt-gold-400/25 rounded-full blur-[60px] animate-glow-pulse pointer-events-none" />
          <div className="absolute inset-0 -m-6 bg-kt-violet-500/20 rounded-full blur-[48px] pointer-events-none" />
          <div className="absolute inset-0 -m-4 bg-kt-green-600/30 rounded-full blur-[36px] pointer-events-none" />
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

      {/* Glass dark card — LoginForm yapısıyla aynı */}
      <div className="relative z-20 w-full max-w-md animate-fade-in">
        <div className="relative p-8 rounded-2xl backdrop-blur-md bg-black/55 border border-white/10 shadow-2xl">
          {/* Card glow accents */}
          <div className="absolute -top-16 -right-16 w-44 h-44 bg-kt-gold-400/25 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 w-44 h-44 bg-kt-violet-500/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative">
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-bold mb-1 relative group inline-block">
                <span className="absolute -inset-1 bg-gradient-to-r from-kt-gold-400/30 via-kt-violet-500/30 to-kt-gold-500/30 blur-xl opacity-75 animate-pulse" />
                <span className="relative inline-block text-2xl font-extrabold text-white">
                  Kuveyt Türk <span className="text-shimmer">Yapay Zeka Laboratuvarı</span>
                </span>
              </h2>
              <p className="text-white/70 text-sm mt-2">
                Yeni hesap oluştur — AI Lab odalarını planlamaya başla.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
              <p className="text-xs text-white/50">
                <span className="text-red-400">*</span> işaretli alanlar zorunludur.
              </p>
              {/* Ad Soyad */}
              <div>
                <label htmlFor="fullName" className="block text-xs font-bold uppercase tracking-[0.18em] text-white/60 mb-1.5">
                  Ad Soyad<span className="text-red-400 ml-0.5" aria-hidden="true">*</span>
                </label>
                <div className="relative">
                  <User
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
                  />
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    autoComplete="name"
                    placeholder="Ayşe Yılmaz"
                    maxLength={80}
                    disabled={loading}
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/40 focus:border-kt-gold-400 focus:bg-white/15 focus:ring-2 focus:ring-kt-gold-400/30 outline-none transition-all"
                  />
                </div>
                {errors.fullName && <p className="text-xs text-rose-300 mt-1">{errors.fullName}</p>}
              </div>

              {/* E-posta */}
              <div>
                <label htmlFor="email" className="block text-xs font-bold uppercase tracking-[0.18em] text-white/60 mb-1.5">
                  E-posta<span className="text-red-400 ml-0.5" aria-hidden="true">*</span>
                </label>
                <div className="relative">
                  <Mail
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
                  />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="ornek@klab.test"
                    maxLength={254}
                    disabled={loading}
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/40 focus:border-kt-gold-400 focus:bg-white/15 focus:ring-2 focus:ring-kt-gold-400/30 outline-none transition-all"
                  />
                </div>
                {errors.email && <p className="text-xs text-rose-300 mt-1">{errors.email}</p>}
              </div>

              {/* Parola */}
              <div>
                <label htmlFor="password" className="block text-xs font-bold uppercase tracking-[0.18em] text-white/60 mb-1.5">
                  Parola<span className="text-red-400 ml-0.5" aria-hidden="true">*</span>
                </label>
                <div className="relative">
                  <Lock
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
                  />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="En az 12 karakter, karmaşık"
                    maxLength={128}
                    disabled={loading}
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/40 focus:border-kt-gold-400 focus:bg-white/15 focus:ring-2 focus:ring-kt-gold-400/30 outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i <= score
                              ? score === 5
                                ? 'bg-emerald-400'
                                : score >= 3
                                  ? 'bg-kt-gold-400'
                                  : 'bg-rose-400'
                              : 'bg-white/15'
                          }`}
                        />
                      ))}
                    </div>
                    <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-white/70">
                      <li className={passwordChecks.length ? 'text-emerald-300' : ''}>
                        {passwordChecks.length ? '✓' : '○'} 12+ karakter
                      </li>
                      <li className={passwordChecks.upper ? 'text-emerald-300' : ''}>
                        {passwordChecks.upper ? '✓' : '○'} Büyük harf
                      </li>
                      <li className={passwordChecks.lower ? 'text-emerald-300' : ''}>
                        {passwordChecks.lower ? '✓' : '○'} Küçük harf
                      </li>
                      <li className={passwordChecks.digit ? 'text-emerald-300' : ''}>
                        {passwordChecks.digit ? '✓' : '○'} Rakam
                      </li>
                      <li className={passwordChecks.special ? 'text-emerald-300' : ''}>
                        {passwordChecks.special ? '✓' : '○'} Özel karakter
                      </li>
                    </ul>
                  </div>
                )}
                {errors.password && <p className="text-xs text-rose-300 mt-1">{errors.password}</p>}
              </div>

              {/* Parola tekrar */}
              <div>
                <label htmlFor="passwordConfirm" className="block text-xs font-bold uppercase tracking-[0.18em] text-white/60 mb-1.5">
                  Parola (tekrar)<span className="text-red-400 ml-0.5" aria-hidden="true">*</span>
                </label>
                <div className="relative">
                  <Lock
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
                  />
                  <input
                    id="passwordConfirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    maxLength={128}
                    disabled={loading}
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/40 focus:border-kt-gold-400 focus:bg-white/15 focus:ring-2 focus:ring-kt-gold-400/30 outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.passwordConfirm && (
                  <p className="text-xs text-rose-300 mt-1">{errors.passwordConfirm}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !allValid}
                className="btn-pill-primary btn-pill-md w-full"
              >
                <span className="btn-pill-shimmer" />
                <span className="relative z-10 font-semibold">
                  {loading ? 'Hesap oluşturuluyor…' : 'Hesap Oluştur'}
                </span>
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-white/70">
              Zaten hesabın var mı?{' '}
              <Link
                to="/login"
                className="font-semibold text-kt-gold-300 hover:text-kt-gold-200 transition-colors"
              >
                Giriş yap →
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-white/60 mt-6 backdrop-blur-sm bg-black/20 px-3 py-1.5 rounded-lg inline-block">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-kt-gold-400 mr-2 align-middle animate-pulse-gold" />
          Demo ortam · RS256 ile güvenli oturum · Sadece kullanıcı hesabı oluşturulabilir
        </p>
      </div>
    </div>
  );
}
