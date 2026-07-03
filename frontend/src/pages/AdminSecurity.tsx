/**
 * Admin güvenlik ayarları — MFA (TOTP) enroll & disable.
 *
 * Akış:
 *  1. "MFA Kur" → POST /api/admin/mfa/enroll → QR + backup codes göster.
 *  2. Authenticator app'te kod oluştur, formdaki 6-haneli alana gir.
 *  3. POST /api/admin/mfa/verify → enrollment tamamlanır.
 *  4. Disable: gerçek bir TOTP kodu zorunlu (replay koruması).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { api } from '../services/api';
import type { MfaEnrollResult, MfaStatus } from '../types';

export default function AdminSecurity() {
  const toast = useToast();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrollData, setEnrollData] = useState<MfaEnrollResult | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  // Parola değiştirme
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.mfaStatus();
      setStatus(res);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Durum yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function startEnroll() {
    try {
      const res = await api.mfaEnroll();
      setEnrollData(res);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Enroll başarısız.');
    }
  }

  async function verifyEnroll() {
    if (!/^\d{6}$/.test(code)) {
      toast.push('error', '6 haneli kod giriniz.');
      return;
    }
    setVerifying(true);
    try {
      await api.mfaVerify(code);
      toast.push('success', 'MFA aktif edildi.');
      setEnrollData(null);
      setCode('');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Kod doğrulanamadı.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleDisable() {
    if (!/^\d{6}$/.test(disableCode) && !/^[A-Z0-9-]{8,12}$/i.test(disableCode)) {
      toast.push('error', '6 haneli TOTP kodu veya backup kodu giriniz.');
      return;
    }
    setDisabling(true);
    try {
      await api.mfaDisable(disableCode);
      toast.push('info', 'MFA devre dışı bırakıldı.');
      setDisableCode('');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    } finally {
      setDisabling(false);
    }
  }

  const pwChecks = {
    length: newPw.length >= 12,
    upper: /[A-Z]/.test(newPw),
    lower: /[a-z]/.test(newPw),
    digit: /[0-9]/.test(newPw),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPw),
  };
  const pwScore = Object.values(pwChecks).filter(Boolean).length;
  const pwValid =
    pwScore === 5 && currentPw.length > 0 && newPw === newPwConfirm;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (changingPw || !pwValid) return;
    setChangingPw(true);
    try {
      await api.adminChangePassword(currentPw, newPw);
      toast.push('success', 'Parolan güncellendi.');
      setCurrentPw('');
      setNewPw('');
      setNewPwConfirm('');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Parola değiştirilemedi.');
    } finally {
      setChangingPw(false);
    }
  }

  return (
    <AppShell kind="admin">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Güvenlik</h1>
        <p className="text-kt-gray-500 text-sm">
          Parola, çok faktörlü kimlik doğrulama (TOTP) ve oturum güvenliği yönetimi.
        </p>
      </div>

      {loading || !status ? (
        <div className="card p-8 animate-pulse h-48" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* MFA Status Card */}
          <section className="card p-6">
            <div className="flex items-start gap-3 mb-4">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  status.enabled
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-kt-green-900">
                  TOTP — Authenticator
                </h2>
                <p className="text-sm text-kt-gray-600 mt-0.5">
                  {status.enabled
                    ? `Aktif · ${status.backupCodesRemaining} backup kodu kaldı`
                    : 'Henüz aktif değil. Önerilir.'}
                </p>
              </div>
            </div>

            {!status.enabled && !enrollData && (
              <button
                onClick={startEnroll}
                className="btn-primary w-full text-sm"
              >
                MFA'yı Kur
              </button>
            )}

            {enrollData && (
              <div className="space-y-4">
                <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-lg p-3">
                  <strong>1. adım:</strong> Authenticator uygulamanızla QR'ı tarayın.
                </div>
                <div className="flex flex-col items-center gap-3 bg-white rounded-xl border border-kt-gray-100 p-4">
                  <img
                    src={enrollData.qrCodeDataUrl}
                    alt="QR Code"
                    className="w-48 h-48"
                  />
                  <details className="w-full">
                    <summary className="text-xs text-kt-gray-500 cursor-pointer">
                      QR taranamıyor mu? Secret'ı manuel gir.
                    </summary>
                    <code className="block mt-2 p-2 bg-kt-gray-50 rounded text-[11px] break-all">
                      {enrollData.secret}
                    </code>
                  </details>
                </div>
                <div className="text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-lg p-3">
                  <strong>2. adım:</strong> Aşağıdaki backup kodları güvenli bir
                  yerde saklayın. Kaybederseniz hesabınıza erişiminizi kaybedebilirsiniz.
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {enrollData.backupCodes.map((c) => (
                    <code
                      key={c}
                      className="px-2 py-1.5 bg-kt-gray-50 border border-kt-gray-200 rounded text-center text-xs font-mono"
                    >
                      {c}
                    </code>
                  ))}
                </div>
                <div className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg p-3">
                  <strong>3. adım:</strong> Authenticator uygulamasındaki 6 haneli kodu girin.
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    className="input flex-1 tracking-widest text-center font-mono text-lg"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                  <button
                    onClick={verifyEnroll}
                    disabled={verifying || code.length !== 6}
                    className="btn-primary text-sm"
                  >
                    {verifying ? 'Doğrulanıyor…' : 'Doğrula'}
                  </button>
                </div>
              </div>
            )}

            {status.enabled && !enrollData && (
              <div className="space-y-3 mt-4 pt-4 border-t border-kt-gray-100">
                <p className="text-sm text-kt-gray-600">
                  MFA'yı devre dışı bırakmak için mevcut bir TOTP kodu (veya backup kodu) girin:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={12}
                    className="input flex-1 font-mono"
                    placeholder="123456 veya AAAA-BBBB"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                  />
                  <button
                    onClick={handleDisable}
                    disabled={disabling || !disableCode}
                    className="px-4 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-sm hover:bg-rose-100 transition-colors disabled:opacity-50"
                  >
                    {disabling ? '…' : 'Devre dışı bırak'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Security info */}
          <section className="card p-6">
            <h2 className="text-lg font-bold text-kt-green-900 mb-4">Aktif Güvenlik Önlemleri</h2>
            <ul className="space-y-3 text-sm">
              {[
                { ok: true, t: 'RS256 JWT', d: 'Asimetrik imza; her oturum 4096-bit RSA' },
                { ok: true, t: 'HttpOnly Cookie', d: 'Refresh token JS erişimine kapalı' },
                { ok: true, t: 'CSRF Double-Submit', d: 'Cookie + X-CSRF-Token header eşleşmesi' },
                { ok: true, t: 'Refresh Token Reuse Detection', d: 'Eski token tekrar kullanılırsa tüm oturum iptal' },
                { ok: true, t: 'Argon2id Parola Hash', d: 'memoryCost 64MB · timeCost 3' },
                { ok: true, t: 'Brute Force Lockout', d: '5 başarısız deneme → 15 dk kilit' },
                { ok: true, t: 'Audit Log', d: 'Auth, authz, booking, MFA olayları kaydedilir' },
                { ok: status.enabled, t: 'TOTP MFA', d: status.enabled ? 'Aktif' : 'Önerilir — sol panelden aç' },
              ].map((row) => (
                <li key={row.t} className="flex items-start gap-3">
                  <span
                    className={`w-5 h-5 rounded-full mt-0.5 flex items-center justify-center shrink-0 ${
                      row.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                      {row.ok ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 002-2v-9.586a1 1 0 00-.293-.707L13.707 1.293A1 1 0 0013 1H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      )}
                    </svg>
                  </span>
                  <div>
                    <div className="font-semibold text-kt-green-900">{row.t}</div>
                    <div className="text-xs text-kt-gray-500">{row.d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Parola değiştirme */}
          <section className="card p-6">
            <h2 className="text-lg font-bold text-kt-green-900 mb-1">Parolanı Değiştir</h2>
            <p className="text-xs text-kt-gray-500 mb-4">
              Mevcut parolanı doğrulayarak yeni bir parola belirle.
            </p>
            <form onSubmit={handleChangePassword} className="space-y-3" autoComplete="off">
              <div>
                <label htmlFor="cur-pw" className="label">Mevcut parola</label>
                <input
                  id="cur-pw"
                  type="password"
                  className="input"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  autoComplete="current-password"
                  maxLength={128}
                  disabled={changingPw}
                />
              </div>
              <div>
                <label htmlFor="new-pw" className="label">Yeni parola</label>
                <input
                  id="new-pw"
                  type="password"
                  className="input"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  autoComplete="new-password"
                  placeholder="En az 12 karakter, karmaşık"
                  maxLength={128}
                  disabled={changingPw}
                />
                {newPw.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i <= pwScore
                              ? pwScore === 5
                                ? 'bg-kt-green-500'
                                : pwScore >= 3
                                  ? 'bg-kt-gold-400'
                                  : 'bg-red-400'
                              : 'bg-kt-gray-200'
                          }`}
                        />
                      ))}
                    </div>
                    <ul className="text-xs grid grid-cols-2 gap-x-3 gap-y-0.5 text-kt-gray-600">
                      <li className={pwChecks.length ? 'text-kt-green-700' : ''}>
                        {pwChecks.length ? '✓' : '○'} 12+ karakter
                      </li>
                      <li className={pwChecks.upper ? 'text-kt-green-700' : ''}>
                        {pwChecks.upper ? '✓' : '○'} Büyük harf
                      </li>
                      <li className={pwChecks.lower ? 'text-kt-green-700' : ''}>
                        {pwChecks.lower ? '✓' : '○'} Küçük harf
                      </li>
                      <li className={pwChecks.digit ? 'text-kt-green-700' : ''}>
                        {pwChecks.digit ? '✓' : '○'} Rakam
                      </li>
                      <li className={pwChecks.special ? 'text-kt-green-700' : ''}>
                        {pwChecks.special ? '✓' : '○'} Özel karakter
                      </li>
                    </ul>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="new-pw-confirm" className="label">Yeni parola (tekrar)</label>
                <input
                  id="new-pw-confirm"
                  type="password"
                  className="input"
                  value={newPwConfirm}
                  onChange={(e) => setNewPwConfirm(e.target.value)}
                  autoComplete="new-password"
                  maxLength={128}
                  disabled={changingPw}
                />
                {newPwConfirm.length > 0 && newPw !== newPwConfirm && (
                  <p className="text-xs text-red-600 mt-1">Parolalar eşleşmiyor.</p>
                )}
              </div>
              <button type="submit" disabled={changingPw || !pwValid} className="btn-primary">
                {changingPw ? 'Güncelleniyor...' : 'Parolayı Değiştir'}
              </button>
            </form>
          </section>
        </div>
      )}
    </AppShell>
  );
}
