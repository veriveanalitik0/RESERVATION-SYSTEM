import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { clearCsrfCache } from '../services/api';

/**
 * Parola sıfırlama talep sayfası.
 * Güvenlik: backend kullanıcı varlığını ifşa etmez — e-posta kayıtlı olsun
 * olmasın aynı (başarılı) mesaj gösterilir.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    clearCsrfCache();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setDone(true);
    } catch (err) {
      setError((err as Error).message || 'Bir sorun oluştu, tekrar dene.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-kt-green-950">
      {/* ========== ARKAPLAN — Giriş ekranı ile aynı ========== */}
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

      <header className="relative z-10 px-6 md:px-10 py-6 flex items-center justify-between">
        <Link to="/" aria-label="Ana sayfa" className="relative inline-block group">
          <div className="absolute inset-0 -m-8 bg-kt-gold-400/25 rounded-full blur-[60px] animate-glow-pulse pointer-events-none" />
          <div className="absolute inset-0 -m-4 bg-kt-green-600/30 rounded-full blur-[36px] pointer-events-none" />
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
          to="/login"
          className="text-sm font-semibold text-white/80 hover:text-kt-gold-300 transition-colors backdrop-blur-sm bg-black/20 px-3 py-1.5 rounded-lg border border-white/10"
        >
          ← Girişe dön
        </Link>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-md animate-slide-up">
          <div className="rounded-2xl p-8 bg-white/95 backdrop-blur-md shadow-2xl border border-white/40">
            <div className="mb-6">
              <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1.5">
                Parolanı mı unuttun?
              </h1>
              <p className="text-sm text-kt-gray-500">
                E-posta adresini gir — kayıtlıysa sıfırlama bağlantısı gönderelim.
              </p>
            </div>

            {done ? (
              <div className="space-y-4">
                <div className="px-4 py-3 rounded-xl bg-kt-green-50 border border-kt-green-200 text-sm text-kt-green-900">
                  E-posta adresin kayıtlıysa, parola sıfırlama bağlantısı gönderildi.
                  Gelen kutunu (ve spam klasörünü) kontrol et. Bağlantı 1 saat geçerli.
                </div>
                <Link to="/login" className="btn-primary w-full block text-center">
                  Girişe dön
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
                <div>
                  <label htmlFor="email" className="label">
                    E-posta
                  </label>
                  <input
                    id="email"
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="ornek@klab.test"
                    maxLength={254}
                    disabled={loading}
                  />
                </div>

                {error && <p className="text-xs text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || email.trim().length < 5}
                  className="btn-primary w-full"
                >
                  {loading ? 'Gönderiliyor...' : 'Sıfırlama bağlantısı gönder'}
                </button>
              </form>
            )}

            <div className="mt-6 pt-6 border-t border-kt-gray-100 text-center">
              <p className="text-sm text-kt-gray-600">
                Parolanı hatırladın mı?{' '}
                <Link to="/login" className="font-semibold text-kt-green-700 hover:text-kt-gold-600">
                  Giriş yap →
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
