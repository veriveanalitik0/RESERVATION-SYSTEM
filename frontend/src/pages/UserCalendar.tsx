/**
 * Kullanıcı kişisel takvimi — yaklaşan ve geçmiş randevular.
 *
 * UI: ay görünümü + agenda (yan yana, mobilde stacked). Bir güne tıklandığında
 * o günün randevuları + onaylı booking'lerden birine yeni randevu ekleme aksiyonu.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { AppointmentModal } from '../components/AppointmentModal';
import { RoomWeekdayHeatmap } from '../components/RoomWeekdayHeatmap';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Appointment, Booking } from '../types';

/* ============ Tarih yardımcıları ============ */

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const;
const MONTH_LABEL: Record<number, string> = {
  0: 'Ocak', 1: 'Şubat', 2: 'Mart', 3: 'Nisan', 4: 'Mayıs', 5: 'Haziran',
  6: 'Temmuz', 7: 'Ağustos', 8: 'Eylül', 9: 'Ekim', 10: 'Kasım', 11: 'Aralık',
};

/** Pazartesi=0..Pazar=6 (TR haftası). */
function weekdayMon(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function buildMonthGrid(anchor: Date): { date: Date; inMonth: boolean }[] {
  const first = startOfMonth(anchor);
  const last = endOfMonth(anchor);
  const leading = weekdayMon(first);
  const start = new Date(first);
  start.setDate(first.getDate() - leading);

  // 6 hafta × 7 gün = 42 cell — sabit grid.
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date: d,
      inMonth: d.getMonth() === anchor.getMonth(),
    });
    if (i >= 27 && d > last && weekdayMon(d) === 6) break; // gereksiz haftaları kes
  }
  return cells;
}

