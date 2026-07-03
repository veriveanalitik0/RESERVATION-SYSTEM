import { useEffect, useMemo, useState } from 'react';
import type { Booking, CreateBookingPayload, Room, RoomAvailability } from '../types';
import { openDatePicker, periodEndDate, PERIOD_OPTIONS, ymdLocal, type BookingPeriodKey } from '../lib/utils';
import { FEATURES } from '../constants/features';
import { api } from '../services/api';
import { MovableModalShell } from './MovableModalShell';

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function fmtTrDate(ymd: string): string {
  if (!ymd) return '';
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** YYYY-MM-DD aralıkları örtüşüyor mu (leksik karşılaştırma güvenli). */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return !(aEnd < bStart || aStart > bEnd);
}

/** YYYY-MM-DD → ertesi gün (en erken müsait tarih gösterimi). */
function nextDayYmd(ymd: string): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

interface BookingModalProps {
  room: Room | null;
  open: boolean;
  loading: boolean;
  /** Düzenleme modu için varsa, mevcut booking verisi. Yoksa create modu. */
  editingBooking?: Booking | null;
  /** Oluşturma modunda başlangıç tarihini önceden doldur (odalar tarih filtresi). */
  initialStartDate?: string;
  onClose: () => void;
  onSubmit: (payload: CreateBookingPayload) => Promise<void>;
}

/**
 * Vibe coding / AI Lab projeleri için araç ve teknoloji önerileri.
 * Öncelik AI/vibe coding araçlarında, sonra dil ve framework'ler.
 */
const TECH_GROUPS: { label: string; items: string[] }[] = [
  {
    label: 'AI Kodlama Araçları',
    items: [
      'Claude Code',
      'Cursor',
      'Google Antigravity',
      'GitHub Copilot',
      'Windsurf',
      'Replit Agent',
      'Devin',
      'Bolt.new',
      'Lovable',
      'v0 by Vercel',
      'Aider',
      'Continue',
      'Codeium',
      'Tabnine',
      'Zed AI',
      'JetBrains AI',
    ],
  },
  {
    label: 'LLM / API',
    items: [
      'Anthropic Claude',
      'OpenAI GPT',
      'Google Gemini',
      'Mistral',
      'Llama',
      'DeepSeek',
      'LangChain',
      'LlamaIndex',
      'Anthropic MCP',
    ],
  },
  {
    label: 'Framework / Dil',
    items: [
      'React', 'Next.js', 'Vue', 'Svelte',
      'Node.js', 'TypeScript', 'Python', 'Go',
      'Tailwind CSS', 'FastAPI',
    ],
  },
  {
    label: 'Altyapı',
    items: [
      'PostgreSQL', 'MongoDB', 'Redis', 'SQLite',
      'Docker', 'Vercel', 'AWS', 'GCP', 'Cloudflare',
    ],
  },
];

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymdLocal(d);
}

