/**
 * Onboarding Tour — yeni kullanıcı (veya admin) için 4 adımlık rehber.
 *
 * Tetikleyici: localStorage 'klab:onboarding:<kind>' YOK ise mount sonrası açılır.
 * Atla / Bitir → flag set edilir, bir daha açılmaz.
 *
 * Pure overlay (highlight element'i takip etmiyor; modal-style rehber).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SubjectKind } from '../types';

interface Step {
  emoji: string;
  title: string;
  body: string;
  cta?: { label: string; to: string };
}

const USER_STEPS: Step[] = [
  {
    emoji: '🤝',
    title: 'Hoş geldin!',
    body: 'AI Lab Randevu Sistemi\'ne ilk girişin. Bu kısa tur seni 6 adımda yönlendirecek. İstersen "Atla" diyebilirsin.',
  },
  {
    emoji: '🏛️',
    title: '10 AI Lab Odası',
    body: 'Müsait odaları gez, projenin detaylarını yaz, randevu al. Admin onayından sonra oda senin. Dolu odalar için "Sıraya gir" ile bekleme listesine kaydolabilirsin.',
    cta: { label: 'Odaları gör', to: '/rooms' },
  },
  {
    emoji: '💳',
    title: 'Yazılım Lisansları',
    body: 'Cursor, Claude, Copilot gibi yapay zeka araçları için lisans talep edebilirsin. Listede olmayan araçlar için "Diğer" seçeneği var. Admin onayından sonra IT ekibi sana lisansı atar.',
    cta: { label: 'Lisanslarım', to: '/licenses' },
  },
  {
    emoji: '🎨',
    title: 'Envanter & Topluluk',
    body: 'Onaylanan projelerini "Envanter"e ekle, başkalarının projelerini beğen, yorum yap. Public profilin hazır — kendi sayfanı paylaşabilirsin.',
    cta: { label: 'Envanteri gör', to: '/showcase' },
  },
  {
    emoji: '❓',
    title: 'Yardım Merkezi',
    body: 'Sıkça sorulan sorular hep elinin altında. Randevu, lisans, bekleme listesi veya hesap işlemleri için adım adım rehber.',
    cta: { label: 'SSS\'e git', to: '/yardim' },
  },
];

const ADMIN_STEPS: Step[] = [
  {
    emoji: '🛡️',
    title: 'Yönetim paneline hoş geldin',
    body: 'Tüm bookings, kullanıcılar, lisans ve güvenlik araçları artık burada. Hızlı tur için sayfaları gezelim.',
  },
  {
    emoji: '📋',
    title: 'Talepler ve Takvim',
    body: 'Bekleyen talepleri onayla / reddet / düzeltme iste. Takvim sekmesinde aylık görünümle çakışmaları takip et.',
    cta: { label: 'Talepleri aç', to: '/admin' },
  },
  {
    emoji: '💳',
    title: 'Lisanslar — talepler & analiz',
    body: 'Üç sekme: "Talepler" (kullanıcıların lisans isteklerini onayla/reddet/revize iste), "Yazılım Analizi" (Cursor, Claude vb. aylık maliyet), "Kullanıcı Analizi" (kim hangi lisansı kullanıyor).',
    cta: { label: 'Lisansları aç', to: '/admin/licenses' },
  },
  {
    emoji: '🔐',
    title: 'Güvenlik & Audit',
    body: 'MFA, audit log, KVKK ihracı — hepsi panelde. Her aksiyon kayıt altında.',
    cta: { label: 'Güvenlik ayarları', to: '/admin/security' },
  },
];

interface Props {
  kind: SubjectKind;
}

// v2: lisans talep + yardım step'leri eklendi — eski user'lar yeni tour'u görsün
const STORAGE_KEY = (k: SubjectKind) => `klab:onboarding:${k}:done:v2`;

export function OnboardingTour({ kind }: Props) {
  const steps = kind === 'admin' ? ADMIN_STEPS : USER_STEPS;
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  // Mount sonrası: localStorage check
  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY(kind));
    if (!done) {
      // Geçişler için biraz gecikme
      const t = window.setTimeout(() => setOpen(true), 800);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [kind]);

  function finish() {
    // "Bunu bir daha gösterme" işaretliyse kalıcı kapat (localStorage); işaret
    // kaldırılmışsa yalnız bu oturumu kapat → sonraki girişte tur tekrar görünür.
    if (dontShowAgain) localStorage.setItem(STORAGE_KEY(kind), '1');
    setOpen(false);
  }

  // ESC ile atla
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-w-md w-full bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-kt-gold-400/30">
        {/* Decorative glow */}
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-kt-gold-400/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-kt-violet-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative p-7">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step
                      ? 'w-8 bg-gradient-to-r from-kt-gold-400 to-kt-gold-600'
                      : i < step
                      ? 'w-6 bg-kt-gold-200'
                      : 'w-3 bg-kt-gray-200'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={finish}
              className="text-xs font-semibold text-kt-gray-500 hover:text-kt-gold-700"
            >
              Atla
            </button>
          </div>

          <div className="text-5xl mb-3 text-center">{current.emoji}</div>
          <h3 className="text-xl font-extrabold text-kt-green-900 text-center mb-2">
            {current.title}
          </h3>
          <p className="text-sm text-kt-gray-600 leading-relaxed text-center mb-6">
            {current.body}
          </p>

          {current.cta && (
            <div className="text-center mb-4">
              <Link
                to={current.cta.to}
                onClick={finish}
                className="inline-flex items-center gap-1.5 text-kt-gold-700 hover:text-kt-gold-800 font-semibold text-sm"
              >
                {current.cta.label} →
              </Link>
            </div>
          )}

          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-kt-gray-600 hover:bg-kt-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Önceki
            </button>
            <span className="text-[11px] text-kt-gray-400 font-semibold">
              {step + 1} / {steps.length}
            </span>
            {isLast ? (
              <button onClick={finish} className="btn-primary text-sm">
                Başlayalım!
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                className="btn-primary text-sm"
              >
                Sonraki
              </button>
            )}
          </div>

          {/* Kalıcı kapatma seçeneği — işaretliyse "Atla/Başlayalım" sonrası bir daha açılmaz. */}
          <label className="flex items-center justify-center gap-2 mt-5 text-xs text-kt-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-kt-gray-300 text-kt-green-600 focus:ring-2 focus:ring-kt-green-500/40"
            />
            Bunu bir daha gösterme
          </label>
        </div>
      </div>
    </div>
  );
}