export default function UserCalendar() {
  const toast = useToast();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [scheduling, setScheduling] = useState<Booking | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [apptRes, bookRes] = await Promise.all([
        api.listUserAppointments({ includeCancelled: false }),
        api.listUserBookings(),
      ]);
      setAppointments(apptRes.appointments);
      setBookings(bookRes.bookings);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Takvim yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeEvents('user', (type) => {
    if (type === 'appointment.changed' || type === 'booking.reviewed') void load();
  });

  const cells = useMemo(() => buildMonthGrid(anchor), [anchor]);

  // gün başına randevu sayısı + listesi
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const key = ymd(new Date(a.startAt));
      const list = m.get(key) ?? [];
      list.push(a);
      m.set(key, list);
    }
    for (const [k, list] of m) {
      list.sort((x, y) => x.startAt.localeCompare(y.startAt));
      m.set(k, list);
    }
    return m;
  }, [appointments]);

  const todayApptList = byDay.get(ymd(selectedDate)) ?? [];

  // O gün için randevu eklenebilir mi? Onaylı booking var mı + tarihi bookingin
  // start/end aralığında mı?
  const bookingsForSelected = useMemo(() => {
    const target = ymd(selectedDate);
    return bookings.filter(
      (b) =>
        b.status === 'approved' &&
        b.startDate <= target &&
        b.endDate >= target
    );
  }, [bookings, selectedDate]);

  const approvedBookings = useMemo(
    () => bookings.filter((b) => b.status === 'approved'),
    [bookings]
  );

  // Onaylı booking aralıklarının grid günleriyle kesişimi (yeşil bloklar).
  // Sadece görünen ~42 hücre taranır; 'YYYY-MM-DD' string karşılaştırması
  // (start <= gün <= end) aralık testine yeter. isStart/isEnd, komşu günün
  // kapsanıp kapsanmadığına bakarak bloğun uçlarını yuvarlatmak için.
  const bookingDays = useMemo(() => {
    const m = new Map<string, { bookings: Booking[]; isStart: boolean; isEnd: boolean }>();
    if (approvedBookings.length === 0) return m;
    const covers = (key: string) =>
      approvedBookings.some((b) => b.startDate <= key && b.endDate >= key);
    for (const { date } of cells) {
      const key = ymd(date);
      const covering = approvedBookings.filter(
        (b) => b.startDate <= key && b.endDate >= key
      );
      if (covering.length === 0) continue;
      const prev = new Date(date);
      prev.setDate(date.getDate() - 1);
      const next = new Date(date);
      next.setDate(date.getDate() + 1);
      m.set(key, {
        bookings: covering,
        isStart: !covers(ymd(prev)),
        isEnd: !covers(ymd(next)),
      });
    }
    return m;
  }, [approvedBookings, cells]);

  async function submitAppointment(payload: {
    bookingId: string;
    startAt: string;
    endAt: string;
    title?: string;
    notes?: string;
  }) {
    setSubmitting(true);
    try {
      await api.createAppointment(payload);
      toast.push('success', 'Randevu eklendi.');
      setScheduling(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Randevu oluşturulamadı.');
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelAppointment(id: string) {
    try {
      await api.cancelAppointment(id);
      toast.push('info', 'Randevu iptal edildi.');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İptal başarısız.');
    }
  }

  const todayStr = ymd(new Date());
  const monthHeader = `${MONTH_LABEL[anchor.getMonth()]} ${anchor.getFullYear()}`;

  return (
    <AppShell kind="user">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Takvimim</h1>
          <p className="text-kt-gray-500 text-sm">
            Onaylı lab kullanım haklarınız üzerinde günlük randevularınızı planlayın.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAnchor(addMonths(anchor, -1))}
            className="btn-ghost text-sm"
            aria-label="Önceki ay"
          >
            ‹
          </button>
          <input
            type="month"
            className="input text-sm py-1.5 px-3 w-44"
            value={`${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-').map((p) => parseInt(p, 10));
              if (!isNaN(y) && !isNaN(m)) setAnchor(new Date(y, m - 1, 1));
            }}
          />
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setAnchor(startOfMonth(now));
              setSelectedDate(startOfDay(now));
            }}
            className="btn-secondary text-sm"
          >
            Bugün
          </button>
          <button
            type="button"
            onClick={() => setAnchor(addMonths(anchor, 1))}
            className="btn-ghost text-sm"
            aria-label="Sonraki ay"
          >
            ›
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-kt-gray-500">Yükleniyor…</div>
      ) : approvedBookings.length === 0 ? (
        <EmptyState
          icon="bookings"
          title="Henüz onaylı bir lab izniniz yok"
          description="Randevu ekleyebilmek için önce bir oda için randevu talebi gönderip onay almanız gerekiyor."
          tone="cyan"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* === Ay görünümü === */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-kt-green-900">{monthHeader}</h2>
              <span className="text-xs text-kt-gray-500">
                {appointments.length} randevu
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="text-center text-[11px] font-bold text-kt-gray-500 py-1"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map(({ date, inMonth }) => {
                const key = ymd(date);
                const list = byDay.get(key) ?? [];
                const isToday = key === todayStr;
                const isSelected = isSameDay(date, selectedDate);
                const bookingInfo = bookingDays.get(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDate(startOfDay(date))}
                    className={`
                      relative aspect-square rounded-lg text-left p-1.5 transition border
                      ${
                        bookingInfo
                          ? inMonth
                            ? 'bg-kt-green-500/15'
                            : 'bg-kt-green-500/10 text-kt-gray-400'
                          : inMonth
                            ? 'bg-white'
                            : 'bg-kt-gray-50/60 text-kt-gray-400'
                      }
                      ${
                        isSelected
                          ? 'ring-2 ring-cyan-500 border-cyan-300'
                          : bookingInfo
                            ? 'border-kt-green-300 hover:border-kt-green-500'
                            : 'border-kt-gray-100 hover:border-kt-gold-300'
                      }
                      ${isToday ? 'font-bold' : ''}
                    `}
                  >
                    <div
                      className={`text-xs ${
                        isToday
                          ? 'text-cyan-700 inline-flex items-center justify-center w-5 h-5 rounded-full bg-cyan-100'
                          : 'text-kt-green-800'
                      }`}
                    >
                      {date.getDate()}
                    </div>
                    {/* Yeşil dönem şeridi — onaylı booking aralığı bu günü kapsıyor.
                        Uçlarda (aralığın ilk/son günü) yuvarlatılır ve içeri çekilir. */}
                    {bookingInfo && (
                      <span
                        aria-hidden="true"
                        className={`
                          absolute bottom-3 h-1.5 bg-kt-green-500
                          ${bookingInfo.isStart ? 'left-1 rounded-l-full' : 'left-0'}
                          ${bookingInfo.isEnd ? 'right-1 rounded-r-full' : 'right-0'}
                        `}
                        title={bookingInfo.bookings
                          .map((b) => `${b.roomCode} · ${b.startDate} → ${b.endDate}`)
                          .join('\n')}
                      />
                    )}
                    {/* Cyan ziyaret marker'ları — en altta ince şerit, yeşil şeridin altında. */}
                    {list.length > 0 && (
                      <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-0.5">
                        {list.slice(0, 3).map((a) => (
                          <span
                            key={a.id}
                            className="h-1.5 flex-1 rounded-sm bg-cyan-400"
                            title={`${a.title} (${new Date(a.startAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})`}
                          />
                        ))}
                        {list.length > 3 && (
                          <span className="text-[9px] text-cyan-700 font-bold">
                            +{list.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Renk lejantı */}
            <div className="mt-3 pt-3 border-t border-kt-gray-100 flex items-center gap-4 flex-wrap text-[11px] text-kt-gray-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded-sm bg-kt-green-500/20 border border-kt-green-400" />
                Onaylı randevu dönemin
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3.5 h-1.5 rounded-sm bg-cyan-400" />
                Ziyaret randevusu
              </span>
            </div>
          </div>

          {/* === Seçili gün ajandası === */}
          <aside className="card p-4">
            <div className="mb-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-kt-gray-500">
                Gün ajandası
              </div>
              <h3 className="text-lg font-bold text-kt-green-900 mt-0.5">
                {selectedDate.toLocaleDateString('tr-TR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </h3>
            </div>

            {todayApptList.length === 0 ? (
              <div className="text-sm text-kt-gray-500 italic py-2">
                Bu gün için randevu yok.
              </div>
            ) : (
              <ul className="space-y-2 mb-4">
                {todayApptList.map((a) => (
                  <li
                    key={a.id}
                    className="border border-cyan-200 bg-cyan-50/40 rounded-lg p-3"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-semibold text-sm text-kt-green-900 flex-1 min-w-0 truncate">
                        {a.title}
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmCancelId(a.id)}
                        className="text-[11px] text-rose-700 hover:text-rose-900 font-semibold shrink-0"
                      >
                        İptal
                      </button>
                    </div>
                    <div className="text-xs text-cyan-800 font-medium">
                      {new Date(a.startAt).toLocaleTimeString('tr-TR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' – '}
                      {new Date(a.endAt).toLocaleTimeString('tr-TR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="text-xs text-kt-gray-600 mt-1">
                      <span className="font-mono">{a.roomCode}</span>
                      {a.roomEquipment && (
                        <span className="text-kt-gray-500"> · {a.roomEquipment}</span>
                      )}
                    </div>
                    {a.notes && (
                      <div className="text-xs text-kt-gray-600 mt-1 italic line-clamp-2">
                        {a.notes}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Yeni randevu — bu gün için uygun booking varsa */}
            {bookingsForSelected.length > 0 ? (
              <div className="mt-3 pt-3 border-t border-kt-gray-100">
                <div className="text-xs font-semibold text-kt-gray-600 mb-2">
                  Bu gün için randevu ekle:
                </div>
                <div className="flex flex-col gap-1.5">
                  {bookingsForSelected.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setScheduling(b)}
                      className="w-full text-left text-xs px-3 py-2 rounded-lg bg-white hover:bg-cyan-50 border border-cyan-200 hover:border-cyan-400 transition"
                    >
                      <span className="font-mono text-cyan-800 font-bold">{b.roomCode}</span>
                      <span className="text-kt-gray-600"> · {b.projectName}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 pt-3 border-t border-kt-gray-100 text-[11px] text-kt-gray-500">
                Bu tarih için aktif bir lab izniniz yok. Başka bir gün seçin veya yeni
                bir oda talebi gönderin.
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Oda × gün yoğunluk ısı-haritası (#5c) — kendi tarih filtresiyle. */}
      <div className="mt-6">
        <RoomWeekdayHeatmap />
      </div>

      {scheduling && (
        <AppointmentModal
          booking={scheduling}
          onClose={() => setScheduling(null)}
          onSubmit={submitAppointment}
          submitting={submitting}
          initialDate={ymd(selectedDate)}
        />
      )}
      <ConfirmDialog
        open={!!confirmCancelId}
        title="Randevu iptal edilsin mi?"
        message="Bu saatli randevu iptal edilecek. Bu işlem geri alınamaz."
        confirmLabel="Evet, iptal et"
        onConfirm={() => {
          if (confirmCancelId) void cancelAppointment(confirmCancelId);
          setConfirmCancelId(null);
        }}
        onCancel={() => setConfirmCancelId(null)}
      />
    </AppShell>
  );
}
