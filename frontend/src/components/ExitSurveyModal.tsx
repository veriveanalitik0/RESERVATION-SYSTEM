/**
 * Çıkış anketi — "Çıkış" butonuna basıldığında açılan 5 soruluk kısa deneyim
 * anketi. Zorunlu DEĞİLDİR: "Atla" ile hiç yanıt göndermeden çıkılabilir.
 *
 * KAPSAM: YALNIZ kind === 'user' (gerçek son-kullanıcı). AppShell bu bileşeni
 * user-dışı kind'lerde hiç render etmez — anket son-kullanıcı deneyimini
 * ölçer; operasyonel roller (admin/danisman/arge/izleyici) anket doldurmaz.
 *
 * Akış (AppShell.finishLogout):
 *   Çıkış'a tıkla → modal → (Gönder | Atla) → api.submitExitSurvey → logout
 * Anket kaydı başarısız olursa bile çıkış TAMAMLANIR — geri bildirim toplamak
 * oturum kapatmayı engellememeli.
 */
import { useState } from 'react';
import type { ExitSurveyAnswers } from '../services/api';

/** 1..5 ölçeğinin uçlarına anlam veren etiketler (sol = 1, sağ = 5). */
interface Question {
  key: keyof Omit<ExitSurveyAnswers, 'comment'>;
  text: string;
  low: string;
  high: string;
}

const QUESTIONS: Question[] = [
  {
    key: 'overall',
    text: 'Bu oturumdaki deneyiminizden genel olarak memnun kaldınız mı?',
    low: 'Hiç memnun değilim',
    high: 'Çok memnunum',
  },
  {
    key: 'workspace',
    text: 'Çalışma alanı ve donanım ihtiyacınızı karşıladı mı?',
    low: 'Karşılamadı',
    high: 'Tamamen karşıladı',
  },
  {
    key: 'bookingEase',
    text: 'Randevu/rezervasyon süreci ne kadar kolaydı?',
    low: 'Çok zordu',
    high: 'Çok kolaydı',
  },
  {
    key: 'support',
    text: 'Destek ve iletişimden memnun kaldınız mı?',
    low: 'Memnun değilim',
    high: 'Çok memnunum',
  },
  {
    key: 'recommend',
    text: 'AI Lab’i bir çalışma arkadaşınıza önerir misiniz?',
    low: 'Kesinlikle hayır',
    high: 'Kesinlikle evet',
  },
];

interface Props {
  open: boolean;
  /** Anket gönderiliyor / çıkış yapılıyor — butonlar kilitlenir. */
  busy?: boolean;
  /** Yanıtlarla gönder. */
  onSubmit: (answers: ExitSurveyAnswers) => void;
  /** Anketi doldurmadan çık. */
  onSkip: () => void;
}

export function ExitSurveyModal({ open, busy, onSubmit, onSkip }: Props) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');

  if (!open) return null;

  const answered = Object.keys(scores).length;

  function handleSubmit() {
    onSubmit({
      overall: scores.overall ?? null,
      workspace: scores.workspace ?? null,
      bookingEase: scores.bookingEase ?? null,
      support: scores.support ?? null,
      recommend: scores.recommend ?? null,
      comment: comment.trim() || null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center px-4 py-6 bg-kt-green-950/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-survey-title"
    >
      <div className="w-full max-w-2xl max-h-full overflow-y-auto rounded-2xl bg-white shadow-kt-card border border-kt-green-100">
        <div className="px-6 pt-6 pb-4 border-b border-kt-green-100">
          <h2 id="exit-survey-title" className="text-xl font-bold text-kt-green-950">
            Ayrılmadan önce — deneyiminiz nasıldı?
          </h2>
          <p className="mt-1.5 text-sm text-kt-green-800/70">
            5 kısa soru, yaklaşık 20 saniye. Yanıtlarınız laboratuvarı geliştirmek için
            kullanılır; istediğiniz soruyu boş bırakabilirsiniz.
          </p>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {QUESTIONS.map((q, i) => (
            <fieldset key={q.key}>
              <legend className="text-sm font-semibold text-kt-green-950 mb-2">
                {i + 1}. {q.text}
              </legend>
              <div className="flex items-center gap-2">
                <span className="hidden sm:block text-[10px] text-kt-green-800/50 w-24 shrink-0 leading-tight">
                  {q.low}
                </span>
                <div className="flex gap-1.5 flex-1 justify-center">
                  {[1, 2, 3, 4, 5].map((v) => {
                    const active = scores[q.key] === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        disabled={busy}
                        aria-pressed={active}
                        aria-label={`${q.text} — ${v} / 5`}
                        onClick={() => setScores((s) => ({ ...s, [q.key]: v }))}
                        className={`w-11 h-10 rounded-xl border text-sm font-bold transition-all disabled:opacity-50 ${
                          active
                            ? 'bg-kt-green-700 border-kt-green-700 text-white shadow-kt-card'
                            : 'bg-white border-kt-green-200 text-kt-green-800 hover:border-kt-green-500 hover:bg-kt-green-50'
                        }`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
                <span className="hidden sm:block text-[10px] text-kt-green-800/50 w-24 shrink-0 text-right leading-tight">
                  {q.high}
                </span>
              </div>
            </fieldset>
          ))}

          <div>
            <label
              htmlFor="exit-survey-comment"
              className="block text-sm font-semibold text-kt-green-950 mb-2"
            >
              Eklemek istediğiniz bir şey var mı? <span className="font-normal text-kt-green-800/50">(opsiyonel)</span>
            </label>
            <textarea
              id="exit-survey-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={busy}
              rows={3}
              maxLength={1000}
              placeholder="Beğendiğiniz veya geliştirilmesini istediğiniz noktalar…"
              className="w-full px-3 py-2 rounded-xl border border-kt-green-200 text-sm text-kt-green-950
                placeholder:text-kt-green-800/40 focus:border-kt-green-500 focus:ring-2 focus:ring-kt-green-500/20
                outline-none resize-y disabled:opacity-50"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-kt-green-100 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-sm font-semibold text-kt-green-800/60 hover:text-kt-green-950 transition-colors disabled:opacity-50"
          >
            Atla ve çık
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || answered === 0}
            title={answered === 0 ? 'En az bir soruyu yanıtlayın veya "Atla ve çık" deyin.' : undefined}
            className="px-5 py-2.5 rounded-xl bg-kt-green-700 hover:bg-kt-green-800 text-white text-sm font-bold
              transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Gönderiliyor…' : 'Gönder ve çık'}
          </button>
        </div>
      </div>
    </div>
  );
}
