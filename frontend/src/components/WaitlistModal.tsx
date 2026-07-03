/**
 * Waitlist modal — dolu bir oda için sıraya yazılma formu.
 *
 * BookingModal'a benzer ama:
 *  - Tarih = "istenen başlangıç tarihi" (oda boşalınca otomatik booking'in başlangıcı)
 *  - Endpoint farklı (/user/waitlist)
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JoinWaitlistPayload, Room } from '../types';
import { openDatePicker, periodEndDate, PERIOD_LABEL, PERIOD_OPTIONS, ymdLocal, type BookingPeriodKey } from '../lib/utils';
import { FEATURES } from '../constants/features';

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const TECH_OPTIONS = [
  'Claude', 'GPT', 'Gemini', 'OpenAI', 'LangChain', 'LlamaIndex',
  'React', 'Next.js', 'Vue', 'Node.js', 'Python', 'TypeScript',
  'Postgres', 'SQLite', 'Redis', 'Docker', 'Kubernetes',
];

const todayISO = () => ymdLocal();

interface Props {
  room: Room | null;
  open: boolean;
  loading: boolean;
  /** Odalar tarih filtresi aktifse istenen başlangıç tarihini önceden doldur. */
  initialStartDate?: string;
  onClose: () => void;
  onSubmit: (payload: JoinWaitlistPayload) => void | Promise<void>;
}

