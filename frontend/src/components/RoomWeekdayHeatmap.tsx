/**
 * Oda × gün doluluk ısı-haritası — ONAYLI BOOKING rezervasyonu tabanlı.
 *
 *  - Haftalık görünüm (Pzt–Paz); ‹ Bugün › butonlarıyla hafta ileri/geri.
 *  - Hücre = o gün o odayı kaplayan onaylı rezervasyon sayısı; renk yoğunluğu sayı/maks oranı.
 *  - Hücreye tıklayınca o gün hangi PROJELER'in odayı kapladığı (kullanıcı + tarih aralığı) açılır.
 *  - Realtime: booking onaylanınca/değişince ısı haritası otomatik yenilenir.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import type { ApptHeatmapDay, ApptHeatmapRoom, RoomApptHeatmap, SubjectKind } from '../types';

const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Verilen tarihin içinde bulunduğu haftanın Pazartesi'si (yerel). */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const off = (x.getDay() + 6) % 7; // Pzt=0
  x.setDate(x.getDate() - off);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtD(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

/** count/max oranına göre hücre rengi (cyan yoğunluk). */
function cellStyle(count: number, max: number): { backgroundColor: string; color: string } {
  if (count === 0 || max === 0) {
    return { backgroundColor: 'rgb(241 245 249)', color: 'rgb(148 163 184)' };
  }
  const t = count / max;
  const alpha = 0.18 + t * 0.82;
  return {
    backgroundColor: `rgba(8, 145, 178, ${alpha})`,
    color: t > 0.5 ? 'white' : 'rgb(15 23 42)',
  };
}

interface SelectedCell {
  room: ApptHeatmapRoom;
  day: ApptHeatmapDay;
}

export function RoomWeekdayHeatmap({ kind = 'user' }: { kind?: SubjectKind }) {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [data, setData] = useState<RoomApptHeatmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const from = ymd(weekStart);
  const to = ymd(addDays(weekStart, 6));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.roomAppointmentHeatmap({ from, to });
      setData(res);
    } catch (e) {
      setData(null);
      setError((e as Error)?.message || 'Isı haritası yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Randevu değişimlerinde otomatik yenile (#5).
  useRealtimeEvents(kind, (type) => {
    if (type.startsWith('appointment.') || type === 'booking.reviewed') void load();
  });

  // Açık detay paneli stale kalmasın: veri yenilenince seçili hücreyi tazele.
  useEffect(() => {
    if (!selected || !data) return;
    const room = data.rooms.find((r) => r.roomId === selected.room.roomId);
    const day = room?.days.find((d) => d.date === selected.day.date);
    if (room && day) setSelected({ room, day });
    else setSelected(null);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detay modalı Escape ile kapansın.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const weekLabel = useMemo(() => {
    const s = weekStart;
    const e = addDays(weekStart, 6);
    const f = (d: Date) => d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
    return `${f(s)} – ${f(e)} ${e.getFullYear()}`;
  }, [weekStart]);

  const isThisWeek = ymd(weekStart) === ymd(mondayOf(new Date()));
  const todayStr = ymd(new Date());
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i))),
    [weekStart]
  );

  return (
    <div className="card p-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-kt-green-900">Oda Yoğunluk Isı-Haritası</h2>
          <p className="text-[11px] text-kt-gray-500">
            Oda × gün — seçili haftada hangi gün kaç randevu var. Bir hücreye tıklayıp
            o odanın o gün hangi saatlerde dolu olduğunu gör.
          </p>
        </div>
        {/* Hafta gezinme (#6) */}
        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="btn-ghost text-sm px-2 py-1"
            aria-label="Önceki hafta"
          >
            ‹
          </button>
          <span className="font-semibold text-kt-green-800 tabular-nums whitespace-nowrap min-w-[150px] text-center">
            {weekLabel}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="btn-ghost text-sm px-2 py-1"
            aria-label="Sonraki hafta"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(mondayOf(new Date()))}
            disabled={isThisWeek}
            className="btn-secondary text-xs px-2 py-1 disabled:opacity-40"
          >
            Bu hafta
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse bg-kt-gray-100 rounded-lg" />
      ) : error ? (
        <div className="py-6 text-center space-y-2">
          <div className="text-sm text-red-600">Isı haritası yüklenemedi.</div>
          <div className="text-[11px] text-kt-gray-400">{error}</div>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-semibold text-cyan-700 underline hover:text-cyan-900"
          >
            Tekrar dene
          </button>
        </div>
      ) : !data || data.rooms.length === 0 ? (
        <div className="text-sm text-kt-gray-500 italic py-6 text-center">
          Bu hafta için onaylı rezervasyon yok.
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-separate" style={{ borderSpacing: '3px' }}>
            <thead>
              <tr>
                <th className="text-left text-[11px] font-semibold text-kt-gray-500 px-2 sticky left-0 bg-white">
                  Oda
                </th>
                {weekDates.map((d, i) => {
                  const dayNum = d.slice(8, 10);
                  const isToday = d === todayStr;
                  return (
                    <th
                      key={d}
                      className={`text-center text-[11px] font-semibold px-1 ${i >= 5 ? 'text-kt-gray-400' : 'text-kt-gray-600'}`}
                    >
                      <div>{DAY_LABELS[i]}</div>
                      <div className={isToday ? 'text-cyan-700 font-bold' : 'text-kt-gray-400 font-normal'}>
                        {dayNum}
                      </div>
                    </th>
                  );
                })}
                <th className="text-center text-[11px] font-semibold text-kt-gray-500 px-1">Σ</th>
              </tr>
            </thead>
            <tbody>
              {data.rooms.map((room) => (
                <tr key={room.roomId}>
                  <td className="text-xs font-semibold text-kt-green-900 px-2 whitespace-nowrap sticky left-0 bg-white max-w-[160px] truncate">
                    <span className="text-kt-gray-400 font-normal">{room.code}</span> {room.name}
                  </td>
                  {room.days.map((cell) => {
                    const st = cellStyle(cell.count, data.maxCount);
                    const active = cell.count > 0;
                    const isSel =
                      selected?.room.roomId === room.roomId && selected?.day.date === cell.date;
                    return (
                      <td key={cell.date} className="p-0">
                        <button
                          type="button"
                          disabled={!active}
                          onClick={() => setSelected({ room, day: cell })}
                          style={st}
                          className={`w-9 h-9 rounded-md flex items-center justify-center text-[11px] font-bold tabular-nums mx-auto transition ${
                            active ? 'cursor-pointer hover:ring-2 hover:ring-cyan-400' : 'cursor-default'
                          } ${isSel ? 'ring-2 ring-cyan-600' : ''}`}
                          title={
                            active
                              ? `${room.name} · ${cell.date}: ${cell.count} rezervasyon — detay için tıkla`
                              : `${room.name} · ${cell.date}: rezervasyon yok`
                          }
                        >
                          {active ? cell.count : ''}
                        </button>
                      </td>
                    );
                  })}
                  <td className="text-center text-xs font-bold text-kt-green-800 tabular-nums px-1">
                    {room.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {data && data.maxCount > 0 && (
        <div className="flex items-center gap-2 mt-4 text-[11px] text-kt-gray-500">
          <span>Az</span>
          <div className="flex gap-1">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <div key={t} className="w-5 h-5 rounded" style={cellStyle(Math.round(t * data.maxCount), data.maxCount)} />
            ))}
          </div>
          <span>Yoğun (maks {data.maxCount})</span>
        </div>
      )}

      {/* Hücre detayı — o oda/gün hangi saatlerde dolu (#5) */}
      {selected && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-kt-green-950/60 backdrop-blur-sm animate-fade-in"
        >
          <div
            className="bg-white rounded-2xl shadow-kt-card max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-kt-gray-100 bg-gradient-to-r from-cyan-600 to-cyan-700 text-white flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider opacity-90">Dolu rezervasyonlar</div>
                <h3 className="text-lg font-bold">
                  <span className="font-mono opacity-90">{selected.room.code}</span> {selected.room.name}
                </h3>
                <div className="text-xs opacity-90 mt-0.5">
                  {new Date(`${selected.day.date}T00:00:00`).toLocaleDateString('tr-TR', {
                    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
                  })}{' '}· {selected.day.count} rezervasyon
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center shrink-0"
                aria-label="Kapat"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto scrollbar-thin p-4 space-y-2">
              {selected.day.slots.length === 0 ? (
                <div className="text-sm text-kt-gray-500 italic py-2">Bu gün için rezervasyon yok.</div>
              ) : (
                [...selected.day.slots]
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .map((s, i) => (
                    <div key={i} className="flex items-center gap-3 border border-cyan-200 bg-cyan-50/50 rounded-lg p-2.5">
                      <div className="text-xs font-bold text-cyan-800 tabular-nums whitespace-nowrap">
                        {fmtD(s.start)}–{fmtD(s.end)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-kt-green-900 truncate">{s.title}</div>
                        {s.user && <div className="text-[11px] text-kt-gray-500 truncate">{s.user}</div>}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
