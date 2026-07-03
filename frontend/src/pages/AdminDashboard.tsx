import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { BookingDetailModal } from '../components/BookingDetailModal';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { AdminStats, Booking, BookingStatus, ReviewBookingPayload } from '../types';
import { bookingPeriodLabel } from '../lib/utils';

type StatusFilter = 'all' | BookingStatus;

interface StatCardConfig {
  key: 'total' | 'pending' | 'approved' | 'feedback_requested' | 'rejected';
  label: string;
  filter: StatusFilter;
  icon: JSX.Element;
  /** İkon çipi renkleri — sade tinted background. */
  iconChip: string;
  /** Sol kenar accent şeridi — tek renk semantik ipucu. */
  accentBar: string;
  /** Aktif filtre halkası. */
  ring: string;
  hint: string;
}

const STAT_CARDS: StatCardConfig[] = [
  {
    key: 'pending',
    label: 'Bekleyen',
    filter: 'pending',
    iconChip: 'bg-amber-50 text-amber-700',
    accentBar: 'bg-amber-500',
    ring: 'ring-amber-300',
    hint: 'incelenmeyi bekliyor',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'approved',
    label: 'Onaylanan',
    filter: 'approved',
    iconChip: 'bg-emerald-50 text-emerald-700',
    accentBar: 'bg-emerald-500',
    ring: 'ring-emerald-300',
    hint: 'aktif randevu',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'feedback_requested',
    label: 'Düzeltme İstenen',
    filter: 'feedback_requested',
    iconChip: 'bg-cyan-50 text-cyan-700',
    accentBar: 'bg-cyan-500',
    ring: 'ring-cyan-300',
    hint: 'kullanıcı yanıtı bekleniyor',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    key: 'rejected',
    label: 'Reddedilen',
    filter: 'rejected',
    iconChip: 'bg-rose-50 text-rose-700',
    accentBar: 'bg-rose-500',
    ring: 'ring-rose-300',
    hint: 'arşivlendi',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

const STATUS_TABS: { key: StatusFilter; label: string; accent: string }[] = [
  { key: 'all', label: 'Tümü', accent: 'bg-kt-green-700' },
  { key: 'pending', label: 'Bekleyen', accent: 'bg-kt-gold-500' },
  { key: 'approved', label: 'Onaylanan', accent: 'bg-kt-green-600' },
  { key: 'feedback_requested', label: 'Düzeltme', accent: 'bg-blue-500' },
  { key: 'rejected', label: 'Reddedilen', accent: 'bg-red-500' },
];

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}
function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} g önce`;
  return new Date(iso).toLocaleDateString('tr-TR');
}
function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
}
function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function AdminDashboard() {
  const toast = useToast();
  const { admin } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bookingsRes, statsRes] = await Promise.all([
        api.listAdminBookings(),
        api.adminStats(),
      ]);
      setBookings(bookingsRes.bookings);
      setStats(statsRes.stats);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Veriler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time: yeni booking gelince / status değişince otomatik yenile
  useRealtimeEvents('admin', (type, data) => {
    if (
      type === 'booking.created' ||
      type === 'booking.updated' ||
      type === 'booking.reviewed' ||
      type === 'booking.withdrawn'
    ) {
      load();
      if (type === 'booking.created') {
        const fromWaitlist =
          typeof data === 'object' && data !== null && (data as { fromWaitlist?: boolean }).fromWaitlist;
        toast.push(
          'info',
          fromWaitlist
            ? 'Bekleme listesinden yeni talep oluştu.'
            : 'Yeni talep geldi.'
        );
      }
    }
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (filter !== 'all' && b.status !== filter) return false;
      if (!q) return true;
      return (
        b.projectName.toLowerCase().includes(q) ||
        b.userEmail?.toLowerCase().includes(q) ||
        b.userFullName?.toLowerCase().includes(q) ||
        b.roomCode.toLowerCase().includes(q) ||
        b.roomName.toLowerCase().includes(q)
      );
    });
  }, [bookings, filter, search]);

  const recentActivity = useMemo(() => {
    return [...bookings]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6);
  }, [bookings]);

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
            : 'Düzeltme isteği kullanıcıya iletildi.'
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
      // Modal'ı taze veriyle güncelle (kapatma)
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

  const statValue = (key: StatCardConfig['key']): number => {
    if (!stats) return 0;
    return (stats as unknown as Record<string, number>)[key] ?? 0;
  };

  const totalCount = statValue('total');
  const pendingCount = statValue('pending');

  return (
    <AppShell kind="admin">
      {/* ============ KARŞILAMA BANDI ============ */}
      <section className="mb-6">
        <div className="rounded-2xl bg-white border border-kt-gray-100 overflow-hidden">
          <div className="grid md:grid-cols-[1fr_auto] gap-0">
            {/* Sol — kullanıcı bilgisi + selam (AI banner görseli arka planda) */}
            <div className="relative p-5 md:p-6 flex items-center gap-4 min-w-0 overflow-hidden">
              {/* Arka plan görseli + okunabilirlik için sola beyazlaşan degrade */}
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: 'url("/admin-hero.jpg")' }}
                aria-hidden="true"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/82 to-white/40 pointer-events-none" />
              <div className="relative z-10 shrink-0">
                <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl overflow-hidden bg-kt-green-900 text-white flex items-center justify-center font-extrabold text-lg">
                  <img src="/admin-pp.png" alt="Admin" className="w-full h-full object-cover" />
                </div>
                <span
                  className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white"
                  title="Çevrimiçi"
                />
              </div>
              <div className="relative z-10 min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-kt-gray-500">
                    Yönetim Paneli
                  </span>
                  <span className="role-badge-cyan !mb-0 !py-0.5 !px-2 !text-[10px]">
                    <span className="role-badge-dot bg-cyan-500" />
                    Lab Mühendisi
                  </span>
                </div>
                <h1 className="text-xl md:text-2xl font-extrabold text-kt-green-900 leading-tight truncate">
                  {greeting()}, {admin?.fullName?.split(' ')[0] ?? 'Admin'}.
                </h1>
                <p className="text-kt-gray-500 text-sm mt-1">
                  {pendingCount > 0 ? (
                    <>
                      <strong className="text-kt-green-900">{pendingCount}</strong>{' '}
                      talep incelemenizi bekliyor.
                    </>
                  ) : (
                    'Tüm talepler güncel — bekleyen iş yok.'
                  )}
                </p>
              </div>
            </div>

            {/* Sağ — kompakt stat şeridi (sade, monokrom) */}
            <div className="flex md:flex-col md:items-stretch border-t md:border-t-0 md:border-l border-kt-gray-100">
              <div className="flex-1 px-5 py-3 md:py-4 flex md:flex-col items-center md:items-start gap-2 md:gap-0 border-r md:border-r-0 md:border-b border-kt-gray-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-kt-gray-500 md:order-1">
                  Bekleyen
                </div>
                <div className="text-2xl md:text-3xl font-extrabold text-kt-green-900 leading-none md:mt-1 tabular-nums">
                  {pendingCount}
                </div>
              </div>
              <div className="flex-1 px-5 py-3 md:py-4 flex md:flex-col items-center md:items-start gap-2 md:gap-0 border-r md:border-r-0 md:border-b border-kt-gray-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-kt-gray-500 md:order-1">
                  Toplam
                </div>
                <div className="text-2xl md:text-3xl font-extrabold text-kt-green-900 leading-none md:mt-1 tabular-nums">
                  {totalCount}
                </div>
              </div>
              <button
                onClick={load}
                className="px-4 py-3 md:py-4 hover:bg-kt-gray-50 text-kt-gray-600 hover:text-kt-green-900 font-semibold text-xs transition-colors flex items-center justify-center gap-2"
                title="Verileri yenile"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>Yenile</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ============ STAT KARTLARI ============ */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {STAT_CARDS.map((s) => {
          const isActive = filter === s.filter;
          const value = statValue(s.key);
          return (
            <button
              key={s.key}
              onClick={() => setFilter(s.filter)}
              className={`relative overflow-hidden rounded-2xl bg-white border text-left p-5 transition-shadow duration-200 ${
                isActive
                  ? `border-kt-gray-200 ring-1 ${s.ring} shadow-sm`
                  : 'border-kt-gray-100 hover:shadow-sm'
              }`}
            >
              {/* Sol kenar accent şeridi — tek renk semantik ipucu */}
              <span
                aria-hidden="true"
                className={`absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full ${s.accentBar}`}
              />
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.iconChip}`}
                >
                  {s.icon}
                </div>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-kt-gray-500">
                  {s.label}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[2.25rem] leading-none font-extrabold tabular-nums text-kt-green-900">
                  {value}
                </span>
                <span className="text-xs text-kt-gray-400">/ {totalCount}</span>
              </div>
              <div className="text-xs text-kt-gray-500 mt-1">{s.hint}</div>
            </button>
          );
        })}
      </section>

      {/* ============ İÇERİK: MAIN + SIDEBAR ============ */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* SOL: BOOKING LİSTESİ */}
        <section className="lg:col-span-2 card p-5 md:p-6">
          {/* Search + filter tabs */}
          <div className="flex flex-col gap-4 mb-5">
            <div className="relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-kt-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              <input
                type="search"
                className="input pl-11"
                placeholder="Proje, kullanıcı veya oda kodu ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={60}
              />
            </div>

            <div className="flex flex-wrap gap-1.5 p-1 bg-kt-gray-100 rounded-xl">
              {STATUS_TABS.map((tab) => {
                const isActive = filter === tab.key;
                const count = tab.key === 'all' ? totalCount : statValue(tab.key as StatCardConfig['key']);
                return (
                  <button
                    key={tab.key}
                    onClick={() => setFilter(tab.key)}
                    className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
                      isActive
                        ? 'bg-white text-kt-green-900 shadow-sm'
                        : 'text-kt-gray-500 hover:text-kt-green-800'
                    }`}
                  >
                    {tab.label}
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                      isActive ? 'bg-kt-green-900 text-white' : 'bg-kt-gray-200 text-kt-gray-600'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Liste */}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-kt-gray-100 p-4 animate-pulse h-24" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-kt-green-50 text-kt-green-600 mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-kt-green-900 mb-1">Bu kategoride talep yok</h3>
              <p className="text-kt-gray-500 text-sm">Farklı bir filtre seçin veya arama metnini temizleyin.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className="w-full text-left rounded-xl border border-kt-gray-100 hover:border-kt-gray-200 p-4 transition-shadow duration-200 hover:shadow-sm group focus:outline-none focus:ring-2 focus:ring-kt-gold-400 focus:ring-offset-2"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-kt-green-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {b.userPhoto ? (
                        <img src={b.userPhoto} alt="" className="w-full h-full object-cover" />
                      ) : b.userFullName ? (
                        initials(b.userFullName)
                      ) : (
                        '??'
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[11px] font-bold text-kt-gray-500 tracking-wider tabular-nums">{b.roomCode}</span>
                        <span className="text-kt-gray-300 text-xs">·</span>
                        <span className="text-xs text-kt-gray-500 truncate">{b.roomName}</span>
                        <StatusBadge status={b.status} />
                      </div>
                      <div className="font-bold text-kt-green-900 truncate group-hover:text-kt-green-700 transition-colors">
                        {b.projectName}
                      </div>
                      <div className="text-xs text-kt-gray-600 flex items-center gap-3 flex-wrap mt-1">
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                          {b.userFullName}
                        </span>
                        <span className="flex items-center gap-1 text-kt-gray-400">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                          {fmtDateShort(b.startDate)} → {fmtDateShort(b.endDate)}
                        </span>
                        <span className="text-kt-gray-400">{bookingPeriodLabel(b.period, b.periodMonths)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] text-kt-gray-400">{fmtRelative(b.createdAt)}</div>
                      <div className="text-kt-gray-500 group-hover:text-kt-green-900 font-semibold text-xs mt-1 flex items-center justify-end gap-1 group-hover:gap-2 transition-all">
                        İncele
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* SAĞ: SIDEBAR — son aktivite */}
        <aside className="space-y-6">
          {/* Son aktivite */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-kt-green-900">Son Aktivite</h3>
              <span className="text-[10px] uppercase tracking-wider font-bold text-kt-gray-400">{recentActivity.length} kayıt</span>
            </div>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-kt-gray-500 py-4 text-center">Henüz aktivite yok</p>
            ) : (
              <ul className="space-y-3">
                {recentActivity.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => setSelected(b)}
                      className="w-full text-left flex items-start gap-3 group"
                    >
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        b.status === 'approved' ? 'bg-kt-green-500' :
                        b.status === 'rejected' ? 'bg-red-500' :
                        b.status === 'feedback_requested' ? 'bg-blue-500' : 'bg-kt-gold-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-kt-green-900 truncate group-hover:text-kt-gold-700 transition-colors">
                          {b.projectName}
                        </div>
                        <div className="text-[11px] text-kt-gray-500 mt-0.5">
                          {b.userFullName} · {b.roomCode} · {fmtRelative(b.updatedAt)}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Güvenlik bilgisi */}
          <div className="rounded-2xl p-4 bg-kt-green-50 border border-kt-green-100 text-xs text-kt-green-800">
            <div className="flex items-center gap-2 font-bold mb-1">
              <svg className="w-4 h-4 text-kt-green-700" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
              </svg>
              Güvenli Yönetim
            </div>
            <p className="text-kt-green-700 leading-relaxed">
              Tüm onay/red/feedback aksiyonları audit log'a kaydedilir. RS256 imzalı admin oturumu.
            </p>
          </div>
        </aside>
      </div>

      <BookingDetailModal
        booking={selected}
        open={!!selected}
        loading={reviewing}
        onClose={() => !reviewing && setSelected(null)}
        onReview={review}
        onAdvanceStage={advanceStage}
        onRegressStage={regressStage}
      />
    </AppShell>
  );
}