export function BookingModal({ room, open, loading, editingBooking, initialStartDate, onClose, onSubmit }: BookingModalProps) {
  const isEditing = !!editingBooking;
  const [period, setPeriod] = useState<BookingPeriodKey>('1w');
  const [startDate, setStartDate] = useState(todayPlus(1));
  // Boş = periyottan türetilen bitiş. Doldurulursa esnek/kısa süre (manuel bitiş).
  const [endDate, setEndDate] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [helpNeeded, setHelpNeeded] = useState('');
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]); // varsayılan: hafta içi
  const [customTech, setCustomTech] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<RoomAvailability | null>(null);

  // Oda müsaitliğini aç-fetch et — dolu tarih aralıklarını göster + çakışma ön-kontrolü.
  useEffect(() => {
    if (!open || !room) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setAvailability(null);
    api
      .roomAvailability(room.id)
      .then((res) => {
        if (!cancelled) setAvailability(res);
      })
      .catch(() => {
        /* best-effort — müsaitlik çekilemezse modal yine çalışır */
      });
    return () => {
      cancelled = true;
    };
  }, [open, room]);

  // Seçilen aralık mevcut bir booking ile çakışıyor mu? (gönderme öncesi uyarı)
  // Manuel bitiş varsa o, yoksa periyottan türetilen tarih.
  const selectedEnd = endDate || (startDate ? periodEndDate(startDate, period) : '');
  const conflict = useMemo(() => {
    if (!availability || !startDate || !selectedEnd) return null;
    return (
      availability.busyRanges.find((b) => {
        if (!rangesOverlap(startDate, selectedEnd, b.startDate, b.endDate)) return false;
        // Full-week modda gün ayrımı yok (her tarih çakışması blokedir); gün-bazlı
        // modda yalnız seçili günler busy günlerle kesişiyorsa çakışır.
        if (!FEATURES.weekdaySelection) return true;
        return weekdays.some((d) => b.weekdays.includes(d));
      }) ?? null
    );
  }, [availability, startDate, selectedEnd, weekdays]);
  // Düzenlemede kendi booking'i busyRanges içinde olabilir → kendini çakışma sayma.
  const blockingConflict =
    conflict && !(isEditing && editingBooking &&
      conflict.startDate === editingBooking.startDate && conflict.endDate === editingBooking.endDate)
      ? conflict
      : null;

  useEffect(() => {
    if (open) {
      if (editingBooking) {
        // Miras (ay-bazlı) kayıtlarda en yakın yeni preset'e düş: 1 ay.
        const editPeriod: BookingPeriodKey = editingBooking.period ?? '1m';
        setPeriod(editPeriod);
        setStartDate(editingBooking.startDate);
        // Mevcut bitiş, periyot-türevinden farklıysa manuel kabul edilir (korunur).
        setEndDate(
          editingBooking.endDate &&
            editingBooking.endDate !== periodEndDate(editingBooking.startDate, editPeriod)
            ? editingBooking.endDate
            : ''
        );
        setProjectName(editingBooking.projectName);
        setProjectDescription(editingBooking.projectDescription);
        setHelpNeeded(editingBooking.helpNeeded);
        setTechnologies([...editingBooking.technologies]);
        setWeekdays(
          editingBooking.weekdays && editingBooking.weekdays.length > 0
            ? [...editingBooking.weekdays]
            : [1, 2, 3, 4, 5]
        );
      } else {
        setPeriod('1w');
        // Odalar sekmesi tarih filtresi aktifse o tarihle aç (bugünden önce değilse).
        setStartDate(initialStartDate && initialStartDate >= todayPlus(0) ? initialStartDate : todayPlus(1));
        setEndDate('');
        setProjectName('');
        setProjectDescription('');
        setHelpNeeded('');
        setTechnologies([]);
        setWeekdays([1, 2, 3, 4, 5]);
      }
      setCustomTech('');
      setErrors({});
    }
  }, [open, editingBooking, initialStartDate]);

  function toggleTech(t: string) {
    setTechnologies((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  function toggleWeekday(d: number) {
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  function addCustomTech() {
    const v = customTech.trim();
    if (v.length === 0) return;
    if (v.length > 40) return;
    if (!technologies.includes(v)) {
      setTechnologies((cur) => [...cur, v]);
    }
    setCustomTech('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!room) return;

    const newErrors: Record<string, string> = {};
    if (projectName.trim().length < 3) newErrors.projectName = 'Proje adı en az 3 karakter olmalı.';
    if (projectDescription.trim().length < 20) newErrors.projectDescription = 'Proje açıklaması en az 20 karakter olmalı.';
    if (helpNeeded.trim().length < 10) newErrors.helpNeeded = 'Yardım talebi en az 10 karakter olmalı.';
    if (technologies.length === 0) newErrors.technologies = 'En az bir teknoloji seçin.';
    if (FEATURES.weekdaySelection && weekdays.length === 0) newErrors.weekdays = 'En az bir gün seçin.';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Seçilen aralık dolu — gönderme (buton da disabled, bu ek savunma).
    if (blockingConflict) {
      setErrors({
        startDate: `Bu oda ${fmtTrDate(blockingConflict.startDate)} – ${fmtTrDate(
          blockingConflict.endDate
        )} arası dolu. En erken ${fmtTrDate(nextDayYmd(blockingConflict.endDate))} tarihinden seçin.`,
      });
      return;
    }

    await onSubmit({
      roomId: room.id,
      period,
      weekdays: FEATURES.weekdaySelection
        ? [...weekdays].sort((a, b) => a - b)
        : isEditing
          ? editingBooking!.weekdays
          : undefined,
      startDate,
      // Manuel bitiş girilmişse gönder; boşsa undefined → server periyottan türetir.
      endDate: endDate || undefined,
      projectName: projectName.trim(),
      projectDescription: projectDescription.trim(),
      helpNeeded: helpNeeded.trim(),
      technologies,
    });
  }

  if (!open || !room) return null;

  return (
    <MovableModalShell open={open} onClose={onClose} maxWidthClass="max-w-2xl">
        <div className="p-6 border-b border-kt-gray-100 bg-gradient-to-r from-kt-gold-500 to-kt-gold-600 text-white">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider opacity-90 mb-1">
                {isEditing ? 'Talebi Düzenle' : 'Randevu Talebi'} · {room.code}
              </div>
              <h2 className="text-2xl font-bold">{room.name}</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
              aria-label="Kapat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto scrollbar-thin px-6 py-5 space-y-5 flex-1">
          <p className="text-xs text-kt-gray-500 -mb-2">
            <span className="text-red-500">*</span> işaretli alanlar zorunludur.
          </p>
          <div>
            <label className="label">Randevu Süresi<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
            <div className="grid grid-cols-3 gap-2">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.key}
                  onClick={() => {
                    setPeriod(opt.key);
                    setEndDate(''); // preset seçimi bitişi periyot-türevine döndürür
                  }}
                  className={`py-3 rounded-xl font-bold transition-all ${
                    period === opt.key
                      ? 'bg-kt-gold-500 text-white shadow-kt-gold'
                      : 'bg-kt-gray-100 text-kt-green-700 hover:bg-kt-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="start-date" className="label">Başlangıç Tarihi<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
              <input
                id="start-date"
                type="date"
                className="input cursor-pointer"
                value={startDate}
                min={todayPlus(0)}
                onChange={(e) => {
                  const v = e.target.value;
                  setStartDate(v);
                  // Manuel bitiş yeni başlangıçtan önce kaldıysa sıfırla.
                  if (endDate && v && endDate < v) setEndDate('');
                }}
                onClick={openDatePicker}
                required
              />
            </div>
            <div>
              <label htmlFor="end-date" className="label">Bitiş Tarihi</label>
              <input
                id="end-date"
                type="date"
                className="input cursor-pointer"
                value={selectedEnd}
                min={startDate || todayPlus(0)}
                onChange={(e) => setEndDate(e.target.value)}
                onClick={openDatePicker}
                aria-describedby="end-date-hint"
              />
              <p id="end-date-hint" className="text-[11px] text-kt-gray-500 mt-1">
                Periyottan hesaplanır; kısa/özel süre için değiştirebilirsin.
              </p>
            </div>
          </div>

          {/* Çakışma uyarısı — seçilen aralık dolu (gönderme öncesi net bilgi) */}
          {blockingConflict && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">
              <div className="font-bold mb-1">⛔ Seçtiğiniz tarih aralığı dolu</div>
              <div>
                Bu oda{' '}
                <strong>
                  {fmtTrDate(blockingConflict.startDate)} – {fmtTrDate(blockingConflict.endDate)}
                </strong>{' '}
                tarihleri arasında rezerve. En erken{' '}
                <strong>{fmtTrDate(nextDayYmd(blockingConflict.endDate))}</strong> tarihinden itibaren
                randevu alabilirsiniz.
              </div>
            </div>
          )}

          {/* Boş (rezerve edilebilir) aralıklar — tıkla, başlangıç tarihini ata */}
          {availability && availability.freeGaps.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-700 mb-1.5">
                Boş tarih aralıkları
              </div>
              <ul className="space-y-1 text-xs text-emerald-800">
                {availability.freeGaps.map((g, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>{fmtTrDate(g.startDate)} – {fmtTrDate(g.endDate)}</span>
                    <button
                      type="button"
                      onClick={() => setStartDate(g.startDate)}
                      className="text-[11px] font-semibold text-emerald-700 underline hover:text-emerald-900"
                    >
                      başlangıç yap
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-emerald-600 mt-1.5">
                Dolu dönemlerden önceki/araki boş aralıklar — tıklayınca başlangıç tarihi atanır.
              </p>
            </div>
          )}

          {/* Odanın dolu dönemleri — kullanıcı boş tarih seçebilsin diye önden göster */}
          {availability && availability.busyRanges.length > 0 && (
            <div className="rounded-lg border border-kt-gray-200 bg-kt-gray-50 p-3">
              <div className="text-xs font-semibold text-kt-gray-600 mb-1.5">
                Bu odanın dolu dönemleri
              </div>
              <ul className="space-y-1 text-xs text-kt-gray-700">
                {availability.busyRanges.map((b, i) => {
                  const overlaps = !!startDate && rangesOverlap(startDate, selectedEnd, b.startDate, b.endDate);
                  return (
                    <li key={i} className={`flex items-center gap-2 ${overlaps ? 'text-red-700 font-semibold' : ''}`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${overlaps ? 'bg-red-500' : 'bg-kt-gold-500'}`} />
                      {fmtTrDate(b.startDate)} – {fmtTrDate(b.endDate)}
                      {FEATURES.weekdaySelection && (
                        <span className="text-kt-gray-400">
                          ({b.weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join(', ')})
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

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
              Oda yalnızca seçtiğiniz günlerde size ayrılır; kalan günler başka kullanıcılara açık kalır.
            </p>
            {errors.weekdays && <p className="text-xs text-red-600 mt-1">{errors.weekdays}</p>}
          </div>
          )}

          <div>
            <label htmlFor="project-name" className="label">Proje Adı<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
            <input
              id="project-name"
              type="text"
              className="input"
              placeholder="Ör: AI Destekli Bütçe Asistanı"
              value={projectName}
              maxLength={120}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
            {errors.projectName && <p className="text-xs text-red-600 mt-1">{errors.projectName}</p>}
          </div>

          <div>
            <label htmlFor="project-description" className="label">
              Proje Açıklaması<span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
            </label>
            <textarea
              id="project-description"
              className="textarea"
              rows={4}
              placeholder="Planladığınız uygulamayı kısaca açıklayın: hangi problemi çözüyor, hedef kullanıcısı kim?"
              value={projectDescription}
              maxLength={2000}
              onChange={(e) => setProjectDescription(e.target.value)}
              required
            />
            <div className="flex justify-between mt-1">
              {errors.projectDescription
                ? <p className="text-xs text-red-600">{errors.projectDescription}</p>
                : <span />}
              <span className="text-xs text-kt-gray-400">{projectDescription.length} / 2000</span>
            </div>
          </div>

          <div>
            <label htmlFor="help-needed" className="label">Hangi Konularda Desteğe İhtiyacınız Var?<span className="text-red-500 ml-0.5" aria-hidden="true">*</span></label>
            <textarea
              id="help-needed"
              className="textarea"
              rows={3}
              placeholder="Ör: Mimari tasarımı, prompt engineering, deploy süreci..."
              value={helpNeeded}
              maxLength={2000}
              onChange={(e) => setHelpNeeded(e.target.value)}
              required
            />
            <div className="flex justify-between mt-1">
              {errors.helpNeeded
                ? <p className="text-xs text-red-600">{errors.helpNeeded}</p>
                : <span />}
              <span className="text-xs text-kt-gray-400">{helpNeeded.length} / 2000</span>
            </div>
          </div>

          <div>
            <label className="label">
              Kullanmak İstediğin Teknolojiler
              <span className="text-kt-gray-400 font-normal ml-1">({technologies.length} seçili)</span>
            </label>
            <div className="space-y-3 mb-2">
              {TECH_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="text-xs font-bold text-kt-gold-700 uppercase tracking-wider mb-1.5">
                    {group.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((t) => {
                      const active = technologies.includes(t);
                      return (
                        <button
                          type="button"
                          key={t}
                          onClick={() => toggleTech(t)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                            active
                              ? 'bg-kt-gold-500 text-white shadow-kt-gold'
                              : 'bg-kt-gray-100 text-kt-green-700 hover:bg-kt-gray-200'
                          }`}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1"
                placeholder="Farklı bir teknoloji ekleyin..."
                value={customTech}
                maxLength={40}
                onChange={(e) => setCustomTech(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomTech();
                  }
                }}
              />
              <button type="button" onClick={addCustomTech} className="btn-secondary">
                Ekle
              </button>
            </div>
            {errors.technologies && <p className="text-xs text-red-600 mt-1">{errors.technologies}</p>}
            {technologies.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {technologies.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-kt-gold-100 text-kt-gold-800 text-xs font-semibold">
                    {t}
                    <button
                      type="button"
                      onClick={() => toggleTech(t)}
                      className="hover:text-kt-gold-900"
                      aria-label={`${t} kaldır`}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </form>

        <div className="px-6 py-4 border-t border-kt-gray-100 bg-kt-gray-50 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost" disabled={loading}>
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !!blockingConflict}
            className="btn-primary"
            title={blockingConflict ? 'Seçilen tarih aralığı dolu — farklı tarih seçin.' : undefined}
          >
            {loading ? (isEditing ? 'Güncelleniyor...' : 'Gönderiliyor...') : (isEditing ? 'Değişiklikleri Kaydet' : 'Talebi Gönder')}
          </button>
        </div>
    </MovableModalShell>
  );
}
