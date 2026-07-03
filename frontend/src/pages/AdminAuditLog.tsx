/**
 * Admin audit log viewer — filtre, paginate, CSV export.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { sessionStore } from '../services/storage';

interface AuditEntry {
  id: string;
  eventType: string;
  subjectId: string | null;
  subjectType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  details: Record<string, unknown> | null;
  createdAt: string;
}

type SubjectKind = 'all' | 'user' | 'admin' | 'anonymous';
type SuccessFilter = 'all' | 'true' | 'false';

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR');
}

function eventBadge(eventType: string): { cls: string; icon: string } {
  if (eventType.startsWith('auth.login.success'))
    return { cls: 'bg-emerald-100 text-emerald-800', icon: '✓' };
  if (eventType.startsWith('auth.login') || eventType.startsWith('auth.refresh.failure'))
    return { cls: 'bg-rose-100 text-rose-800', icon: '⚠' };
  if (eventType.includes('reuse_detected'))
    return { cls: 'bg-rose-200 text-rose-900', icon: '🚨' };
  if (eventType.startsWith('booking'))
    return { cls: 'bg-kt-gold-100 text-kt-gold-800', icon: '📋' };
  if (eventType.startsWith('waitlist'))
    return { cls: 'bg-blue-100 text-blue-800', icon: '⏱' };
  if (eventType.startsWith('user.'))
    return { cls: 'bg-purple-100 text-purple-800', icon: '👤' };
  if (eventType.startsWith('csrf'))
    return { cls: 'bg-rose-200 text-rose-900', icon: '🛡' };
  if (eventType.startsWith('rate_limit'))
    return { cls: 'bg-amber-100 text-amber-800', icon: '⏸' };
  return { cls: 'bg-kt-gray-100 text-kt-gray-700', icon: '•' };
}

export default function AdminAuditLog() {
  const toast = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [eventType, setEventType] = useState('');
  const [subjectType, setSubjectType] = useState<SubjectKind>('all');
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>('all');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const debounceRef = useRef<number | null>(null);
  const LIMIT = 50;

  const buildHeaders = useCallback((): Record<string, string> => {
    const session = sessionStore.get('admin');
    return session
      ? { Authorization: `Bearer ${session.tokens.accessToken}` }
      : {};
  }, []);

  const load = useCallback(
    async (resetOffset = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (eventType) params.set('eventType', eventType);
        if (subjectType !== 'all') params.set('subjectType', subjectType);
        if (successFilter !== 'all') params.set('success', successFilter);
        if (q.trim()) params.set('q', q.trim());
        params.set('limit', String(LIMIT));
        params.set('offset', String(resetOffset ? 0 : offset));

        const res = await fetch(`/api/admin/audit?${params.toString()}`, {
          credentials: 'include',
          headers: buildHeaders(),
        });
        if (!res.ok) throw new Error('Audit log yüklenemedi.');
        const data = (await res.json()) as { entries: AuditEntry[]; total: number };
        setEntries(data.entries);
        setTotal(data.total);
        if (resetOffset) setOffset(0);
      } catch (err) {
        toast.push('error', (err as Error).message || 'Yüklenemedi.');
      } finally {
        setLoading(false);
      }
    },
    [toast, eventType, subjectType, successFilter, q, offset, buildHeaders]
  );

  // Load event types once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/audit/event-types', {
          credentials: 'include',
          headers: buildHeaders(),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { eventTypes: string[] };
        setEventTypes(data.eventTypes);
      } catch {
        // ignore
      }
    })();
  }, [buildHeaders]);

  // Debounced reload on filter change
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      load(true);
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, subjectType, successFilter, q]);

  // Pagination — offset change
  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const pageCount = useMemo(() => Math.ceil(total / LIMIT), [total]);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  async function handleCsvExport() {
    try {
      const params = new URLSearchParams();
      if (eventType) params.set('eventType', eventType);
      if (subjectType !== 'all') params.set('subjectType', subjectType);
      const res = await fetch(`/api/admin/audit/export?${params.toString()}`, {
        credentials: 'include',
        headers: buildHeaders(),
      });
      if (!res.ok) throw new Error('CSV export başarısız.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `klab-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.push('success', 'CSV indirildi.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'CSV export başarısız.');
    }
  }

  return (
    <AppShell kind="admin">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Audit Log</h1>
          <p className="text-kt-gray-500 text-sm">
            Tüm güvenlik + iş olayları · {total.toLocaleString('tr-TR')} kayıt
          </p>
        </div>
        <button onClick={handleCsvExport} className="btn-secondary text-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          CSV indir
        </button>
      </div>

      {/* FILTERS */}
      <div className="card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <input
            type="search"
            placeholder="Event type ara (örn: auth.login)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input md:col-span-4"
            maxLength={60}
          />
          <select
            className="input md:col-span-3"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            <option value="">Tüm event tipleri</option>
            {eventTypes.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
          <select
            className="input md:col-span-3"
            value={subjectType}
            onChange={(e) => setSubjectType(e.target.value as SubjectKind)}
          >
            <option value="all">Subject tipi (tümü)</option>
            <option value="user">Kullanıcı</option>
            <option value="admin">Admin</option>
            <option value="anonymous">Anonim</option>
          </select>
          <select
            className="input md:col-span-2"
            value={successFilter}
            onChange={(e) => setSuccessFilter(e.target.value as SuccessFilter)}
          >
            <option value="all">Tümü</option>
            <option value="true">Başarılı</option>
            <option value="false">Başarısız</option>
          </select>
        </div>
      </div>

      {/* TABLE */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8">
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 bg-kt-gray-100 rounded animate-pulse" />
              ))}
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-kt-gray-500">
            <div className="text-5xl mb-3">📭</div>
            Filtrelere uygun kayıt yok.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-kt-gray-50 text-kt-gray-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Zaman</th>
                  <th className="text-left px-4 py-2 font-semibold">Olay</th>
                  <th className="text-left px-4 py-2 font-semibold">Kim</th>
                  <th className="text-left px-4 py-2 font-semibold">IP</th>
                  <th className="text-left px-4 py-2 font-semibold">Sonuç</th>
                  <th className="text-left px-4 py-2 font-semibold">Detay</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const badge = eventBadge(e.eventType);
                  return (
                    <tr key={e.id} className="border-t border-kt-gray-100 hover:bg-kt-gray-50/60">
                      <td className="px-4 py-2 text-xs text-kt-gray-600 whitespace-nowrap">
                        {fmtDateTime(e.createdAt)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${badge.cls}`}
                        >
                          <span>{badge.icon}</span>
                          {e.eventType}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <span className="text-kt-gray-600">{e.subjectType ?? '—'}</span>
                        {e.subjectId && (
                          <div className="text-[10px] text-kt-gray-400 font-mono truncate max-w-[140px]">
                            {e.subjectId.slice(0, 12)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-kt-gray-600">
                        {e.ipAddress ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        {e.success ? (
                          <span className="text-emerald-700 font-semibold text-xs">✓</span>
                        ) : (
                          <span className="text-rose-700 font-semibold text-xs">✕</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-kt-gray-600">
                        {e.details ? (
                          <details>
                            <summary className="cursor-pointer">JSON</summary>
                            <pre className="mt-1 p-2 bg-kt-gray-50 rounded text-[10px] max-w-md overflow-auto">
                              {JSON.stringify(e.details, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PAGINATION */}
      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-kt-gray-500">
            {offset + 1}-{Math.min(offset + LIMIT, total)} / {total} kayıt
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="btn-ghost text-sm"
            >
              ← Önceki
            </button>
            <span className="text-xs text-kt-gray-600">
              Sayfa {currentPage} / {pageCount}
            </span>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="btn-ghost text-sm"
            >
              Sonraki →
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
