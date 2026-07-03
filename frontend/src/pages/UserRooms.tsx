import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { BookingModal } from '../components/BookingModal';
import { RoomHeroVisual } from '../components/RoomHeroVisual';
import { WaitlistModal } from '../components/WaitlistModal';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import { RoomDetailModal } from '../components/RoomDetailModal';
import { openDatePicker, roomCategoryKey, roomCategoryLabel, ymdLocal } from '../lib/utils';
import { FEATURES } from '../constants/features';
import type { CreateBookingPayload, JoinWaitlistPayload, Room } from '../types';

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

type CategoryKey = 'all' | 'pod1' | 'pod2' | 'experience' | 'tribune';

const CATEGORY_FILTERS: Array<{ key: CategoryKey; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'pod1', label: 'Tekli Pod' },
  { key: 'pod2', label: 'İkili Pod' },
  { key: 'experience', label: 'Deneyim Alanı' },
  { key: 'tribune', label: 'Tribün' },
];

export default function UserRooms() {
  const toast = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'available'>('all');
  const [category, setCategory] = useState<CategoryKey>('all');
  // Tarih ARALIĞI filtresi: oda [başlangıç, bitiş] boyunca müsaitse listelenir.
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  // "Doluluk sonrası randevu al" ile açıldığında booking modalına geçilecek başlangıç tarihi.
  const [bookAfterDate, setBookAfterDate] = useState<string | null>(null);
  const [detailRoom, setDetailRoom] = useState<Room | null>(null);
  const [waitlistRoom, setWaitlistRoom] = useState<Room | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listUserRooms(filterStart || undefined, filterEnd || undefined);
      setRooms(res.rooms);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Odalar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast, filterStart, filterEnd]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // Real-time: başka kullanıcı booking yapınca availability güncellensin
  useRealtimeEvents('user', (type) => {
    if (
      type === 'booking.created' ||
      type === 'booking.updated' ||
      type === 'booking.reviewed' ||
      type === 'booking.withdrawn'
    ) {
      loadRooms();
    }
  });

  async function submitWaitlist(payload: JoinWaitlistPayload) {
    setJoining(true);
    try {
      await api.joinWaitlist(payload);
      toast.push('success', 'Bekleme listesine eklendiniz. Oda boşalınca otomatik bilgilendirileceksiniz.');
      setWaitlistRoom(null);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Sıraya yazılamadı.');
    } finally {
      setJoining(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms.filter((r) => {
      // Tarih aralığı filtresi aktifse liste DARALIR: yalnız o aralıkta müsait odalar
      // listelenir (isAvailable backend'de aralığa göre hesaplanır). Dolu odalar gizlenir.
      if (filterStart && !r.isAvailable) return false;
      if (filter === 'available' && !r.isAvailable) return false;
      if (category !== 'all' && roomCategoryKey(r.roomType, r.capacity) !== category) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.equipment.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rooms, search, filter, category, filterStart]);

  // Tarih aralığı filtresinde gizlenen (o aralıkta dolu) oda sayısı — kullanıcı
  // listenin daraldığını bilsin ve isterse filtreyi temizlesin.
  const hiddenBusyOnDate = useMemo(
    () => (filterStart ? rooms.filter((r) => !r.isAvailable).length : 0),
    [rooms, filterStart]
  );

  // Aralık etiketi: "12 Temmuz – 20 Temmuz" veya tek gün "12 Temmuz günü".
  const rangeLabel = useMemo(() => {
    if (!filterStart) return '';
    const fmt = (d: string) => new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    return filterEnd && filterEnd !== filterStart
      ? `${fmt(filterStart)} – ${fmt(filterEnd)}`
      : `${fmt(filterStart)} günü`;
  }, [filterStart, filterEnd]);

  async function submitBooking(payload: CreateBookingPayload) {
    setSubmitting(true);
    try {
      const res = await api.createBooking(payload);
      toast.push('success', 'Talebiniz başarıyla alındı ve onay sürecine iletildi. Sonuçlandığında bilgilendirileceksiniz.');
      // Otomatik duplicate-tespiti (#4): çok benzer mevcut proje varsa bilgilendir.
      if (res.duplicateWarning) {
        const d = res.duplicateWarning;
        toast.push(
          'info',
          `Not: "${d.projectName}" projesine %${(d.similarity * 100).toFixed(0)} benziyor` +
            (d.isOwn ? ' (sizin geçmiş projeniz).' : '.')
        );
      }
      setSelectedRoom(null);
      setBookAfterDate(null);
      await loadRooms();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Talep gönderilemedi.');
    } finally {
      setSubmitting(false);
    }
  }

  const availableCount = rooms.filter((r) => r.isAvailable).length;

  return (
    <AppShell kind="user">
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">AI Lab Odaları</h1>
            <p className="text-kt-gray-500">
              {availableCount} / {rooms.length} oda müsait · Merkez bina
            </p>
          </div>
          <Link to="/bookings" className="btn-secondary md:hidden">
            Taleplerim →
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-kt-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="search"
              className="input pl-11"
              placeholder="Oda adı veya kod ile ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={60}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                filter === 'all' ? 'bg-kt-green-800 text-white' : 'bg-white border border-kt-gray-200 text-kt-green-700'
              }`}
            >
              Tümü ({rooms.length})
            </button>
            <button
              onClick={() => setFilter('available')}
              className={`px-4 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                filter === 'available' ? 'bg-emerald-600 text-white' : 'bg-white border border-kt-gray-200 text-kt-green-700'
              }`}
            >
              Müsait ({availableCount})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {CATEGORY_FILTERS.map((c) => {
            const count =
              c.key === 'all'
                ? rooms.length
                : rooms.filter((r) => roomCategoryKey(r.roomType, r.capacity) === c.key).length;
            return (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  category === c.key
                    ? 'bg-kt-violet-700 text-white border-kt-violet-700'
                    : 'bg-white border-kt-gray-200 text-kt-gray-600 hover:border-kt-violet-300'
                }`}
              >
                {c.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-xs font-semibold text-kt-gray-600">Tarih aralığında müsait:</span>
          <input
            id="rooms-start"
            type="date"
            aria-label="Başlangıç tarihi"
            value={filterStart}
            min={ymdLocal()}
            onChange={(e) => {
              const v = e.target.value;
              setFilterStart(v);
              // Bitiş başlangıçtan önceyse sıfırla.
              if (filterEnd && v && filterEnd < v) setFilterEnd('');
            }}
            onClick={openDatePicker}
            className="px-3 py-1.5 rounded-lg border border-kt-gray-200 text-sm text-kt-green-800 focus:border-kt-violet-400 outline-none"
          />
          <span className="text-xs text-kt-gray-400">→</span>
          <input
            id="rooms-end"
            type="date"
            aria-label="Bitiş tarihi"
            value={filterEnd}
            min={filterStart || ymdLocal()}
            disabled={!filterStart}
            onChange={(e) => setFilterEnd(e.target.value)}
            onClick={openDatePicker}
            title={!filterStart ? 'Önce başlangıç tarihi seçin' : 'Bitiş tarihi (opsiyonel)'}
            className="px-3 py-1.5 rounded-lg border border-kt-gray-200 text-sm text-kt-green-800 focus:border-kt-violet-400 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {filterStart && (
            <>
              <button
                onClick={() => {
                  setFilterStart('');
                  setFilterEnd('');
                }}
                className="text-xs font-semibold text-kt-violet-700 hover:text-kt-violet-900"
              >
                Temizle
              </button>
              <span className="text-xs text-kt-gray-500">
                {rangeLabel} arası müsait odalar
                {hiddenBusyOnDate > 0 && (
                  <span className="text-kt-gold-700"> · {hiddenBusyOnDate} dolu oda gizlendi</span>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-3 bg-kt-gray-100 rounded w-12 mb-3" />
              <div className="h-5 bg-kt-gray-100 rounded w-3/4 mb-2" />
              <div className="h-4 bg-kt-gray-100 rounded w-1/2 mb-4" />
              <div className="h-8 bg-kt-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🔍</div>
          {filterStart ? (
            <>
              <h3 className="text-xl font-bold text-kt-green-800 mb-2">
                Bu tarih aralığında müsait oda yok
              </h3>
              <p className="text-kt-gray-500 mb-4">
                {rangeLabel} için tüm odalar dolu{hiddenBusyOnDate > 0 ? ` (${hiddenBusyOnDate} oda)` : ''}.
                Başka bir aralık deneyin veya filtreyi temizleyin.
              </p>
              <button
                onClick={() => {
                  setFilterStart('');
                  setFilterEnd('');
                }}
                className="btn-primary text-sm"
              >
                Tarih filtresini temizle
              </button>
            </>
          ) : (
            <>
              <h3 className="text-xl font-bold text-kt-green-800 mb-2">Eşleşen oda bulunamadı</h3>
              <p className="text-kt-gray-500">Arama kriterlerini değiştirip tekrar deneyin.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((room) => (
            <article key={room.id} className="card-hover overflow-hidden group">
              <button
                type="button"
                onClick={() => setDetailRoom(room)}
                className="relative h-36 overflow-hidden w-full block text-left"
                aria-label={`${room.name} — detay ve özellikler`}
              >
                {/* Cihaz bazlı modern AI görseli */}
                <RoomHeroVisual
                  room={room}
                  className="absolute inset-0 w-full h-full group-hover:scale-105 transition-transform duration-500"
                />
                {/* Alt gradient — text okunabilirliği için */}
                <div className="absolute inset-0 bg-gradient-to-t from-kt-green-950/70 via-transparent to-kt-green-900/30" />

                <div className="absolute top-3 left-3">
                  <span className="px-2 py-0.5 rounded-md bg-white/25 backdrop-blur text-white text-xs font-bold tracking-wider">
                    {roomCategoryLabel(room.roomType, room.capacity)}
                  </span>
                </div>
                <div className="absolute top-3 right-3">
                  {room.isAvailable
                    ? <span className="badge-available">● Müsait</span>
                    : <span className="badge-unavailable">● Dolu</span>}
                </div>
                <div className="absolute bottom-3 left-3 text-white drop-shadow-lg max-w-[75%]">
                  <div className="text-lg font-extrabold leading-tight truncate">
                    {room.name}
                  </div>
                  <div className="text-xs opacity-90 font-medium truncate">
                    {room.equipment}
                  </div>
                </div>
                <div className="absolute bottom-3 right-3">
                  <span className="px-2 py-0.5 rounded-md bg-kt-gold-500/95 text-kt-green-900 text-[10px] font-bold uppercase tracking-wider">
                    {room.capacity === 1 ? '1 kişi' : `${room.capacity} kişi`}
                  </span>
                </div>
              </button>

              <div className="p-4">
                {room.equipment && (
                  <div className="inline-flex items-center gap-1.5 mb-3 px-2 py-1 rounded-md bg-kt-violet-100 text-kt-violet-800 text-[11px] font-semibold border border-kt-violet-300">
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    {room.equipment}
                  </div>
                )}
                <p className="text-sm text-kt-gray-600 line-clamp-2 mb-2 min-h-[40px]">
                  {room.description}
                </p>
                <button
                  type="button"
                  onClick={() => setDetailRoom(room)}
                  className="text-xs font-semibold text-kt-violet-700 hover:text-kt-violet-900 mb-3 inline-flex items-center gap-1"
                >
                  Devamını göster →
                </button>

                {/* Müsait vakitler — haftanın boş günleri (yalnız gün-bazlı mod) */}
                {FEATURES.weekdaySelection && (
                  <div className="mb-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-kt-gray-400 mb-1">
                      Müsait günler
                    </div>
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
                            title={free ? `${l}: müsait` : `${l}: dolu`}
                          >
                            {l}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Müsaitlik durumu — full-week modda tarih bazlı net bilgi.
                    Tarih filtresi aktifse durum O TARİHE göredir. */}
                <div className="mb-3">
                  {(() => {
                    const dateLabel = filterStart ? rangeLabel : null;
                    if (room.isAvailable) {
                      return (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {dateLabel ? `${dateLabel} arası müsait` : 'Randevuya uygun'}
                        </span>
                      );
                    }
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-kt-gold-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-kt-gold-500" />
                        {dateLabel
                          ? `${dateLabel} arası dolu`
                          : room.nextAvailableDate
                            ? `${new Date(room.nextAvailableDate).toLocaleDateString('tr-TR')} tarihine kadar dolu`
                            : 'Şu an dolu'}
                      </span>
                    );
                  })()}
                </div>

                <div className="flex items-center justify-between text-xs text-kt-gray-500 mb-4">
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                    {room.capacity === 1 ? '1 kişilik' : `${room.capacity} kişilik`}
                  </span>
                </div>
                {room.isAvailable ? (
                  <button
                    onClick={() => setSelectedRoom(room)}
                    className="btn-primary w-full text-sm"
                  >
                    Randevu Al
                  </button>
                ) : (
                  <button
                    onClick={() => setWaitlistRoom(room)}
                    className="w-full text-sm px-4 py-2.5 rounded-xl bg-kt-gold-50 text-kt-gold-800 border border-kt-gold-200 font-semibold hover:bg-kt-gold-100 transition-colors"
                  >
                    Sıraya gir
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <BookingModal
        room={selectedRoom}
        open={!!selectedRoom}
        loading={submitting}
        initialStartDate={bookAfterDate || filterStart || undefined}
        onClose={() => {
          if (submitting) return;
          setSelectedRoom(null);
          setBookAfterDate(null);
        }}
        onSubmit={submitBooking}
      />

      <WaitlistModal
        room={waitlistRoom}
        open={!!waitlistRoom}
        loading={joining}
        initialStartDate={filterStart || undefined}
        onClose={() => !joining && setWaitlistRoom(null)}
        onSubmit={submitWaitlist}
      />

      <RoomDetailModal
        room={detailRoom}
        open={!!detailRoom}
        onClose={() => setDetailRoom(null)}
        onBook={(r) => {
          setDetailRoom(null);
          if (r.isAvailable) setSelectedRoom(r);
          else setWaitlistRoom(r);
        }}
        onBookAfter={(r, startDate) => {
          setDetailRoom(null);
          setBookAfterDate(startDate);
          setSelectedRoom(r);
        }}
      />
    </AppShell>
  );
}
