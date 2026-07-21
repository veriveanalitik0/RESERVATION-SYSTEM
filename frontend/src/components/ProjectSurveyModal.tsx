/**
 * Proje sonu anketi — kullanıcının laboratuvarda yürüttüğü projeye dair 3
 * serbest metin sorusu. Zorunlu DEĞİLDİR: "Atla ve çık" ile hiç yanıt
 * göndermeden çıkılabilir; her alan tek tek de boş bırakılabilir.
 *
 * KAPSAM: YALNIZ kind === 'user' (gerçek son-kullanıcı). AppShell bu bileşeni
 * user-dışı kind'lerde hiç render etmez — anket son-kullanıcının proje
 * çıktısını ve lab geri bildirimini toplar; operasyonel roller
 * (admin/danisman/arge/izleyici) anket doldurmaz.
 *
 * GEÇİCİ TETİKLEME NOTU: Şimdilik HER user çıkışında, deneyim anketinin
 * (ExitSurveyModal) hemen ardından gösterilir. Proje tamamlanma akışı
 * geldiğinde tetikleyici oraya taşınacak — bu bileşenin arayüzü (props
 * sözleşmesi) DEĞİŞMEDEN yalnız tetikleyen yer değişecek.
 *
 * Akış (AppShell çıkış zinciri, yalnız user):
 *   Çıkış → ExitSurveyModal → (gönder|atla) → bu modal → (Gönder | Atla)
 *   → api.submitProjectSurvey → logout
 * Anket kaydı başarısız olursa bile çıkış TAMAMLANIR — geri bildirim toplamak
 * oturum kapatmayı engellememeli.
 */
import { useState } from 'react';
import type { ProjectSurveyAnswers } from '../services/api';

/** Serbest metin soruları — key doğrudan API alan adıdır. */
interface Question {
  key: keyof ProjectSurveyAnswers;
  text: string;
  placeholder: string;
}

const QUESTIONS: Question[] = [
  {
    key: 'projectWork',
    text: 'Projenizde neler yaptınız? Süreç nasıl geçti, hangi sonuçları elde ettiniz?',
    placeholder: 'Projenizin konusu, laboratuvarda yürüttüğünüz çalışmalar ve ulaştığınız sonuçlar…',
  },
  {
    key: 'labFeedback',
    text: 'Laboratuvardan memnun kaldınız mı? Size yeterince yardımcı olabildik mi?',
    placeholder: 'Donanım, çalışma ortamı ve ekip desteğiyle ilgili geri bildiriminiz…',
  },
  {
    key: 'improvement',
    text: 'Laboratuvarı ve süreçleri daha iyi hale getirmek için önerileriniz neler?',
    placeholder: 'Eksik gördüğünüz donanım, yazılım, süreç ya da destek…',
  },
];

interface Props {
  open: boolean;
  /** Anket gönderiliyor / çıkış yapılıyor — butonlar kilitlenir. */
  busy?: boolean;
  /** Yanıtlarla gönder (yalnız dolu alanlar iletilir). */
  onSubmit: (answers: ProjectSurveyAnswers) => void;
  /** Anketi doldurmadan çık. */
  onSkip: () => void;
}

export function ProjectSurveyModal({ open, busy, onSubmit, onSkip }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  if (!open) return null;

  // Trim sonrası dolu alan sayısı — hepsi boşken "Gönder" anlamsız (backend de
  // kayıt yazmaz), ExitSurveyModal'daki gibi buton kilitlenir.
  const answered = QUESTIONS.filter((q) => (values[q.key] ?? '').trim().length > 0).length;

  function handleSubmit() {
    // Yalnız dolu alanları gönder — API sözleşmesinde her alan opsiyonel.
    const answers: ProjectSurveyAnswers = {};
    for (const q of QUESTIONS) {
      const v = (values[q.key] ?? '').trim();
      if (v) answers[q.key] = v;
    }
    onSubmit(answers);
  }

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center px-4 py-6 bg-kt-green-950/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-survey-title"
    >
      <div className="w-full max-w-2xl max-h-full overflow-y-auto rounded-2xl bg-white shadow-kt-card border border-kt-green-100">
        <div className="px-6 pt-6 pb-4 border-b border-kt-green-100">
          <h2 id="project-survey-title" className="text-xl font-bold text-kt-green-950">
            Proje Sonu Anketi
          </h2>
          <p className="mt-1.5 text-sm text-kt-green-800/70">
            Ayrılmadan önce projenizden kısaca bahseder misiniz? Yanıtlarınız laboratuvarı
            geliştirmemize doğrudan katkı sağlıyor.
          </p>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {QUESTIONS.map((q, i) => (
            <div key={q.key}>
              <label
                htmlFor={`project-survey-${q.key}`}
                className="block text-sm font-semibold text-kt-green-950 mb-2"
              >
                {i + 1}. {q.text}{' '}
                <span className="font-normal text-kt-green-800/50">(opsiyonel)</span>
              </label>
              <textarea
                id={`project-survey-${q.key}`}
                value={values[q.key] ?? ''}
                onChange={(e) => setValues((s) => ({ ...s, [q.key]: e.target.value }))}
                disabled={busy}
                rows={4}
                maxLength={4000}
                placeholder={q.placeholder}
                className="w-full px-3 py-2 rounded-xl border border-kt-green-200 text-sm text-kt-green-950
                  placeholder:text-kt-green-800/40 focus:border-kt-green-500 focus:ring-2 focus:ring-kt-green-500/20
                  outline-none resize-y disabled:opacity-50"
              />
            </div>
          ))}
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
            title={answered === 0 ? 'En az bir alanı doldurun veya "Atla ve çık" deyin.' : undefined}
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
