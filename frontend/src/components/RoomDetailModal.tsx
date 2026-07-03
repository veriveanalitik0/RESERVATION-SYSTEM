/**
 * Oda detay modalı — "devamını göster" / karta tıklayınca açılır.
 * Cihaz, açıklama, teknik özellikler (specs JSON'undan) ve MÜSAİTLİK gösterir:
 * boş günler, dolu tarih aralıkları ve önümüzdeki 2 haftanın dolu saatleri.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { FEATURES } from '../constants/features';
import { roomCategoryLabel } from '../lib/utils';
import type { Room, RoomAvailability } from '../types';

interface SpecItem {
  label: string;
  value: string;
}

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function parseSpecs(raw: string | null): SpecItem[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (x): x is SpecItem =>
        x && typeof x.label === 'string' && typeof x.value === 'string'
    );
  } catch {
    return [];
  }
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

function fmtFull(d: string): string {
  return new Date(d).toLocaleDateString('tr-TR');
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  room: Room | null;
  open: boolean;
  onClose: () => void;
  /** "Randevu Al" — sadece oda müsaitse ve handler verilirse gösterilir. */
  onBook?: (room: Room) => void;
  /** "Doluluk sonrası randevu al" — oda doluysa, belirtilen tarihten randevu modalı açar. */
  onBookAfter?: (room: Room, startDate: string) => void;
}

