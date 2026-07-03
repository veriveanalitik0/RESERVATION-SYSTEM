/**
 * YZ / Ar-Ge Mühendisi Dashboard — `/arge`
 *
 * RACI: R/A "Stage onayı", "Production onayı", "Rollback kararı".
 * Görev: onaylı projeleri yaşam döngüsünde ileri (advance) ya da geri (regress)
 * götürür; kullanıcıların aşama ilerletme taleplerini onaylar veya reddeder.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { ProjectLifecycleBar } from '../components/governance/ProjectLifecycleBar';
import { EmptyState } from '../components/EmptyState';
import { BookingDetailModal } from '../components/BookingDetailModal';
import { KpiCard } from '../components/KpiCard';
import { Inbox, FlaskConical, Rocket } from 'lucide-react';
import { SlaBadge } from '../components/governance/SlaBadge';
import type { SlaInfo } from '../types';

/** Ar-Ge için stage/production aşamasında bekleyen onayın SLA'sı.
 *  Stage onayı 4 saat, Production onayı 1 iş günü (24 saat) — kullanıcı talebi varsa
 *  o tarihten itibaren hesaplanır, yoksa null (manuel ilerleme gerekmiyor demek). */
function computeStageSla(b: Booking): SlaInfo | null {
  if (!b.stageAdvanceRequestedAt) return null;
  const slaHours = b.lifecycleStage === 'production' ? 24 : 4;
  const created = new Date(b.stageAdvanceRequestedAt).getTime();
  const deadlineMs = created + slaHours * 3600 * 1000;
  const remainingHours = (deadlineMs - Date.now()) / 3600 / 1000;
  return {
    checkpoint: b.lifecycleStage === 'production' ? 'Production Onayı' : 'Stage Onayı',
    deadline: new Date(deadlineMs).toISOString(),
    slaHours,
    remainingHours: Math.round(remainingHours * 10) / 10,
    overdue: remainingHours < 0,
  };
}
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { Booking, LifecycleStage } from '../types';

const STAGE_ORDER: LifecycleStage[] = [
  'application',
  'development',
  'stage',
  'production',
  'live',
];

