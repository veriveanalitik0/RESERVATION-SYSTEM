import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { api, clearCsrfCache } from '../services/api';
import { ymdLocal } from '../lib/utils';
import LoginPage from '@/components/ui/gaming-login';
import { ConsentCard } from '../components/ConsentCard';
import { AuthBackground } from '../components/AuthBackground';
import { AuthHeader } from '../components/AuthHeader';
import type { AuthUser, SubjectKind } from '../types';

/**
 * Tek giriş ekranı. Backend hem admins hem users tablosunu kontrol eder.
 * Login başarılıysa response.type ('user' | 'admin') dönüşüne göre yönlendirme yapılır.
 *
 * Görsel: Landing hero ile ortak arkaplan (/ai-lab-bg.jpg + ken-burns + AI mesh
 * orb'ları) + gaming-login style glass dark form card.
 */
export default function Login() {
  const { login, completeMfaLogin, logout, markConsentAccepted } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  // MFA ikinci adımı: backend pending token döndüyse TOTP kodu istenir.
  const [mfaPendingToken, setMfaPendingToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  // EK-1 beyanı adımı: user-tabanlı hesap henüz onaylamadıysa (bir kereye mahsus)
  // form yerine onay kartı gösterilir; onaylanmadan yönlendirme yapılmaz.
  const [consentPending, setConsentPending] = useState<{
    kind: SubjectKind;
    subject: AuthUser;
  } | null>(null);

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
      // EK-1 beyanı henüz onaylanmamış user-tabanlı hesap: yönlendirme yerine
      // onay kartı adımı (admin'ler kapsam dışı — consentAcceptedAt undefined).
      if (result.kind !== 'admin' && result.subject.consentAcceptedAt === null) {
        setConsentPending({ kind: result.kind, subject: result.subject });
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

  async function handleConsentAccept() {
    if (loading || !consentPending) return;
    setLoading(true);
    try {
      const res = await api.acceptConsent(consentPending.kind);
      markConsentAccepted(consentPending.kind, res.consentAcceptedAt);
      const { kind, subject } = consentPending;
      setConsentPending(null);
      await redirectAfterLogin(kind, subject);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Beyan onayı kaydedilemedi.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConsentDecline() {
    if (loading || !consentPending) return;
    setLoading(true);
    try {
      await logout(consentPending.kind);
    } catch {
      // Ağ/5xx durumunda logout isteği düşebilir — yerel oturum temizliği
      // logout() içindeki finally'de zaten yapıldı; hata yutulur (aksi halde
      // async onClick'ten unhandled rejection kaçar).
    } finally {
      setConsentPending(null);
      setLoading(false);
      toast.push('info', 'EK-1 beyanı onaylanmadan laboratuvar sistemine giriş yapılamaz.');
    }
  }

  function fillDemo(which: 'user' | 'admin' | 'danisman' | 'arge' | 'izleyici' | 'ayberk' | 'furkan' | 'fatih') {
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
    } else if (which === 'ayberk') {
      setEmail('ayberk.yardimci@klab.test');
      setPassword('Ayberk1234!Pass');
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
      {/* Arkaplan (Landing hero ile aynı) + üst header — ortak auth bileşenleri */}
      <AuthBackground greenOrb />
      <AuthHeader backTo="/" backLabel="← Ana sayfa" variant="overlay" />

      {/* Merkez: glass form card (veya MFA doğrulama / EK-1 beyan adımı) */}
      <div
        className={`relative z-20 w-full animate-fade-in ${
          consentPending ? 'max-w-2xl' : 'max-w-md'
        }`}
      >
        {consentPending ? (
          <ConsentCard
            fullName={consentPending.subject.fullName}
            loading={loading}
            onAccept={handleConsentAccept}
            onDecline={handleConsentDecline}
          />
        ) : mfaPendingToken ? (
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