export function WaitlistModal({ room, open, loading, initialStartDate, onClose, onSubmit }: Props) {
  const [period, setPeriod] = useState<BookingPeriodKey>('1w');
  const [desiredStartDate, setDesiredStartDate] = useState<string>(todayISO());
  // Boş = periyottan türetilen bitiş. Doldurulursa kullanıcının manuel (kısa) bitişi.
  const [desiredEndDate, setDesiredEndDate] = useState<string>('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [helpNeeded, setHelpNeeded] = useState('');
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]); // varsayılan: hafta içi
  const [customTech, setCustomTech] = useState('');

  useEffect(() => {
    if (open) {
      setPeriod('1w');
      setDesiredStartDate(initialStartDate && initialStartDate >= todayISO() ? initialStartDate : todayISO());
      setDesiredEndDate('');
      setProjectName('');
      setProjectDescription('');
      setHelpNeeded('');
      setTechnologies([]);
      setWeekdays([1, 2, 3, 4, 5]);
      setCustomTech('');
    }
  }, [open, initialStartDate]);

  if (!open || !room) return null;

  const toggleTech = (t: string) => {
    setTechnologies((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };
  const toggleWeekday = (d: number) => {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };
  const addCustom = () => {
    const t = customTech.trim();
    if (t && !technologies.includes(t) && technologies.length < 20) {
      setTechnologies([...technologies, t]);
    }
    setCustomTech('');
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!room) return;
    if (FEATURES.weekdaySelection && weekdays.length === 0) return;
    // Manuel bitiş yalnız [start, periyot-türevi) aralığındaysa gönderilir;
    // boş veya tam periyot sonuysa undefined → server periyottan türetir.
    const periodEnd = periodEndDate(desiredStartDate, period);
    const manualEnd =
      desiredEndDate && desiredEndDate >= desiredStartDate && desiredEndDate < periodEnd
        ? desiredEndDate
        : undefined;
    onSubmit({
      roomId: room.id,
      period,
      desiredStartDate,
      desiredEndDate: manualEnd,
      projectName: projectName.trim(),
      projectDescription: projectDescription.trim(),
      helpNeeded: helpNeeded.trim(),
      technologies,
      weekdays: FEATURES.weekdaySelection ? [...weekdays].sort((a, b) => a - b) : undefined,
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <div
        className="bg-white rounded-2xl shadow-kt-card max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-white border-b border-kt-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-kt-gold-700 font-bold">
              Bekleme listesi · {room.code}
            </div>
            <h2 className="text-xl font-extrabold text-kt-green-900">
              {room.district} · {room.neighborhood}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-kt-gray-100 text-kt-gray-500"
            aria-label="Kapat"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-kt-gray-500">
            <span className="text-red-500">*</span> işaretli alanlar zorunludur.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            Bu oda şu an dolu. Sıraya yazıldığınızda, oda boşalır boşalmaz
            otomatik randevu talebi oluşturulur ve sizi bilgilendiririz.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Periyot<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
              <div className="flex gap-2">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setPeriod(opt.key)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      period === opt.key
                        ? 'bg-kt-green-700 text-white border-kt-green-700'
                        : 'bg-white text-kt-green-800 border-kt-gray-200 hover:border-kt-green-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">İstenen başlangıç tarihi<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
              <input
                type="date"
                className="input cursor-pointer"
                value={desiredStartDate}
                min={todayISO()}
                onChange={(e) => setDesiredStartDate(e.target.value)}
                onClick={openDatePicker}
                required
              />
            </div>
          </div>

          {/* Bitiş tarihi — periyottan türetilir; istersen daha kısa seç. */}
          <div>
            <label className="label">Bitiş tarihi <span className="text-kt-gray-400 font-normal">(istersen daha kısa seç)</span></label>
            <input
              type="date"
              className="input cursor-pointer"
              value={desiredEndDate || (desiredStartDate ? periodEndDate(desiredStartDate, period) : '')}
              min={desiredStartDate || undefined}
              max={desiredStartDate ? periodEndDate(desiredStartDate, period) : undefined}
              onChange={(e) => setDesiredEndDate(e.target.value)}
              onClick={openDatePicker}
            />
            <p className="text-[11px] text-kt-gray-500 mt-1">
              {desiredStartDate
                ? `Sıranız geldiğinde oda ${new Date(desiredStartDate).toLocaleDateString('tr-TR')} – ${new Date(desiredEndDate || periodEndDate(desiredStartDate, period)).toLocaleDateString('tr-TR')} için rezerve edilir. En geç ${new Date(periodEndDate(desiredStartDate, period)).toLocaleDateString('tr-TR')} (${PERIOD_LABEL[period]}).`
                : 'Başlangıç tarihi seçin.'}
            </p>
          </div>

          {/* Oda müsaitlik bilgisi — tahmini boşalma + boş günler */}
          <div className="rounded-lg bg-kt-gray-50 border border-kt-gray-200 p-3 space-y-2">
            <div className="text-xs font-semibold text-kt-gray-600">Oda müsaitlik durumu</div>
            {room.nextAvailableDate ? (
              <div className="text-xs text-kt-gray-700">
                Tahmini boşalma:{' '}
                <span className="font-semibold text-kt-green-800">
                  {new Date(room.nextAvailableDate).toLocaleDateString('tr-TR')}
                </span>
              </div>
            ) : (
              <div className="text-xs text-kt-gray-700">
                Bu oda kısmen dolu — seçtiğiniz günlere göre sıraya alınırsınız.
              </div>
            )}
            {FEATURES.weekdaySelection && (
              <div>
                <div className="text-[10px] text-kt-gray-400 mb-1">Boş günler</div>
                <div className="grid grid-cols-7 gap-0.5">
                  {WEEKDAY_LABELS.map((l, i) => {
                    const free = (room.availableWeekdays ?? []).includes(i + 1);
                    return (
                      <div
                        key={i}
                        className={`py-1 rounded text-[10px] font-bold text-center ${
                          free
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-kt-gray-100 text-kt-gray-300 line-through'
                        }`}
                      >
                        {l}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {FEATURES.weekdaySelection && (
          <div>
            <label className="label">
              Hangi günler?<span className="text-red-500 ml-0.5" aria-hidden="true">*</span> <span className="text-kt-gray-400 font-normal">(periyot boyunca)</span>
            </label>
            <div className="grid grid-cols-7 gap-1.5">
              {[
                { d: 1, l: 'Pzt' },
                { d: 2, l: 'Sal' },
                { d: 3, l: 'Çar' },
                { d: 4, l: 'Per' },
                { d: 5, l: 'Cum' },
                { d: 6, l: 'Cmt' },
                { d: 7, l: 'Paz' },
              ].map(({ d, l }) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => toggleWeekday(d)}
                  className={`py-2 rounded-lg text-xs font-bold transition-all ${
                    weekdays.includes(d)
                      ? 'bg-kt-gold-500 text-white shadow-kt-gold'
                      : 'bg-kt-gray-100 text-kt-green-700 hover:bg-kt-gray-200'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-kt-gray-500 mt-1.5">
              Sıranız geldiğinde oda yalnızca seçtiğiniz günler için rezerve edilir.
            </p>
            {weekdays.length === 0 && (
              <p className="text-xs text-red-600 mt-1">En az bir gün seçin.</p>
            )}
          </div>
          )}

          <div>
            <label className="label">Proje adı<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
            <input
              type="text"
              className="input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              maxLength={120}
              required
              placeholder="örn: AI Destekli Bütçe Asistanı"
            />
          </div>

          <div>
            <label className="label">Proje açıklaması<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
            <textarea
              className="input min-h-[100px]"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              maxLength={2000}
              minLength={20}
              required
              placeholder="Projeyi ve hedeflerinizi kısaca anlatın..."
            />
            <div className="text-[10px] text-kt-gray-400 mt-1 text-right">
              {projectDescription.length} / 2000
            </div>
          </div>

          <div>
            <label className="label">Hangi konularda desteğe ihtiyacınız var?<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
            <textarea
              className="input min-h-[80px]"
              value={helpNeeded}
              onChange={(e) => setHelpNeeded(e.target.value)}
              maxLength={2000}
              minLength={10}
              required
              placeholder="Mentor, donanım, lisans, vs."
            />
          </div>

          <div>
            <label className="label">Teknolojiler<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {TECH_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTech(t)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
                    technologies.includes(t)
                      ? 'bg-kt-green-700 text-white border-kt-green-700'
                      : 'bg-white text-kt-green-700 border-kt-gray-200 hover:border-kt-green-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1"
                placeholder="Farklı bir teknoloji ekleyin..."
                value={customTech}
                onChange={(e) => setCustomTech(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                maxLength={40}
              />
              <button
                type="button"
                onClick={addCustom}
                className="btn-secondary text-sm"
              >
                Ekle
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-ghost text-sm"
              disabled={loading}
            >
              Vazgeç
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary text-sm"
              disabled={loading || technologies.length === 0}
            >
              {loading ? 'Sıraya yazılıyor…' : 'Sıraya gir'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
