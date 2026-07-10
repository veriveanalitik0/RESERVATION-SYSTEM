import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { clearCsrfCache } from '../services/api';
import { AuthBackground } from '../components/AuthBackground';
import { AuthHeader } from '../components/AuthHeader';

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
      {/* Arkaplan (Giriş ekranı ile aynı) + üst header — ortak auth bileşenleri */}
      <AuthBackground />
      <AuthHeader backTo="/login" backLabel="← Girişe dön" variant="inline" />

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
