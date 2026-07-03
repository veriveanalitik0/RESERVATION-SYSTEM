/**
 * Admin Licenses sayfası — Cursor / Claude / Copilot vb. lisans kullanımı.
 *
 * İki görünüm:
 *  - Tab "Yazılım bazlı": Hangi lisans kaç kişide, aylık $ ne kadar.
 *  - Tab "Kullanıcı bazlı": Her kullanıcının kullandığı lisanslar + toplam $.
 *
 * Tüm rakamlar USD; UI'da hem USD hem ₺ gösterilir (sabit kur ile yaklaşık).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useViewerKind } from '../hooks/useViewerKind';
import { AdminLicenseRequestsTab } from '../components/AdminLicenseRequestsTab';
import { GovernanceDashboardView } from '../components/governance/GovernanceDashboardView';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type {
  LicenseBudgetReport,
  LicenseCategory,
  LicenseReport,
  LicenseSummary,
  UserLicenseUsage,
} from '../types';

// Sabit USD/TRY kuru — demo için. Gerçekte canlı bir endpoint'ten çekilir.
const USD_TRY = 38.5;

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtTry(n: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n * USD_TRY);
}
function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function categoryColor(category: LicenseCategory): string {
  switch (category) {
    case 'AI Assistant': return 'bg-kt-violet-100 text-kt-violet-700 border-kt-violet-300/40';
    case 'IDE':          return 'bg-kt-gold-100 text-kt-gold-800 border-kt-gold-300/40';
    case 'Cloud':        return 'bg-kt-green-100 text-kt-green-700 border-kt-green-300/40';
    case 'API':          return 'bg-sky-100 text-sky-800 border-sky-300/40';
    case 'Framework':    return 'bg-emerald-100 text-emerald-800 border-emerald-300/40';
    case 'Database':     return 'bg-amber-100 text-amber-800 border-amber-300/40';
  }
}

type TabKey = 'requests' | 'governance' | 'budget' | 'software' | 'user';

export default function AdminLicenses() {
  const toast = useToast();
  const viewerKind = useViewerKind();
  const canEdit = viewerKind === 'admin';
  const [report, setReport] = useState<LicenseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('requests');
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'paid' | 'free'>('paid');
  const [budget, setBudget] = useState<LicenseBudgetReport | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminLicenses();
      setReport(res);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Lisans raporu yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadBudget = useCallback(async () => {
    setBudgetLoading(true);
    try {
      setBudget(await api.adminLicenseBudget());
    } catch (err) {
      toast.push('error', (err as Error).message || 'Bütçe raporu yüklenemedi.');
    } finally {
      setBudgetLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'budget' && !budget) void loadBudget();
  }, [tab, budget, loadBudget]);

  useRealtimeEvents('admin', (type) => {
    if (
      type === 'booking.created' ||
      type === 'booking.reviewed' ||
      type === 'booking.withdrawn' ||
      type === 'booking.updated'
    ) {
      load();
    }
  });

  const filteredSoftware = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase();
    return report.bySoftware.filter((l) => {
      if (tierFilter !== 'all' && l.tier !== tierFilter) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.vendor.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
      );
    });
  }, [report, search, tierFilter]);

  const filteredUsers = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase();
    return report.byUser.filter((u) => {
      if (!q) return true;
      return (
        u.userFullName.toLowerCase().includes(q) ||
        u.userEmail.toLowerCase().includes(q) ||
        (u.department ?? '').toLowerCase().includes(q) ||
        u.licenses.some((l) => l.name.toLowerCase().includes(q))
      );
    });
  }, [report, search]);

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
          <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Lisans & Harcama Analizi</h1>
          <p className="text-kt-gray-500 text-sm">
            Aktif booking'lerde talep edilen Cursor / Claude / Copilot vb. lisansların kullanımı ve aylık tahmini maliyet.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Yenile
        </button>
      </div>

      {/* Tab tab seçici — her zaman görünür (Talepler analytics bekletmez) */}
      <div className="card p-3 mb-4">
        <div className="flex gap-1.5 p-1 bg-kt-gray-100 rounded-xl flex-wrap">
          <button
            onClick={() => setTab('requests')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === 'requests'
                ? 'bg-white text-kt-green-900 shadow-kt-soft'
                : 'text-kt-gray-500 hover:text-kt-green-800'
            }`}
          >
            Talepler
          </button>
          <button
            onClick={() => setTab('governance')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === 'governance'
                ? 'bg-white text-kt-green-900 shadow-kt-soft'
                : 'text-kt-gray-500 hover:text-kt-green-800'
            }`}
          >
            Yönetişim
          </button>
          <button
            onClick={() => setTab('budget')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === 'budget'
                ? 'bg-white text-kt-green-900 shadow-kt-soft'
                : 'text-kt-gray-500 hover:text-kt-green-800'
            }`}
          >
            Bütçe
          </button>
          <button
            onClick={() => setTab('software')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === 'software'
                ? 'bg-white text-kt-green-900 shadow-kt-soft'
                : 'text-kt-gray-500 hover:text-kt-green-800'
            }`}
          >
            Yazılım Analizi
          </button>
          <button
            onClick={() => setTab('user')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === 'user'
                ? 'bg-white text-kt-green-900 shadow-kt-soft'
                : 'text-kt-gray-500 hover:text-kt-green-800'
            }`}
          >
            Kullanıcı Analizi
          </button>
        </div>
      </div>

      {tab === 'requests' ? (
        <AdminLicenseRequestsTab readOnly={!canEdit} />
      ) : tab === 'governance' ? (
        <GovernanceDashboardView />
      ) : tab === 'budget' ? (
        budgetLoading || !budget ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-6 animate-pulse h-32" />
            ))}
          </div>
        ) : (
          <BudgetView report={budget} />
        )
      ) : loading || !report ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-32" />
          ))}
        </div>
      ) : (
        <>
          {/* ============== TOP STATS ============== */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="card p-5 relative overflow-hidden">
              <div className="absolute -top-3 -right-3 w-20 h-20 bg-kt-gold-400/15 rounded-full blur-2xl" />
              <div className="relative">
                <div className="text-3xl font-extrabold text-shimmer tabular-nums">
                  {fmtUsd(report.totals.totalMonthlyUsd)}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
                  Aylık toplam
                </div>
                <div className="text-xs text-kt-gold-700 font-semibold mt-0.5">
                  ≈ {fmtTry(report.totals.totalMonthlyUsd)}
                </div>
              </div>
            </div>
            <div className="card p-5">
              <div className="text-3xl font-extrabold text-kt-green-800 tabular-nums">
                {fmtUsd(report.totals.totalAnnualUsd)}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
                Yıllık projeksiyon
              </div>
              <div className="text-xs text-kt-gray-500 mt-0.5">
                ≈ {fmtTry(report.totals.totalAnnualUsd)}
              </div>
            </div>
            <div className="card p-5">
              <div className="text-3xl font-extrabold text-kt-violet-600 tabular-nums">
                {report.totals.paidLicenseUsers}
                <span className="text-base text-kt-gray-400"> / {report.totals.totalUsers}</span>
              </div>
              <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
                Lisanslı kullanıcı
              </div>
              <div className="text-xs text-kt-gray-500 mt-0.5">
                {report.totals.totalUsers - report.totals.paidLicenseUsers} sadece açık kaynak
              </div>
            </div>
            <div className="card p-5">
              <div className="text-3xl font-extrabold text-kt-gold-700 tabular-nums">
                {report.totals.paidLicenseCount}
                <span className="text-base text-kt-gray-400"> / {report.totals.distinctLicensesUsed}</span>
              </div>
              <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
                Aktif ücretli lisans
              </div>
              <div className="text-xs text-kt-gray-500 mt-0.5">
                + {report.totals.freeLicenseCount} açık kaynak
              </div>
            </div>
          </section>

          {/* ============== SEARCH + (tier filter for software) ============== */}
          <div className="card p-4 md:p-5 mb-4">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
              <div className="flex gap-2 flex-1 md:max-w-md">
                <div className="relative flex-1">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-kt-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="search"
                    placeholder={tab === 'software' ? 'Lisans / vendor ara' : 'Kullanıcı / departman / lisans ara'}
                    className="input pl-10 text-sm"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    maxLength={60}
                  />
                </div>
                {tab === 'software' && (
                  <select
                    value={tierFilter}
                    onChange={(e) => setTierFilter(e.target.value as typeof tierFilter)}
                    className="input text-sm w-32"
                  >
                    <option value="all">Tümü</option>
                    <option value="paid">Ücretli</option>
                    <option value="free">Açık kaynak</option>
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* ============== CONTENT ============== */}
          {tab === 'software' ? (
            <SoftwareView items={filteredSoftware} />
          ) : (
            <UserView items={filteredUsers} />
          )}

          <div className="text-xs text-kt-gray-400 text-right mt-4">
            Son güncelleme: {new Date(report.generatedAt).toLocaleString('tr-TR')} · USD/TRY ≈ {USD_TRY}
          </div>
        </>
      )}
    </AppShell>
  );
}

/* ============================================================
 * SOFTWARE VIEW — lisans bazlı sıralama
 * ============================================================ */

function SoftwareView({ items }: { items: LicenseSummary[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="text-5xl mb-3">💳</div>
        <h3 className="text-lg font-bold text-kt-green-800 mb-1">Lisans kullanımı yok</h3>
        <p className="text-sm text-kt-gray-500">Aktif booking yok veya filtre eşleşmiyor.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((lic) => {
        const isExpanded = expandedKey === lic.technology;
        return (
          <article key={lic.technology} className="card overflow-hidden">
            <button
              onClick={() => setExpandedKey(isExpanded ? null : lic.technology)}
              className="w-full p-5 flex items-center justify-between gap-4 hover:bg-kt-gray-50/60 transition-colors text-left"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold border ${categoryColor(lic.category)}`}>
                  {lic.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-kt-green-900 truncate">{lic.name}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${categoryColor(lic.category)}`}>
                      {lic.category}
                    </span>
                    {lic.tier === 'paid' ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-kt-gold-100 text-kt-gold-700">
                        Ücretli
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        Açık kaynak
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-kt-gray-500 mt-0.5">
                    {lic.vendor} · {lic.userCount} kullanıcı · {lic.bookingCount} aktif booking
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-extrabold text-kt-green-900 tabular-nums">
                  {lic.tier === 'paid' ? fmtUsd(lic.totalMonthlyUsd) : '—'}
                </div>
                <div className="text-[11px] text-kt-gray-500">
                  {lic.tier === 'paid' ? `${fmtUsd(lic.monthlyUsd)}/ay × ${lic.userCount}` : 'ücretsiz'}
                </div>
                {lic.tier === 'paid' && lic.totalMonthlyUsd > 0 && (
                  <div className="text-[11px] text-kt-gold-700 font-semibold mt-0.5">
                    ≈ {fmtTry(lic.totalMonthlyUsd)}
                  </div>
                )}
              </div>
              <svg
                className={`w-4 h-4 text-kt-gray-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-kt-gray-100 p-5 bg-kt-gray-50/40">
                <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mb-3">
                  Kullanıcılar ({lic.users.length})
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {lic.users.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 p-2 rounded-lg bg-white border border-kt-gray-100">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-kt-green-600 to-kt-green-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {initials(u.fullName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-kt-green-900 truncate">{u.fullName}</div>
                        <div className="text-[10px] text-kt-gray-500 truncate">{u.email}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/* ============================================================
 * USER VIEW — kullanıcı bazlı
 * ============================================================ */

function UserView({ items }: { items: UserLicenseUsage[] }) {
  if (items.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="text-5xl mb-3">👥</div>
        <h3 className="text-lg font-bold text-kt-green-800 mb-1">Kullanıcı bulunamadı</h3>
        <p className="text-sm text-kt-gray-500">Filtreyle eşleşen aktif kullanıcı yok.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((u) => {
        const paid = u.licenses.filter((l) => l.tier === 'paid');
        const free = u.licenses.filter((l) => l.tier === 'free');
        return (
          <article key={u.userId} className="card p-5">
            <header className="flex items-start gap-4 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-kt-green-600 via-kt-green-700 to-kt-green-800 text-white flex items-center justify-center font-bold text-sm shrink-0">
                {initials(u.userFullName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-kt-green-900 truncate">{u.userFullName}</h3>
                  {u.department && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-kt-gray-100 text-kt-gray-700">
                      {u.department}
                    </span>
                  )}
                </div>
                <div className="text-xs text-kt-gray-500 mt-0.5 truncate">{u.userEmail}</div>
                <div className="text-[11px] text-kt-gray-400 mt-0.5">
                  {u.activeBookingCount} aktif booking · {u.licenses.length} farklı teknoloji
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-extrabold text-kt-green-900 tabular-nums">
                  {fmtUsd(u.totalMonthlyUsd)}
                </div>
                <div className="text-[11px] text-kt-gray-500">aylık</div>
                {u.totalMonthlyUsd > 0 && (
                  <div className="text-[11px] text-kt-gold-700 font-semibold mt-0.5">
                    ≈ {fmtTry(u.totalMonthlyUsd)}
                  </div>
                )}
              </div>
            </header>

            {/* Lisanslar */}
            <div className="space-y-2 pl-16">
              {paid.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-kt-gold-700 font-bold mb-1.5">
                    Ücretli ({paid.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {paid.map((l) => (
                      <span
                        key={l.technology}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${categoryColor(l.category)}`}
                        title={`${l.vendor} · ${fmtUsd(l.monthlyUsd)}/ay`}
                      >
                        {l.name}
                        <span className="text-[10px] opacity-80">{fmtUsd(l.monthlyUsd)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {free.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold mb-1.5">
                    Açık kaynak ({free.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {free.map((l) => (
                      <span
                        key={l.technology}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                      >
                        {l.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {paid.length === 0 && free.length === 0 && (
                <div className="text-xs text-kt-gray-400 italic">Aktif teknoloji yok.</div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ============================================================
 * BUDGET VIEW — lisans taleplerinin maliyet projeksiyonu
 * ============================================================ */

function projectTypeLabel(t: 'poc' | 'integration' | 'unspecified'): string {
  if (t === 'poc') return 'Deneysel (PoC)';
  if (t === 'integration') return 'Kuruma Entegre';
  return 'Belirtilmemiş';
}

function BudgetView({ report }: { report: LicenseBudgetReport }) {
  const maxToolMonthly = Math.max(1, ...report.byTool.map((t) => t.monthlyUsd));

  return (
    <>
      {/* Üst istatistikler */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-5 relative overflow-hidden">
          <div className="absolute -top-3 -right-3 w-20 h-20 bg-kt-green-400/15 rounded-full blur-2xl" />
          <div className="relative">
            <div className="text-3xl font-extrabold text-kt-green-800 tabular-nums">
              {fmtUsd(report.approvedMonthlyUsd)}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
              Onaylı — aylık
            </div>
            <div className="text-xs text-kt-gold-700 font-semibold mt-0.5">
              ≈ {fmtTry(report.approvedMonthlyUsd)}
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="text-3xl font-extrabold text-kt-green-800 tabular-nums">
            {fmtUsd(report.approvedAnnualUsd)}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
            Yıllık projeksiyon
          </div>
          <div className="text-xs text-kt-gray-500 mt-0.5">≈ {fmtTry(report.approvedAnnualUsd)}</div>
        </div>
        <div className="card p-5">
          <div className="text-3xl font-extrabold text-kt-violet-600 tabular-nums">
            {fmtUsd(report.approvedCommitmentUsd)}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
            Toplam taahhüt
          </div>
          <div className="text-xs text-kt-gray-500 mt-0.5">
            {report.approvedRequestCount} onaylı talep · talep sürelerine göre
          </div>
        </div>
        <div className="card p-5">
          <div className="text-3xl font-extrabold text-kt-gold-700 tabular-nums">
            {fmtUsd(report.pendingMonthlyUsd)}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
            Bekleyen — potansiyel aylık
          </div>
          <div className="text-xs text-kt-gray-500 mt-0.5">
            {report.pendingRequestCount} talep onay beklerken
          </div>
        </div>
      </section>

      {report.approvedRequestCount === 0 && report.pendingRequestCount === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-3">📊</div>
          <h3 className="text-lg font-bold text-kt-green-800 mb-1">Henüz lisans talebi yok</h3>
          <p className="text-sm text-kt-gray-500">
            Talepler oluştukça maliyet projeksiyonu burada görünür.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Proje türüne göre */}
          <div className="card p-5">
            <h3 className="font-bold text-kt-green-900 mb-3">Proje türüne göre (onaylı)</h3>
            {report.byProjectType.length === 0 ? (
              <p className="text-sm text-kt-gray-400 italic">Onaylı talep yok.</p>
            ) : (
              <ul className="space-y-3">
                {report.byProjectType.map((b) => (
                  <li key={b.projectType}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold text-kt-green-900">
                        {projectTypeLabel(b.projectType)}
                      </span>
                      <span className="tabular-nums text-kt-gray-600">
                        {fmtUsd(b.monthlyUsd)}/ay · {b.requestCount} talep
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-kt-gray-100 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-kt-green-500 to-kt-green-700"
                        style={{
                          width: `${Math.round(
                            (b.monthlyUsd / Math.max(1, report.approvedMonthlyUsd)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Araca göre */}
          <div className="card p-5">
            <h3 className="font-bold text-kt-green-900 mb-3">Araca göre maliyet (onaylı)</h3>
            {report.byTool.length === 0 ? (
              <p className="text-sm text-kt-gray-400 italic">
                Onaylı taleplerde fiyatlı araç yok.
              </p>
            ) : (
              <ul className="space-y-3">
                {report.byTool.map((t) => (
                  <li key={t.name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold text-kt-green-900">
                        {t.name}
                        <span className="text-xs text-kt-gray-400 font-normal ml-1.5">
                          {t.approvedCount}× · {fmtUsd(t.unitMonthlyUsd)}/ay
                        </span>
                      </span>
                      <span className="tabular-nums text-kt-gray-600">{fmtUsd(t.monthlyUsd)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-kt-gray-100 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-kt-gold-400 to-kt-gold-600"
                        style={{ width: `${Math.round((t.monthlyUsd / maxToolMonthly) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {report.unpricedItemCount > 0 && (
        <div className="mt-4 px-4 py-3 rounded-xl bg-kt-gold-50 border border-kt-gold-200 text-sm text-kt-gold-900">
          <strong>{report.unpricedItemCount}</strong> araç kalemi katalogda fiyatlı değil
          (custom / elle eklenmiş) — maliyet hesabına dahil edilmedi.
        </div>
      )}

      <div className="text-xs text-kt-gray-400 text-right mt-4">
        Son güncelleme: {new Date(report.generatedAt).toLocaleString('tr-TR')} · USD/TRY ≈ {USD_TRY}
      </div>
    </>
  );
}
