/**
 * Admin "Projeler" sayfası — onaylı booking'lerin yaşam döngüsü panosu.
 *
 *   application → development → stage → production → live
 *
 * Talepler (AdminDashboard) "incele/onayla" inbox'ıdır; Projeler ise onaylanmış
 * çalışmaların ilerleme görünümüdür. Admin buradan:
 *  - Hangi proje hangi aşamada görür
 *  - Bir projeyi bir sonraki aşamaya manuel ilerletir
 *  - Proje sahibi + oda + tarih bilgisini tek bakışta görür
 *
 * Lisanslar (AdminLicenses) ile karıştırılmaz — o ayrı bir akış (license_requests).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useViewerKind } from '../hooks/useViewerKind';
import { BookingDetailModal } from '../components/BookingDetailModal';
import { ProjectLifecycleBar } from '../components/governance/ProjectLifecycleBar';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { Booking, LifecycleStage, ReviewBookingPayload } from '../types';
import { bookingPeriodLabel } from '../lib/utils';

type StageFilter = 'all' | LifecycleStage | 'swat' | 'advance_pending';

const STAGE_META: Record<LifecycleStage, { label: string; cls: string }> = {
  application: { label: 'Başvuru', cls: 'bg-kt-gray-100 text-kt-gray-700 border-kt-gray-300' },
  development: { label: 'Geliştirme', cls: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
  stage:       { label: 'Stage',      cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  production:  { label: 'Production', cls: 'bg-kt-violet-100 text-kt-violet-700 border-kt-violet-300' },
  live:        { label: 'Canlı',      cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
};

const STAGE_ORDER: LifecycleStage[] = [
  'application',
  'development',
  'stage',
  'production',
  'live',
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

export default function AdminProjects() {
  const toast = useToast();
  const viewerKind = useViewerKind();
  const canEdit = viewerKind === 'admin';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Booking | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listAdminBookings('approved');
      setBookings(res.bookings);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Projeler yüklenemedi.');
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
      type === 'booking.withdrawn'
    ) {
      void load();
    }
  });

  const stageCounts = useMemo(() => {
    const counts: Record<LifecycleStage, number> = {
      application: 0,
      development: 0,
      stage: 0,
      production: 0,
      live: 0,
    };
    for (const b of bookings) counts[b.lifecycleStage]++;
    return counts;
  }, [bookings]);

  const swatCount = useMemo(
    () => bookings.filter((b) => b.reviewTrack === 'swat').length,
    [bookings]
  );
  const advancePendingCount = useMemo(
    () => bookings.filter((b) => !!b.stageAdvanceRequestedAt).length,
    [bookings]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (stageFilter === 'swat' && b.reviewTrack !== 'swat') return false;
      if (stageFilter === 'advance_pending' && !b.stageAdvanceRequestedAt) return false;
      if (
        stageFilter !== 'all' &&
        stageFilter !== 'swat' &&
        stageFilter !== 'advance_pending' &&
        b.lifecycleStage !== stageFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        b.projectName.toLowerCase().includes(q) ||
        (b.userFullName ?? '').toLowerCase().includes(q) ||
        (b.userEmail ?? '').toLowerCase().includes(q) ||
        b.roomCode.toLowerCase().includes(q)
      );
    });
  }, [bookings, stageFilter, search]);

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
            ? 'Proje onaylandı.'
            : payload.action === 'reject'
            ? 'Proje reddedildi.'
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

  async function quickAdvance(b: Booking) {
    try {
      const res = await api.adminAdvanceBookingStage(b.id);
      toast.push(
        'success',
        `${b.projectName} → ${STAGE_META[res.booking.lifecycleStage].label}`
      );
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Aşama ilerletilemedi.');
    }
  }

  async function quickRegress(b: Booking) {
    try {
      const res = await api.adminRegressBookingStage(b.id);
      toast.push(
        'info',
        `${b.projectName} ← ${STAGE_META[res.booking.lifecycleStage].label}`
      );
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Aşama geri alınamadı.');
    }
  }

  async function toggleSwat(b: Booking) {
    const target = b.reviewTrack === 'swat' ? 'standard' : 'swat';
    try {
      await api.adminSetBookingReviewTrack(b.id, target);
      toast.push(
        'success',
        target === 'swat'
          ? `${b.projectName} Analitik Danışman'a iletildi.`
          : `${b.projectName} standart akışa alındı.`
      );
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    }
  }

  async function rejectAdvanceRequest(b: Booking) {
    try {
      await api.adminRejectStageAdvanceRequest(b.id);
      toast.push('info', 'Aşama ilerletme talebi reddedildi.');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    }
  }

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
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Projeler</h1>
        <p className="text-kt-gray-500 text-sm">
          Onaylı projelerin yaşam döngüsü — kullanıcı talepleri sonrası geliştirme,
          stage ve production aşamalarını izleyin, manuel ilerletin.
        </p>
      </div>

      {/* Aşama özet chip'leri (clickable filter) */}
      <div className="card p-4 mb-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <div className="flex gap-2 flex-wrap text-sm">
          <button
            type="button"
            onClick={() => setStageFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              stageFilter === 'all'
                ? 'bg-kt-green-700 text-white shadow-kt-green'
                : 'bg-kt-gray-100 text-kt-gray-700 hover:bg-kt-gray-200'
            }`}
          >
            Tümü ({bookings.length})
          </button>
          {STAGE_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStageFilter(stageFilter === s ? 'all' : s)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition border ${
                stageFilter === s
                  ? STAGE_META[s].cls + ' ring-2 ring-offset-1 ring-kt-gold-400'
                  : STAGE_META[s].cls + ' opacity-70 hover:opacity-100'
              }`}
            >
              {STAGE_META[s].label}{' '}
              <span className="opacity-80">({stageCounts[s]})</span>
            </button>
          ))}
          <span className="w-px h-6 bg-kt-gray-200 mx-1 self-center hidden md:block" />
          <button
            type="button"
            onClick={() => setStageFilter(stageFilter === 'swat' ? 'all' : 'swat')}
            className={`px-3 py-1.5 rounded-lg font-bold transition border bg-rose-100 text-rose-800 border-rose-300 ${
              stageFilter === 'swat'
                ? 'ring-2 ring-offset-1 ring-rose-400'
                : 'opacity-70 hover:opacity-100'
            }`}
            title="SWAT (fast-track) inceleme akışındaki projeler"
          >
            ⚡ SWAT <span className="opacity-80">({swatCount})</span>
          </button>
          <button
            type="button"
            onClick={() =>
              setStageFilter(stageFilter === 'advance_pending' ? 'all' : 'advance_pending')
            }
            className={`px-3 py-1.5 rounded-lg font-bold transition border bg-amber-100 text-amber-900 border-amber-300 ${
              stageFilter === 'advance_pending'
                ? 'ring-2 ring-offset-1 ring-amber-400'
                : 'opacity-70 hover:opacity-100'
            }`}
            title="Kullanıcı tarafından aşama ilerletme talebi gelmiş projeler"
          >
            ⏰ Talep <span className="opacity-80">({advancePendingCount})</span>
          </button>
        </div>
        <div className="relative md:max-w-xs flex-1">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-kt-gray-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="search"
            className="input pl-10"
            placeholder="Proje, kullanıcı, oda ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={60}
          />
        </div>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-44" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={bookings.length === 0 ? 'showcase' : 'data'}
          tone="cyan"
          title={bookings.length === 0 ? 'Henüz onaylı bir proje yok' : 'Bu filtreyle eşleşen proje yok'}
          description={
            bookings.length === 0
              ? 'Danışman onayından geçen randevular burada yaşam döngüsü ile birlikte listelenecek.'
              : 'Filtreleri sıfırlayıp tüm projelere bakın veya farklı bir arama deneyin.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((b) => {
            // Defensive: bazı onaylı booking kayıtlarında lifecycleStage henüz
            // backend DTO'ya eklenmemiş olabilir — 'development' default'u kullan.
            const stage = b.lifecycleStage ?? 'development';
            const idx = STAGE_ORDER.indexOf(stage);
            const isTerminal = idx >= STAGE_ORDER.length - 1;
            const isAtStart = idx <= 1; // development
            const nextStage = !isTerminal ? STAGE_ORDER[idx + 1] : null;
            const prevStage = !isAtStart ? STAGE_ORDER[idx - 1] : null;
            const meta = STAGE_META[stage] ?? STAGE_META.development;
            const isSwat = b.reviewTrack === 'swat';
            const hasAdvanceRequest = !!b.stageAdvanceRequestedAt;
            return (
              <article
                key={b.id}
                className={`card p-5 hover:shadow-kt-card transition cursor-pointer ${
                  hasAdvanceRequest ? 'ring-2 ring-amber-300' : ''
                } ${isSwat ? 'border-rose-300' : ''}`}
                onClick={() => setSelected(b)}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  {b.showcaseImageUrl && (
                    <img
                      src={b.showcaseImageUrl}
                      alt=""
                      className="w-14 h-14 rounded-lg object-cover border border-kt-gray-200 shrink-0"
                      loading="lazy"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-mono font-bold text-kt-gold-700 tracking-wider">
                        {b.roomCode}
                      </span>
                      {isSwat && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300">
                          ⚡ SWAT
                        </span>
                      )}
                      <span className="text-kt-gray-300">·</span>
                      <span className="text-xs text-kt-gray-500 truncate">
                        {b.userFullName ?? b.userEmail}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-kt-green-900 truncate">
                      {b.projectName}
                    </h3>
                    <div className="text-xs text-kt-gray-500 mt-0.5">
                      {fmtDate(b.startDate)} – {fmtDate(b.endDate)} · {bookingPeriodLabel(b.period, b.periodMonths)}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-1 rounded-md border shrink-0 ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                </div>

                <div className="my-3">
                  <ProjectLifecycleBar stage={stage} />
                </div>

                {/* Bekleyen kullanıcı talebi */}
                {hasAdvanceRequest && (
                  <div className="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs">
                    <div className="flex items-start gap-2 mb-2">
                      <svg
                        className="w-4 h-4 mt-0.5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                        />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold mb-0.5">
                          Aşama ilerletme talebi
                        </div>
                        <div className="opacity-90 text-[11px]">
                          {new Date(b.stageAdvanceRequestedAt!).toLocaleString('tr-TR', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {b.stageAdvanceNote && (
                            <div className="italic mt-0.5">"{b.stageAdvanceNote}"</div>
                          )}
                        </div>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void rejectAdvanceRequest(b);
                          }}
                          className="text-[11px] font-semibold px-2 py-1 rounded bg-white text-rose-700 border border-rose-300 hover:bg-rose-50"
                        >
                          Reddet
                        </button>
                        {nextStage && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void quickAdvance(b);
                            }}
                            className="text-[11px] font-semibold px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            ✓ Onayla → {STAGE_META[nextStage].label}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-xs text-kt-gray-500">
                  <span>
                    {meta.label} aşamasında{' '}
                    <strong className="text-kt-green-800">
                      {daysSince(b.stageEnteredAt)} gün
                    </strong>
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleSwat(b);
                        }}
                        className={`text-[10px] font-bold px-2 py-1 rounded transition ${
                          isSwat
                            ? 'bg-kt-gray-200 text-kt-gray-700 hover:bg-kt-gray-300'
                            : 'bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-300'
                        }`}
                        title={isSwat ? 'İletimi geri al — standart akışa dön' : 'Analitik Danışmana ilet'}
                      >
                        {isSwat ? 'İletimi Geri Al' : '→ Analitik Danışmana İlet'}
                      </button>
                    )}
                    {canEdit && prevStage && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void quickRegress(b);
                        }}
                        className="text-xs font-semibold px-2 py-1.5 rounded-md text-kt-gray-700 hover:bg-kt-gray-100 border border-kt-gray-200 transition"
                        title={`${STAGE_META[prevStage].label} aşamasına geri al`}
                      >
                        ← {STAGE_META[prevStage].label}
                      </button>
                    )}
                    {canEdit && nextStage && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void quickAdvance(b);
                        }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md bg-kt-green-700 text-white hover:bg-kt-green-800 transition"
                      >
                        → {STAGE_META[nextStage].label}
                      </button>
                    )}
                    {!nextStage && (
                      <span className="text-[11px] font-semibold text-emerald-700">
                        ● Canlıda
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
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
    </AppShell>
  );
}