const STAGE_META: Record<LifecycleStage, { label: string; cls: string }> = {
  application: { label: 'Başvuru', cls: 'bg-kt-gray-50 text-kt-gray-700 border-kt-gray-200' },
  development: { label: 'Geliştirme', cls: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  stage: { label: 'Stage', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  production: { label: 'Production', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  live: { label: 'Canlı', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

/** Filter chip class — sade ve tutarlı. Active = navy primary, idle = neutral outline.
 *  Tüm aşamalar idle'da aynı renk: monokrom dashboard hissi. */
function stageFilterClass(_stage: LifecycleStage, isActive: boolean): string {
  if (isActive) return 'btn-pill-primary';
  return 'bg-white text-kt-gray-700 border border-kt-gray-200 hover:bg-kt-gray-50 hover:border-kt-gray-300';
}

type Filter = 'all' | LifecycleStage | 'advance_pending';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit' });
}
function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export default function ArgeDashboard() {
  const toast = useToast();
  const [projects, setProjects] = useState<Booking[]>([]);
  const [counts, setCounts] = useState({
    total: 0,
    withAdvanceRequest: 0,
    inStage: 0,
    inProduction: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);
  // Detay modal — projeye tıklayınca BookingDetailModal açılır (viewerRole='arge').
  const [detailId, setDetailId] = useState<string | null>(null);
  const selectedDetail = useMemo(
    () => (detailId ? projects.find((p) => p.id === detailId) ?? null : null),
    [projects, detailId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.argeProjects();
      setProjects(res.projects);
      setCounts(res.counts);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeEvents('arge', (type) => {
    if (type.startsWith('booking.')) void load();
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((b) => {
      if (filter === 'advance_pending' && !b.stageAdvanceRequestedAt) return false;
      if (
        filter !== 'all' &&
        filter !== 'advance_pending' &&
        b.lifecycleStage !== filter
      )
        return false;
      if (!q) return true;
      return (
        b.projectName.toLowerCase().includes(q) ||
        (b.userFullName ?? '').toLowerCase().includes(q) ||
        b.roomCode.toLowerCase().includes(q)
      );
    });
  }, [projects, filter, search]);

  async function advance(b: Booking) {
    setSubmitting(b.id);
    try {
      const res = await api.argeAdvanceStage(b.id);
      toast.push(
        'success',
        `${b.projectName} → ${STAGE_META[res.booking.lifecycleStage].label}`
      );
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Aşama ilerletilemedi.');
    } finally {
      setSubmitting(null);
    }
  }

  async function regress(b: Booking) {
    setSubmitting(b.id);
    try {
      const res = await api.argeRegressStage(b.id);
      toast.push('info', `${b.projectName} ← ${STAGE_META[res.booking.lifecycleStage].label}`);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Aşama geri alınamadı.');
    } finally {
      setSubmitting(null);
    }
  }

  async function rejectAdvance(b: Booking) {
    setSubmitting(b.id);
    try {
      await api.argeRejectAdvanceRequest(b.id);
      toast.push('info', 'İlerletme talebi reddedildi.');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <AppShell
      kind="arge"
      profileLink="/arge"
      roleLabel="YZ / Ar-Ge Mühendisi"
    >
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="role-badge-violet">
            <span className="role-badge-dot bg-violet-400" />
            YZ / Ar-Ge Mühendisi
          </div>
          <h1 className="text-3xl font-extrabold text-kt-green-900">
            Proje Yaşam Döngüsü
          </h1>
          <p className="text-kt-gray-500 text-sm mt-1">
            Onaylı projeleri Stage / Production aşamasına ilerletin; gerektiğinde
            geri alın (rollback). Kullanıcıların ilerletme taleplerini siz onaylarsınız.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard icon={Inbox} label="Aşama Talebi" value={counts.withAdvanceRequest} tone="gold" compact />
          <KpiCard icon={FlaskConical} label="Stage" value={counts.inStage} tone="cyan" compact />
          <KpiCard icon={Rocket} label="Production" value={counts.inProduction} tone="violet" compact />
        </div>
      </div>

      {/* Filter chip'leri — pill style, brand palette */}
      <div className="card p-4 mb-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <div className="flex gap-2 flex-wrap text-sm">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={
              filter === 'all'
                ? 'btn-pill-primary btn-pill-xs'
                : 'btn-pill-outline-light btn-pill-xs'
            }
          >
            {filter === 'all' && <span className="btn-pill-shimmer" />}
            <span className="relative z-10">Tümü ({counts.total})</span>
          </button>
          <button
            type="button"
            onClick={() =>
              setFilter(filter === 'advance_pending' ? 'all' : 'advance_pending')
            }
            className={
              filter === 'advance_pending'
                ? 'btn-pill-warning btn-pill-xs'
                : 'btn-pill btn-pill-xs bg-white text-amber-700 border border-amber-200 hover:bg-amber-50 hover:border-amber-300'
            }
          >
            <span className="relative z-10 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Talep ({counts.withAdvanceRequest})
            </span>
          </button>
          {STAGE_ORDER.filter((s) => s !== 'application').map((s) => {
            const count = projects.filter((b) => b.lifecycleStage === s).length;
            const isActive = filter === s;
            // Stage'e özel renkli pill — active'de filled, idle'da outline.
            const variant = stageFilterClass(s, isActive);
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(isActive ? 'all' : s)}
                className={`btn-pill btn-pill-xs ${variant}`}
              >
                {isActive && <span className="btn-pill-shimmer" />}
                <span className="relative z-10">{STAGE_META[s].label} ({count})</span>
              </button>
            );
          })}
        </div>
        <input
          type="search"
          className="input md:max-w-xs"
          placeholder="Proje / kullanıcı / oda ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={80}
        />
      </div>

      {loading ? (
        <div className="card p-10 text-center text-kt-gray-500">Yükleniyor…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="data"
          tone="cyan"
          title="Eşleşen proje yok"
          description="Filtreyi değiştirin veya tüm onaylı projeleri görmek için aramayı sıfırlayın."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((b) => {
            // Defensive — lifecycleStage backend DTO'da null gelebilir; 'development' default.
            const stage = b.lifecycleStage ?? 'development';
            const idx = STAGE_ORDER.indexOf(stage);
            const isTerminal = idx >= STAGE_ORDER.length - 1;
            const isAtStart = idx <= 1;
            const next = !isTerminal ? STAGE_ORDER[idx + 1] : null;
            const prev = !isAtStart ? STAGE_ORDER[idx - 1] : null;
            const meta = STAGE_META[stage] ?? STAGE_META.development;
            const pending = !!b.stageAdvanceRequestedAt;
            const busy = submitting === b.id;

            return (
              <article
                key={b.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  setDetailId(b.id);
                }}
                className={`relative rounded-2xl bg-white border p-5 cursor-pointer transition-shadow duration-200 hover:shadow-sm ${pending ? 'border-amber-200' : 'border-kt-gray-100 hover:border-kt-gray-200'}`}
              >
                {pending && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full bg-amber-500"
                  />
                )}
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-[11px] font-bold text-kt-gray-500 tracking-wider">
                        {b.roomCode}
                      </span>
                      <span className="text-kt-gray-300">·</span>
                      <span className="text-xs text-kt-gray-500 truncate">
                        {b.userFullName ?? b.userEmail}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-kt-green-900 truncate">
                      {b.projectName}
                    </h3>
                    <div className="text-xs text-kt-gray-500 mt-0.5">
                      {fmtDate(b.startDate)} – {fmtDate(b.endDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <SlaBadge sla={computeStageSla(b)} />
                    <span className={`text-[11px] font-bold px-2 py-1 rounded-md border ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </div>
                </div>

                <div className="my-3">
                  <ProjectLifecycleBar stage={stage} />
                </div>

                {pending && (
                  <div className="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs">
                    <div className="font-bold mb-0.5">
                      Kullanıcı aşama ilerletme talebi gönderdi
                    </div>
                    <div className="opacity-90 text-[11px]">
                      {new Date(b.stageAdvanceRequestedAt!).toLocaleString('tr-TR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {b.stageAdvanceNote && (
                        <div className="italic mt-1">"{b.stageAdvanceNote}"</div>
                      )}
                    </div>
                    <div className="flex justify-end gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={() => rejectAdvance(b)}
                        disabled={busy}
                        className="btn-pill btn-pill-xs bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 hover:border-rose-300"
                      >
                        <span className="relative z-10">Reddet</span>
                      </button>
                      {next && (
                        <button
                          type="button"
                          onClick={() => advance(b)}
                          disabled={busy}
                          className="btn-pill-success btn-pill-xs"
                        >
                          <span className="btn-pill-shimmer" />
                          <span className="relative z-10">✓ Onayla → {STAGE_META[next].label}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-xs text-kt-gray-500">
                  <span>
                    {meta.label}'da{' '}
                    <strong className="text-kt-green-800">
                      {daysSince(b.stageEnteredAt)} gün
                    </strong>
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {prev && (
                      <button
                        type="button"
                        onClick={() => regress(b)}
                        disabled={busy}
                        className="btn-pill-neutral btn-pill-xs"
                        title={`${STAGE_META[prev].label} aşamasına geri al`}
                      >
                        <span className="relative z-10">← {STAGE_META[prev].label}</span>
                      </button>
                    )}
                    {next ? (
                      <button
                        type="button"
                        onClick={() => advance(b)}
                        disabled={busy}
                        className="btn-pill-primary btn-pill-xs"
                      >
                        <span className="btn-pill-shimmer" />
                        <span className="relative z-10">→ {STAGE_META[next].label}</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Canlıda
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Detay modal — kart tıklanınca açılır. Ar-Ge view: lifecycle + advance/regress + reject reason. */}
      <BookingDetailModal
        booking={selectedDetail}
        open={!!detailId}
        loading={submitting === detailId}
        onClose={() => submitting !== detailId && setDetailId(null)}
        viewerRole="arge"
        onAdvanceStage={
          selectedDetail
            ? async () => {
                await advance(selectedDetail);
                setDetailId(null);
              }
            : undefined
        }
        onRegressStage={
          selectedDetail
            ? async () => {
                await regress(selectedDetail);
                setDetailId(null);
              }
            : undefined
        }
        onRejectAdvanceRequest={
          selectedDetail
            ? async () => {
                // Note: backend argeRejectAdvanceRequest henüz note parametresi desteklemiyor;
                // gelecekte eklenebilir. Şimdilik sadece flag kaldırıyor.
                await rejectAdvance(selectedDetail);
                setDetailId(null);
              }
            : undefined
        }
      />
    </AppShell>
  );
}
