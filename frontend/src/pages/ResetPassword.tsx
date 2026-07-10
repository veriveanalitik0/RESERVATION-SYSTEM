import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, clearCsrfCache } from '../services/api';
import { useToast } from '../components/Toast';
import { AuthBackground } from '../components/AuthBackground';
import { AuthHeader } from '../components/AuthHeader';

/**
 * Parola sıfırlama sayfası — e-posta linkindeki ?token= ile gelir.
 * Backend §4 parola politikasını uygular; UI'da canlı güç göstergesi var.
 */
export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    clearCsrfCache();
  }, []);

  const checks = {
    length: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const allValid = score === 5;
  const matches = password.length > 0 && password === passwordConfirm;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError('');
    if (!allValid) {
      setError('Parola tüm kriterleri karşılamalı.');
      return;
    }
    if (!matches) {
      setError('Parolalar eşleşmiyor.');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password, passwordConfirm);
      toast.push('success', 'Parolan güncellendi. Yeni parolanla giriş yapabilirsin.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError((err as Error).message || 'Sıfırlama başarısız.');
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
              <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1.5">Yeni parola belirle</h1>
              <p className="text-sm text-kt-gray-500">
                Güçlü bir parola seç — en az 12 karakter ve karmaşık.
              </p>
            </div>

            {!token ? (
              <div className="space-y-4">
                <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
                  Geçersiz veya eksik sıfırlama bağlantısı. Lütfen e-postandaki bağlantıyı
                  yeniden kullan ya da yeni bir talep oluştur.
                </div>
                <Link to="/forgot-password" className="btn-primary w-full block text-center">
                  Yeni bağlantı iste
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
                <div>
                  <label htmlFor="password" className="label">
                    Yeni parola
                  </label>
                  <input
                    id="password"
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="En az 12 karakter, karmaşık"
                    maxLength={128}
                    disabled={loading}
                  />
                  {password.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              i <= score
                                ? score === 5
                                  ? 'bg-kt-green-500'
                                  : score >= 3
                                    ? 'bg-kt-gold-400'
                                    : 'bg-red-400'
                                : 'bg-kt-gray-200'
                            }`}
                          />
                        ))}
                      </div>
                      <ul className="text-xs space-y-0.5 text-kt-gray-600">
                        <li className={checks.length ? 'text-kt-green-700' : ''}>
                          {checks.length ? '✓' : '○'} En az 12 karakter
                        </li>
                        <li className={checks.upper ? 'text-kt-green-700' : ''}>
                          {checks.upper ? '✓' : '○'} Büyük harf
                        </li>
                        <li className={checks.lower ? 'text-kt-green-700' : ''}>
                          {checks.lower ? '✓' : '○'} Küçük harf
                        </li>
                        <li className={checks.digit ? 'text-kt-green-700' : ''}>
                          {checks.digit ? '✓' : '○'} Rakam
                        </li>
                        <li className={checks.special ? 'text-kt-green-700' : ''}>
                          {checks.special ? '✓' : '○'} Özel karakter (!@#$ vb.)
                        </li>
                      </ul>
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="passwordConfirm" className="label">
                    Yeni parola (tekrar)
                  </label>
                  <input
                    id="passwordConfirm"
                    type="password"
                    className="input"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    maxLength={128}
                    disabled={loading}
                  />
                  {passwordConfirm.length > 0 && !matches && (
                    <p className="text-xs text-red-600 mt-1">Parolalar eşleşmiyor.</p>
                  )}
                </div>

                {error && <p className="text-xs text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !allValid || !matches}
                  className="btn-primary w-full"
                >
                  {loading ? 'Güncelleniyor...' : 'Parolayı güncelle'}
                </button>
              </form>
            )}

            <div className="mt-6 pt-6 border-t border-kt-gray-100 text-center">
              <p className="text-sm text-kt-gray-600">
                <Link to="/login" className="font-semibold text-kt-green-700 hover:text-kt-gold-600">
                  Giriş sayfasına dön →
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
