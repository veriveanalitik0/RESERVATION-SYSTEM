/**
 * Admin waitlist sayfası — tüm bekleme kayıtlarını oda bazında görüntüler.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { WaitlistEntry } from '../types';
import { bookingPeriodLabel } from '../lib/utils';

function statusInfo(status: WaitlistEntry['status']): { label: string; cls: string } {
  switch (status) {
    case 'waiting':
      return { label: 'Sırada', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
    case 'promoted':
      return { label: 'Promote edildi', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    case 'expired':
      return { label: 'Süresi geçti', cls: 'bg-kt-gray-100 text-kt-gray-600 border-kt-gray-200' };
    case 'cancelled':
      return { label: 'İptal', cls: 'bg-rose-100 text-rose-700 border-rose-200' };
  }
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AdminWaitlist() {
  const toast = useToast();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'waiting' | 'promoted' | 'expired'>('waiting');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminListWaitlist();
      setEntries(res.entries);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  /** Bir kaydı sırada öne al / yukarı / aşağı taşır. */
  async function handleMove(id: string, move: 'up' | 'down' | 'top') {
    if (moving) return;
    setMoving(true);
    try {
      const res = await api.adminMoveWaitlist(id, move);
      setEntries(res.entries);
      toast.push('success', move === 'top' ? 'Kayıt sıranın başına alındı.' : 'Sıra güncellendi.');
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setMoving(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeEvents('admin', (type) => {
    if (type === 'waitlist.changed') load();
  });

  const filtered = useMemo(
    () =>
      filter === 'all'
        ? entries
        : entries.filter((e) => e.status === filter),
    [entries, filter]
  );

  const groupedByRoom = useMemo(() => {
    const map = new Map<string, { code: string; name: string; entries: WaitlistEntry[] }>();
    for (const e of filtered) {
      const key = e.roomId;
      if (!map.has(key)) map.set(key, { code: e.roomCode, name: e.roomName, entries: [] });
      map.get(key)!.entries.push(e);
    }
    // Her oda içinde position'a göre sırala (öncelik sırası).
    for (const g of map.values()) {
      g.entries.sort((a, b) => a.position - b.position);
    }
    return [...map.values()].sort((a, b) => b.entries.length - a.entries.length);
  }, [filtered]);

  const counts = useMemo(() => {
    return {
      all: entries.length,
      waiting: entries.filter((e) => e.status === 'waiting').length,
      promoted: entries.filter((e) => e.status === 'promoted').length,
      expired: entries.filter((e) => e.status === 'expired').length,
    };
  }, [entries]);

  return (
    <AppShell kind="admin">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Bekleme Listesi</h1>
          <p className="text-kt-gray-500 text-sm">
            Oda dolduğunda sıraya yazılan kullanıcılar. Oda boşalınca otomatik talep oluşur.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 p-1 bg-kt-gray-100 rounded-xl mb-5">
        {(['all', 'waiting', 'promoted', 'expired'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${
              filter === f ? 'bg-white text-kt-green-900 shadow-kt-soft' : 'text-kt-gray-500'
            }`}
          >
            {f === 'all' ? 'Tümü' : statusInfo(f as WaitlistEntry['status']).label}
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-kt-gray-200 text-kt-gray-600">
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : groupedByRoom.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🕐</div>
          <h3 className="text-xl font-bold text-kt-green-800 mb-2">Bu kategoride kayıt yok</h3>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedByRoom.map((g) => (
            <section key={g.code} className="card p-5">
              <header className="flex items-center justify-between mb-3 pb-3 border-b border-kt-gray-100">
                <div>
                  <div className="text-[11px] font-bold text-kt-gold-700 tracking-wider">
                    {g.code}
                  </div>
                  <h2 className="text-lg font-bold text-kt-green-900">{g.name}</h2>
                </div>
                <span className="text-xs font-bold text-kt-gray-500 uppercase tracking-wider">
                  {g.entries.length} kayıt
                </span>
              </header>
              {(() => {
                const waitingIds = g.entries
                  .filter((e) => e.status === 'waiting')
                  .map((e) => e.id);
                return (
                  <ul className="divide-y divide-kt-gray-100">
                    {g.entries.map((e) => {
                      const s = statusInfo(e.status);
                      const wIdx = waitingIds.indexOf(e.id);
                      const isWaiting = e.status === 'waiting';
                      return (
                        <li key={e.id} className="py-3 flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-kt-gold-100 text-kt-gold-700 flex items-center justify-center font-bold text-xs shrink-0">
                            #{e.position}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${s.cls}`}>
                                {s.label}
                              </span>
                              <span className="text-xs text-kt-gray-600 truncate">
                                {e.userFullName ?? e.userEmail}
                              </span>
                            </div>
                            <div className="font-semibold text-kt-green-900 truncate">
                              {e.projectName}
                            </div>
                            <div className="text-xs text-kt-gray-500 mt-0.5">
                              {fmtDate(e.desiredStartDate)} · {bookingPeriodLabel(e.period, e.periodMonths)}
                            </div>
                          </div>
                          {isWaiting && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleMove(e.id, 'top')}
                                disabled={moving || wIdx === 0}
                                title="Sıranın başına al"
                                className="text-[11px] font-bold px-2 py-1 rounded-md bg-kt-gold-50 text-kt-gold-700 hover:bg-kt-gold-100 disabled:opacity-40 transition-colors"
                              >
                                Öne Al
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMove(e.id, 'up')}
                                disabled={moving || wIdx === 0}
                                title="Yukarı taşı"
                                className="w-7 h-7 rounded-md bg-kt-gray-100 text-kt-gray-600 hover:bg-kt-gray-200 disabled:opacity-40 transition-colors font-bold"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMove(e.id, 'down')}
                                disabled={moving || wIdx === waitingIds.length - 1}
                                title="Aşağı taşı"
                                className="w-7 h-7 rounded-md bg-kt-gray-100 text-kt-gray-600 hover:bg-kt-gray-200 disabled:opacity-40 transition-colors font-bold"
                              >
                                ↓
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
