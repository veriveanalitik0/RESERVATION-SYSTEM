/**
 * Admin — kullanıcı destek taleplerini görüntüleme sayfası (/admin/support).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { SupportRequestStatus, SupportRequestWithUser } from '../types';

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const FILTERS: Array<{ key: SupportRequestStatus | 'all'; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'open', label: 'Açık' },
  { key: 'resolved', label: 'Çözüldü' },
];

export default function AdminSupportRequests() {
  const toast = useToast();
  const [items, setItems] = useState<SupportRequestWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SupportRequestStatus | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.adminListSupportRequests(filter === 'all' ? undefined : filter);
      setItems(r.items);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Destek talepleri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeEvents('admin', (type) => {
    if (type === 'support_request.created') load();
  });

  async function resolve(id: string) {
    setBusy(id);
    try {
      await api.adminResolveSupportRequest(id);
      toast.push('success', 'Destek talebi çözüldü olarak işaretlendi.');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell kind="admin">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Destek Talepleri</h1>
        <p className="text-kt-gray-500">
          Kullanıcılardan gelen destek taleplerini görüntüleyin ve çözün.
        </p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              filter === f.key
                ? 'bg-kt-green-700 text-white border-kt-green-700'
                : 'bg-white text-kt-green-800 border-kt-gray-200 hover:border-kt-green-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-28" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="message"
          title="Destek talebi yok"
          description="Bu filtrede destek talebi bulunmuyor."
          tone="cyan"
        />
      ) : (
        <div className="space-y-4">
          {items.map((r) => (
            <article key={r.id} className="card p-6">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex-1">
                  <h3 className="text-base font-bold text-kt-green-900">{r.userFullName}</h3>
                  <div className="text-xs text-kt-gray-400">
                    {r.userDepartment ?? '—'} · {r.userEmail} · {fmtDateTime(r.createdAt)}
                  </div>
                </div>
                <span className={r.status === 'open' ? 'badge-pending' : 'badge-approved'}>
                  {r.status === 'open' ? '● Açık' : '✓ Çözüldü'}
                </span>
              </div>
              <p className="text-sm text-kt-gray-700 whitespace-pre-wrap">{r.description}</p>
              {r.status === 'open' && (
                <div className="mt-4 pt-3 border-t border-kt-gray-100 flex justify-end">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => resolve(r.id)}
                    className="btn-primary text-sm"
                  >
                    Çözüldü olarak işaretle
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
