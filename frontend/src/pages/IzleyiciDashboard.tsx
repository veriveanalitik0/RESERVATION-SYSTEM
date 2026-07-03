/**
 * İzleyici (salt-okunur görüntüleyici) paneli — `/izleyici`
 *
 *  - Oda doluluk oranları ve odalarda kimlerin olduğu
 *  - Onay bekleyen talepler
 *  - Genel bilgilere read-only erişim (menüden admin görünümleri)
 *
 * Bu rol hiçbir veri değiştiremez: backend'de tüm admin mutasyonları
 * requireAdmin ister; izleyici token'ı yalnız GET'lerden geçer.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { RoomHeroVisual } from '../components/RoomHeroVisual';
import { useToast } from '../components/Toast';
import { api } from '../services/api';
import type { Booking, RoomWithOccupancy } from '../types';

function fmtDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function IzleyiciDashboard() {
  const toast = useToast();
  const [rooms, setRooms] = useState<RoomWithOccupancy[]>([]);
  const [pending, setPending] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [occ, pend] = await Promise.all([
        api.adminRoomsOccupancy(),
        api.listAdminBookings('pending'),
      ]);
      setRooms(occ.rooms);
      setPending(pend.bookings);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Veriler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const occupiedCount = rooms.filter((r) => r.approvedCount > 0).length;

  return (
    <AppShell kind="izleyici">
      <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        Görüntüleme modu — tüm sayfalara salt-okunur erişiminiz var, değişiklik yapamazsınız.
      </div>

      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Genel Bakış</h1>
        <p className="text-kt-gray-500">
          Oda doluluk durumu ve onay bekleyen talepler.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin w-8 h-8 border-3 border-kt-gold-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Stat satırı */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card p-4">
              <div className="text-3xl font-extrabold text-kt-green-900">{rooms.length}</div>
              <div className="text-xs uppercase tracking-wider text-kt-gray-500 mt-1">Toplam Oda</div>
            </div>
            <div className="card p-4">
              <div className="text-3xl font-extrabold text-kt-green-900">
                {occupiedCount}
                <span className="text-base font-semibold text-kt-gray-400"> / {rooms.length}</span>
              </div>
              <div className="text-xs uppercase tracking-wider text-kt-gray-500 mt-1">Dolu Oda</div>
            </div>
            <div className="card p-4">
              <div className="text-3xl font-extrabold text-kt-gold-600">{pending.length}</div>
              <div className="text-xs uppercase tracking-wider text-kt-gray-500 mt-1">Onay Bekleyen</div>
            </div>
          </div>

          {/* Oda doluluk + kimler var */}
          <section>
            <h2 className="text-lg font-bold text-kt-green-900 mb-3">Oda Doluluğu</h2>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {rooms.map((r) => {
                return (
                  <div key={r.id} className="card overflow-hidden flex flex-col">
                    {/* Görsel başlık — kullanıcının oda seçerken gördüğü oda görseli
                        (donanıma göre Mac Studio / NVIDIA DGX Spark / workshop). */}
                    <div className="relative h-32 bg-gradient-to-br from-kt-green-700 to-kt-green-900">
                      <RoomHeroVisual room={r} className="absolute inset-0 w-full h-full" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                      <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-kt-gold-300">
                            {r.code}
                          </div>
                          <div className="font-bold text-white drop-shadow truncate">{r.name}</div>
                        </div>
                        <span
                          className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            r.approvedCount > 0
                              ? 'bg-red-500/90 text-white'
                              : 'bg-emerald-500/90 text-white'
                          }`}
                        >
                          {r.approvedCount > 0 ? 'Dolu' : 'Müsait'}
                        </span>
                      </div>
                    </div>
                    {/* İçerik */}
                    <div className="p-4 flex-1">
                      {r.bookings.length > 0 ? (
                        <ul className="space-y-1.5">
                          {r.bookings.map((b) => (
                            <li key={b.bookingId} className="text-sm text-kt-gray-600">
                              <span className="font-semibold text-kt-green-800">{b.userFullName}</span>
                              {' — '}
                              {b.projectName}
                              <span className="text-xs text-kt-gray-400">
                                {' '}
                                ({fmtDate(b.startDate)} – {fmtDate(b.endDate)})
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-kt-gray-400 italic">Aktif rezervasyon yok.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Onay bekleyen talepler */}
          <section>
            <h2 className="text-lg font-bold text-kt-green-900 mb-3">Onay Bekleyen Talepler</h2>
            {pending.length === 0 ? (
              <p className="text-sm text-kt-gray-400">Bekleyen talep yok.</p>
            ) : (
              <div className="card divide-y divide-kt-gray-100">
                {pending.map((b) => (
                  <div key={b.id} className="p-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-kt-green-900 truncate">{b.projectName}</div>
                      <div className="text-xs text-kt-gray-500">
                        {b.userFullName} · {b.roomCode} · {fmtDate(b.startDate)} – {fmtDate(b.endDate)}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      Onay bekliyor
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
