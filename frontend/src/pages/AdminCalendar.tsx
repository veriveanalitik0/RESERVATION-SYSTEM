/**
 * Admin takvim sayfası.
 *
 * Layout: sol/ana = ay görünümü (booking + appointment yoğunluğu);
 *         sağ/alt = seçili güne ait detay paneli (saat saat kim gelecek).
 *
 *  - Ay grid'inde her hücrede o günkü AKTİF booking sayısı + o güne planlı
 *    APPOINTMENT (fiziksel ziyaret) sayısı gösterilir.
 *  - Bir gün hücresine tıklanınca detay paneli o günü açar:
 *      · O gün aktif olan booking'ler (status chip'leri ile)
 *      · O güne planlı tüm randevular saat sırasına göre — kim, hangi oda,
 *        hangi saat aralığı, ne ekipman.
 *  - Booking chip → BookingDetailModal (onay/red akışı).
 *  - Randevu satırı → admin iptal aksiyonu.
 *
 * Veri kaynağı: api.listAdminBookings() + api.adminListAppointments().
 * Real-time: SSE event'lerinde otomatik refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useViewerKind } from '../hooks/useViewerKind';
import { BookingDetailModal } from '../components/BookingDetailModal';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type {
  Appointment,
  Booking,
  BookingStatus,
  ReviewBookingPayload,
} from '../types';

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => parseInt(p, 10));
  return new Date(y, m - 1, d);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function statusColor(status: BookingStatus): { bg: string; text: string; dot: string; label: string } {
  switch (status) {
    case 'approved':
      return { bg: 'bg-emerald-100 hover:bg-emerald-200', text: 'text-emerald-900', dot: 'bg-emerald-500', label: 'Onaylı' };
    case 'pending':
      return { bg: 'bg-amber-100 hover:bg-amber-200', text: 'text-amber-900', dot: 'bg-amber-500', label: 'Bekleyen' };
    case 'feedback_requested':
      return { bg: 'bg-blue-100 hover:bg-blue-200', text: 'text-blue-900', dot: 'bg-blue-500', label: 'Düzeltme' };
    case 'cancelled':
      return { bg: 'bg-gray-100 hover:bg-gray-200', text: 'text-gray-600', dot: 'bg-gray-400', label: 'İptal' };
    case 'rejected':
      return { bg: 'bg-rose-100 hover:bg-rose-200', text: 'text-rose-900', dot: 'bg-rose-500', label: 'Reddedilen' };
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function fmtFullDate(d: Date): string {
  return d.toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export default function AdminCalendar() {
  const toast = useToast();
  const viewerKind = useViewerKind();
  const canEdit = viewerKind === 'admin';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [selected, setSelected] = useState<Booking | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Geniş bir aralık (geçmiş 1 ay + 6 ay) çekerek ay nav UI'da yoğunluk
      // hesabı için yeterli veriyi tek seferde tut.
      const from = new Date();
      from.setMonth(from.getMonth() - 1);
      const to = new Date();
      to.setMonth(to.getMonth() + 18); // 1.5 yıl ileri kapsam — uzun vadeli planlama
      const [bRes, aRes] = await Promise.all([
        api.listAdminBookings(),
        api.adminListAppointments({
          from: from.toISOString(),
          to: to.toISOString(),
          includeCancelled: false,
        }),
      ]);
      setBookings(bRes.bookings);
      setAppointments(aRes.appointments);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Takvim yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeEvents('admin', (type) => {
    if (
      type === 'booking.created' ||
      type === 'booking.updated' ||
      type === 'booking.reviewed' ||
      type === 'booking.withdrawn' ||
      type === 'appointment.changed'
    ) {
      void load();
    }
  });

  // Hücre verisini hesapla — performans için useMemo.
  const cells = useMemo(() => {
    const month = cursor.getMonth();
    const year = cursor.getFullYear();
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const leading = (first.getDay() + 6) % 7; // Pzt=0
    const items: Array<{ date: Date; iso: string; inMonth: boolean }> = [];
    for (let i = leading - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      items.push({ date: d, iso: ymd(d), inMonth: false });
    }
    for (let day = 1; day <= last.getDate(); day++) {
      const d = new Date(year, month, day);
      items.push({ date: d, iso: ymd(d), inMonth: true });
    }
    while (items.length < 42) {
      const lst = items[items.length - 1].date;
      const next = new Date(lst.getFullYear(), lst.getMonth(), lst.getDate() + 1);
      items.push({ date: next, iso: ymd(next), inMonth: false });
    }
    return items;
  }, [cursor]);

  // Her güne booking + appointment yoğunluğu hesabı (multi-day booking → tüm günlere yayılır).
  const dataByDate = useMemo(() => {
    const map = new Map<string, { bookings: Booking[]; appointments: Appointment[] }>();
    const ensure = (key: string) => {
      let v = map.get(key);
      if (!v) {
        v = { bookings: [], appointments: [] };
        map.set(key, v);
      }
      return v;
    };
    for (const b of bookings) {
      const start = parseLocalDate(b.startDate);
      const end = parseLocalDate(b.endDate);
      const cur = new Date(start);
      while (cur.getTime() <= end.getTime()) {
        ensure(ymd(cur)).bookings.push(b);
        cur.setDate(cur.getDate() + 1);
      }
    }
    for (const a of appointments) {
      const key = ymd(new Date(a.startAt));
      ensure(key).appointments.push(a);
    }
    return map;
  }, [bookings, appointments]);

  const today = ymd(new Date());
  const selectedData = dataByDate.get(ymd(selectedDate)) ?? { bookings: [], appointments: [] };
  const selectedAppointments = [...selectedData.appointments].sort((a, b) =>
    a.startAt.localeCompare(b.startAt)
  );
  // Aynı booking aynı günde birden fazla kez gelir (multi-day span) — dedupe.
  const selectedBookings = Array.from(
    new Map(selectedData.bookings.map((b) => [b.id, b])).values()
  );

  async function review(payload: ReviewBookingPayload) {
    if (!selected) return;
    setReviewing(true);
    try {
      const res = await api.reviewBooking(selected.id, payload);
      if (res.autoWaitlisted && payload.action === 'approve') {
        toast.push(
          'info',
          `Oda dolu — talep otomatik bekleme listesine alındı (sıra: ${res.waitlistPosition}).`
        );
      } else {
        toast.push(
          'success',
          payload.action === 'approve'
            ? 'Talep onaylandı.'
            : payload.action === 'reject'
            ? 'Talep reddedildi.'
            : 'Düzeltme isteği iletildi.'
        );
      }
      setSelected(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    } finally {
      setReviewing(false);
    }
  }

  async function advanceStage() {
    if (!selected) return;
    setReviewing(true);
    try {
      const res = await api.adminAdvanceBookingStage(selected.id);
      toast.push('success', 'Proje bir sonraki aşamaya ilerletildi.');
      setSelected(res.booking);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Aşama ilerletilemedi.');
    } finally {
      setReviewing(false);
    }
  }

  async function regressStage() {
    if (!selected) return;
    setReviewing(true);
    try {
      const res = await api.adminRegressBookingStage(selected.id);
      toast.push('success', 'Proje bir önceki aşamaya geri alındı.');
      setSelected(res.booking);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Aşama geri alınamadı.');
    } finally {
      setReviewing(false);
    }
  }

  async function cancelAppointment(id: string) {
    try {
      await api.adminCancelAppointment(id);
      toast.push('info', 'Randevu iptal edildi.');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İptal başarısız.');
    }
  }

  const monthHeader = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const totalAppts = appointments.length;

  return (
    <AppShell kind={viewerKind}>
      {!canEdit && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Görüntüleme modu — bu sayfada değişiklik yapamazsınız.
        </div>
      )}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Takvim</h1>
          <p className="text-kt-gray-500 text-sm">
            Tüm booking'lerin aylık görünümü + her güne planlı fiziksel ziyaret randevuları ·{' '}
            <strong>{bookings.length}</strong> talep, <strong>{totalAppts}</strong> randevu
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="btn-ghost text-sm"
            aria-label="Önceki ay"
          >
            ‹
          </button>
          <input
            type="month"
            className="input text-sm py-1.5 px-3 w-44"
            value={`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-').map((p) => parseInt(p, 10));
              if (!isNaN(y) && !isNaN(m)) setCursor(new Date(y, m - 1, 1));
            }}
          />
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setCursor(startOfMonth(now));
              setSelectedDate(startOfDay(now));
            }}
            className="btn-secondary text-sm"
          >
            Bugün
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="btn-ghost text-sm"
            aria-label="Sonraki ay"
          >
            ›
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-kt-gray-500">Yükleniyor…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-4">
          {/* === AY GRID === */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-kt-green-900">{monthHeader}</h2>
              <div className="flex items-center gap-3 text-[11px] text-kt-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> Bekleyen
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Onaylı
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-500" /> Ziyaret
                </span>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="text-center text-[11px] font-bold uppercase tracking-wider text-kt-gray-400 py-1.5"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map(({ date, iso, inMonth }) => {
                const data = dataByDate.get(iso) ?? { bookings: [], appointments: [] };
                const uniq = Array.from(
                  new Map(data.bookings.map((b) => [b.id, b])).values()
                );
                const isToday = iso === today;
                const isSel = isSameDay(date, selectedDate);
                const apptCount = data.appointments.length;
                const pendingCount = uniq.filter((b) => b.status === 'pending').length;
                const approvedCount = uniq.filter((b) => b.status === 'approved').length;

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedDate(startOfDay(date))}
                    className={`relative aspect-square min-h-[80px] rounded-lg border text-left p-1.5 transition ${
                      inMonth
                        ? 'bg-white border-kt-gray-100 hover:border-kt-gold-300'
                        : 'bg-kt-gray-50/60 border-transparent text-kt-gray-300'
                    } ${
                      isSel ? 'ring-2 ring-cyan-500 border-cyan-300 shadow-md' : ''
                    } ${isToday && !isSel ? 'ring-2 ring-kt-gold-400 ring-inset' : ''}`}
                  >
                    <div
                      className={`text-[11px] font-bold mb-1 flex items-center justify-between ${
                        isToday
                          ? 'text-kt-gold-700'
                          : inMonth
                          ? 'text-kt-green-900'
                          : 'text-kt-gray-300'
                      }`}
                    >
                      <span>{date.getDate()}</span>
                      {apptCount > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[9px] font-bold text-cyan-700 bg-cyan-100 px-1 py-0.5 rounded-md"
                          title={`${apptCount} ziyaret randevusu`}
                        >
                          ●{apptCount}
                        </span>
                      )}
                    </div>

                    {/* Status nokta sayaçları */}
                    {(pendingCount > 0 || approvedCount > 0) && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {approvedCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1 py-0.5 rounded">
                            <span className="w-1 h-1 rounded-full bg-emerald-500" />
                            {approvedCount}
                          </span>
                        )}
                        {pendingCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded">
                            <span className="w-1 h-1 rounded-full bg-amber-500" />
                            {pendingCount}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Saat preview — en fazla 2 */}
                    {data.appointments.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {data.appointments.slice(0, 2).map((a) => (
                          <div
                            key={a.id}
                            className="text-[9px] font-mono font-bold text-cyan-800 bg-cyan-50 rounded px-1 truncate"
                            title={`${fmtTime(a.startAt)}–${fmtTime(a.endAt)} · ${a.title}`}
                          >
                            {fmtTime(a.startAt)}
                          </div>
                        ))}
                        {data.appointments.length > 2 && (
                          <div className="text-[9px] text-cyan-700 font-bold">
                            +{data.appointments.length - 2}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* === SEÇİLİ GÜN DETAY PANELİ === */}
          <aside className="card p-4 max-h-[calc(100vh-180px)] overflow-y-auto scrollbar-thin">
            <div className="mb-3 pb-3 border-b border-kt-gray-100">
              <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-700 mb-0.5">
                Gün detayı
              </div>
              <h3 className="text-lg font-bold text-kt-green-900">
                {fmtFullDate(selectedDate)}
              </h3>
              <div className="flex items-center gap-3 mt-1.5 text-xs">
                <span className="text-emerald-700 font-semibold">
                  {selectedBookings.filter((b) => b.status === 'approved').length} aktif booking
                </span>
                <span className="text-cyan-700 font-semibold">
                  {selectedAppointments.length} ziyaret
                </span>
              </div>
            </div>

            {/* === Ziyaret randevuları (saat saat) === */}
            <section className="mb-5">
              <h4 className="text-sm font-bold text-kt-green-900 mb-2 flex items-center gap-1.5">
                <svg
                  className="w-4 h-4 text-cyan-700"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Fiziksel ziyaret randevuları
              </h4>
              {selectedAppointments.length === 0 ? (
                <p className="text-xs text-kt-gray-500 italic">
                  Bu gün için planlı ziyaret yok.
                </p>
              ) : (
                <ul className="space-y-2">
                  {selectedAppointments.map((a) => (
                    <li
                      key={a.id}
                      className="border border-cyan-200 bg-gradient-to-br from-cyan-50 to-white rounded-lg p-3"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-mono text-sm font-bold text-cyan-800">
                          {fmtTime(a.startAt)} – {fmtTime(a.endAt)}
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setConfirmCancelId(a.id)}
                            className="text-[11px] text-rose-700 hover:text-rose-900 font-semibold shrink-0"
                          >
                            İptal
                          </button>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-kt-green-900 truncate">
                        {a.userFullName ?? '—'}
                      </div>
                      <div className="text-xs text-kt-gray-600 truncate">
                        {a.title}
                      </div>
                      <div className="text-[11px] text-kt-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-kt-green-700">
                          {a.roomCode}
                        </span>
                        {a.roomEquipment && (
                          <span className="text-kt-violet-700">· {a.roomEquipment}</span>
                        )}
                      </div>
                      {a.notes && (
                        <div className="text-xs text-kt-gray-600 italic mt-1.5 border-t border-cyan-100 pt-1.5">
                          {a.notes}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* === Bu güne denk gelen booking'ler === */}
            <section>
              <h4 className="text-sm font-bold text-kt-green-900 mb-2 flex items-center gap-1.5">
                <svg
                  className="w-4 h-4 text-kt-gold-700"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
                Aktif booking'ler ({selectedBookings.length})
              </h4>
              {selectedBookings.length === 0 ? (
                <p className="text-xs text-kt-gray-500 italic">
                  Bu güne denk gelen booking yok.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {selectedBookings.map((b) => {
                    const c = statusColor(b.status);
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(b)}
                          className={`w-full text-left rounded-lg px-3 py-2 border ${c.bg} ${c.text} hover:shadow-md transition`}
                        >
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`w-2 h-2 rounded-full ${c.dot} shrink-0`} />
                            <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                              {c.label}
                            </span>
                            <span className="font-mono text-[11px] font-bold ml-auto">
                              {b.roomCode}
                            </span>
                          </div>
                          <div className="text-sm font-semibold truncate">
                            {b.projectName}
                          </div>
                          <div className="text-[11px] opacity-80 truncate">
                            {b.userFullName ?? b.userEmail}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}

      <BookingDetailModal
        booking={selected}
        open={!!selected}
        loading={reviewing}
        viewerRole={canEdit ? 'admin' : 'arge'}
        onClose={() => !reviewing && setSelected(null)}
        onReview={canEdit ? review : undefined}
        onAdvanceStage={canEdit ? advanceStage : undefined}
        onRegressStage={canEdit ? regressStage : undefined}
      />
      <ConfirmDialog
        open={!!confirmCancelId}
        title="Randevu iptal edilsin mi?"
        message="Kullanıcının saatli randevusu iptal edilecek. Bu işlem geri alınamaz."
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
