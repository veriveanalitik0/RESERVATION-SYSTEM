/**
 * Yeni randevu (günlük ziyaret) modalı.
 *
 * Onaylı bir booking üzerine, kullanıcı odaya gelmek istediği belirli gün ve
 * saat aralığını seçer. Kapasite + çakışma kontrolü backend'de yapılır.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Booking } from '../types';
import { openDatePicker } from '../lib/utils';

interface Props {
  booking: Booking;
  onClose: () => void;
  onSubmit: (payload: {
    bookingId: string;
    startAt: string;
    endAt: string;
    title?: string;
    notes?: string;
  }) => Promise<void> | void;
  submitting?: boolean;
  /** Önceden seçili gün (YYYY-MM-DD). Genellikle takvimden o güne tıklanınca geçilir. */
  initialDate?: string;
}

function todayLocal(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function clampToRange(d: string, min: string, max: string): string {
  if (d < min) return min;
  if (d > max) return max;
  return d;
}

/** Local YYYY-MM-DD + HH:mm → ISO string (with timezone offset). */
function toIso(dateStr: string, timeStr: string): string {
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  return dt.toISOString();
}

export function AppointmentModal({ booking, onClose, onSubmit, submitting, initialDate }: Props) {
  const today = useMemo(() => todayLocal(), []);
  const minDate = booking.startDate < today ? today : booking.startDate;
  const maxDate = booking.endDate;

  const [date, setDate] = useState<string>(() =>
    clampToRange(initialDate ?? today, minDate, maxDate)
  );
  const [startTime, setStartTime] = useState<string>('10:00');
  const [endTime, setEndTime] = useState<string>('12:00');
  const [title, setTitle] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Date clamp — booking'in dışına çıkmasın
  useEffect(() => {
    if (date < minDate || date > maxDate) {
      setDate(clampToRange(date, minDate, maxDate));
    }
  }, [date, minDate, maxDate]);

  function localValid(): string | null {
    if (!date || !startTime || !endTime) return 'Tarih ve saat zorunlu.';
    if (date < minDate) return `Randevu en erken ${minDate} olabilir.`;
    if (date > maxDate) return `Randevu en geç ${maxDate} olabilir.`;
    if (endTime <= startTime) return 'Bitiş saati başlangıçtan sonra olmalı.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = localValid();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    try {
      await onSubmit({
        bookingId: booking.id,
        startAt: toIso(date, startTime),
        endAt: toIso(date, endTime),
        title: title.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    } catch (err) {
      setError((err as Error).message || 'Randevu oluşturulamadı.');
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
    >
      <form
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h3 className="text-lg font-bold text-kt-green-900 mb-1">Randevu Ekle</h3>
        <p className="text-sm text-kt-gray-500 mb-4">
          <span className="font-semibold">{booking.roomCode}</span> · {booking.projectName}
          <br />
          Lisans aralığı: <strong>{booking.startDate}</strong> – <strong>{booking.endDate}</strong>
        </p>

        <label className="label">Tarih</label>
        <input
          type="date"
          className="input mb-3 cursor-pointer"
          value={date}
          min={minDate}
          max={maxDate}
          onChange={(e) => setDate(e.target.value)}
          onClick={openDatePicker}
          disabled={submitting}
          required
        />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="label">Başlangıç</label>
            <input
              type="time"
              className="input"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={submitting}
              required
              step="900"
            />
          </div>
          <div>
            <label className="label">Bitiş</label>
            <input
              type="time"
              className="input"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={submitting}
              required
              step="900"
            />
          </div>
        </div>

        <label className="label">Başlık (opsiyonel)</label>
        <input
          type="text"
          className="input mb-3"
          placeholder={`Varsayılan: ${booking.projectName}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={submitting}
          maxLength={120}
        />

        <label className="label">Not (opsiyonel)</label>
        <textarea
          className="textarea mb-3"
          placeholder="Ne üzerinde çalışacaksınız? Hangi hazırlığı yapacaksınız?"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
          maxLength={500}
        />

        {error && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-ghost"
          >
            İptal
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Kaydediliyor…' : 'Randevu Al'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