export function RoomDetailModal({ room, open, onClose, onBook, onBookAfter }: Props) {
  const [availability, setAvailability] = useState<RoomAvailability | null>(null);
  const [availLoading, setAvailLoading] = useState(false);

  useEffect(() => {
    if (!open || !room) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setAvailLoading(true);
    setAvailability(null);
    api
      .roomAvailability(room.id)
      .then((res) => {
        if (!cancelled) setAvailability(res);
      })
      .catch(() => {
        /* müsaitlik detayı best-effort — modal yine de açılır */
      })
      .finally(() => {
        if (!cancelled) setAvailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, room]);

  if (!open || !room) return null;
  const specs = parseSpecs(room.specs);
  // availableWeekdays oda listesinden (kart) gelir; detay yüklenince onunla güncellenir.
  const availableWeekdays = availability?.availableWeekdays ?? room.availableWeekdays ?? [];
  const nextAvailableDate = availability?.nextAvailableDate ?? room.nextAvailableDate;

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
            <div className="text-xs uppercase tracking-widest text-kt-violet-700 font-bold">
              {roomCategoryLabel(room.roomType, room.capacity)}
            </div>
            <h2 className="text-2xl font-extrabold text-kt-green-900">{room.name}</h2>
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

        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {room.equipment && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-kt-violet-100 text-kt-violet-800 text-xs font-semibold border border-kt-violet-300">
                {room.equipment}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-kt-gray-100 text-kt-gray-700 text-xs font-semibold">
              {room.capacity === 1 ? '1 kişilik' : `${room.capacity} kişilik`}
            </span>
            {room.isAvailable ? (
              <span className="badge-available">● Müsait</span>
            ) : (
              <span className="badge-unavailable">● Dolu</span>
            )}
          </div>

          {room.description && (
            <p className="text-sm text-kt-gray-600 leading-relaxed">{room.description}</p>
          )}

          {/* ============ MÜSAİTLİK ============ */}
          <div>
            <h3 className="text-sm font-bold text-kt-green-900 mb-2">Müsaitlik</h3>

            {/* Durum özeti — full-week modda tarih bazlı */}
            <div className="mb-3">
              {room.isAvailable ? (
                <p className="text-xs font-semibold text-emerald-700">● Randevuya uygun</p>
              ) : (
                <p className="text-xs font-semibold text-kt-gold-700">
                  ● {nextAvailableDate
                    ? `${new Date(nextAvailableDate).toLocaleDateString('tr-TR')} tarihine kadar dolu`
                    : 'Şu an dolu'}
                </p>
              )}
            </div>

            {/* Boş (rezerve edilebilir) günler — yalnız gün-bazlı mod */}
            {FEATURES.weekdaySelection && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-kt-gray-500 mb-1.5">
                  Müsait günler
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAY_LABELS.map((l, i) => {
                    const day = i + 1;
                    const free = availableWeekdays.includes(day);
                    return (
                      <div
                        key={day}
                        className={`py-1.5 rounded-md text-[11px] font-bold text-center ${
                          free
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-kt-gray-100 text-kt-gray-400 line-through'
                        }`}
                        title={free ? 'Müsait' : 'Dolu'}
                      >
                        {l}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {availLoading && (
              <div className="text-xs text-kt-gray-400">Müsaitlik yükleniyor…</div>
            )}

            {/* Dolu tarih aralıkları */}
            {availability && availability.busyRanges.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-kt-gray-500 mb-1.5">
                  Dolu dönemler
                </div>
                <ul className="space-y-1">
                  {availability.busyRanges.map((b, idx) => (
                    <li
                      key={idx}
                      className="text-xs text-kt-gray-700 flex items-center gap-2"
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-kt-gold-500" />
                      {fmtDate(b.startDate)} – {fmtDate(b.endDate)}
                      <span className="text-kt-gray-400">
                        ({b.weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join(', ')})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Önümüzdeki 2 haftanın dolu saatleri */}
            {availability && availability.appointments.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-kt-gray-500 mb-1.5">
                  Yaklaşan dolu saatler
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {availability.appointments.map((day) => (
                    <div key={day.date} className="flex items-start gap-2 text-xs">
                      <span className="w-16 shrink-0 font-semibold text-kt-gray-600">
                        {fmtDate(day.date)}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {day.slots.map((s, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded bg-kt-gray-100 text-kt-gray-600"
                          >
                            {fmtTime(s.start)}–{fmtTime(s.end)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {availability &&
              availability.appointments.length === 0 &&
              availableWeekdays.length > 0 && (
                <p className="text-[11px] text-emerald-700">
                  Önümüzdeki 2 haftada planlı dolu saat yok — randevu için uygun.
                </p>
              )}
          </div>

          {specs.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-kt-green-900 mb-2">Teknik Özellikler</h3>
              <dl className="rounded-xl border border-kt-gray-100 divide-y divide-kt-gray-100 overflow-hidden">
                {specs.map((s) => (
                  <div key={s.label} className="flex items-start gap-4 px-4 py-2.5 odd:bg-kt-gray-50/60">
                    <dt className="text-xs font-semibold text-kt-gray-500 w-36 shrink-0">{s.label}</dt>
                    <dd className="text-sm text-kt-green-900 font-medium">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Müsait oda + ileride dolu pencere → "Randevu Al" altında bilgi notu */}
          {onBook && room.isAvailable && availability?.nextOccupiedWindow && (
            <div className="rounded-lg border border-kt-gold-200 bg-kt-gold-50 p-2.5 text-[11px] text-kt-gold-800">
              ℹ️ Bu oda{' '}
              <strong>
                {fmtFull(availability.nextOccupiedWindow.startDate)} – {fmtFull(availability.nextOccupiedWindow.endDate)}
              </strong>{' '}
              arasında dolu olacak. Randevunu bu tarihten önce bitecek şekilde planla.
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 btn-ghost text-sm">
              Kapat
            </button>
            {onBook && room.isAvailable && (
              <button
                type="button"
                onClick={() => onBook(room)}
                className="flex-1 btn-primary text-sm"
              >
                Randevu Al
              </button>
            )}
            {onBook && !room.isAvailable && (
              <button
                type="button"
                onClick={() => onBook(room)}
                className="flex-1 text-sm px-4 py-2.5 rounded-xl bg-kt-gold-50 text-kt-gold-800 border border-kt-gold-200 font-semibold hover:bg-kt-gold-100 transition-colors"
              >
                Sıraya gir
              </button>
            )}
          </div>

          {/* Dolu oda → doluluk bittikten sonrası için randevu (sıraya girmeye alternatif) */}
          {onBookAfter && !room.isAvailable && availability?.earliestAvailableAfter && (
            <button
              type="button"
              onClick={() => onBookAfter(room, availability.earliestAvailableAfter!)}
              className="w-full text-sm px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold hover:bg-emerald-100 transition-colors"
            >
              Doluluk sonrası randevu al ({fmtFull(availability.earliestAvailableAfter)}'ten itibaren)
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
