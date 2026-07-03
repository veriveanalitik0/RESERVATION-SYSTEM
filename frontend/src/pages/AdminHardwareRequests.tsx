/**
 * Admin — donanım taleplerini inceleme sayfası (/admin/hardware).
 * AdminLicenseRequestsTab'in sade hâli: liste + onayla/reddet/düzeltme iste.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { EquipmentType, HardwareRequestStatus, HardwareRequestWithUser } from '../types';

const EQUIPMENT_LABEL: Record<EquipmentType, string> = {
  mouse: 'Mouse',
  keyboard: 'Klavye',
  camera: 'Kamera',
  monitor: 'Monitör',
  headset: 'Kulaklık',
  other: 'Diğer donanım',
};

const URGENCY_LABEL: Record<string, string> = {
  low: 'Düşük',
  normal: 'Normal',
  high: 'Yüksek',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

const FILTERS: Array<{ key: HardwareRequestStatus | 'all'; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'pending', label: 'Bekleyen' },
  { key: 'feedback_requested', label: 'Düzeltme' },
  { key: 'approved', label: 'Onaylı' },
  { key: 'rejected', label: 'Reddedilen' },
];

export default function AdminHardwareRequests() {
  const toast = useToast();
  const [items, setItems] = useState<HardwareRequestWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<HardwareRequestStatus | 'all'>('all');
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.adminListHardwareRequests(filter === 'all' ? undefined : filter);
      setItems(r.items);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Talepler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeEvents('admin', (type) => {
    if (type === 'hardware_request.created') load();
  });

  async function review(id: string, action: 'approve' | 'reject' | 'request_feedback') {
    setBusy(id);
    try {
      await api.adminReviewHardwareRequest(id, {
        action,
        adminFeedback: feedback[id]?.trim() || null,
      });
      toast.push('success', 'Talep güncellendi.');
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
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Donanım Talepleri</h1>
        <p className="text-kt-gray-500">
          Kullanıcıların mouse, klavye, kamera gibi donanım taleplerini inceleyin.
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
            <div key={i} className="card p-6 animate-pulse h-32" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="bookings"
          title="Talep yok"
          description="Bu filtrede donanım talebi bulunmuyor."
          tone="cyan"
        />
      ) : (
        <div className="space-y-4">
          {items.map((r) => {
            const pending = r.status === 'pending' || r.status === 'feedback_requested';
            return (
              <article key={r.id} className="card p-6">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-kt-green-900">
                      {EQUIPMENT_LABEL[r.equipmentType]}{' '}
                      <span className="text-kt-gray-400 font-normal text-sm">
                        × {r.quantity}
                      </span>
                    </h3>
                    {r.equipmentDetail && (
                      <div className="text-sm text-kt-gray-600 mt-0.5">{r.equipmentDetail}</div>
                    )}
                    <div className="text-xs text-kt-gray-400 mt-1">
                      {r.userFullName} · {r.userDepartment ?? '—'} · Aciliyet:{' '}
                      {URGENCY_LABEL[r.urgency]} · {fmtDate(r.createdAt)}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-sm text-kt-gray-700 whitespace-pre-wrap mb-3">{r.reason}</p>

                {r.adminFeedback && !pending && (
                  <div className="mb-3 p-3 rounded-xl bg-kt-gray-50 border border-kt-gray-200 text-sm text-kt-gray-700">
                    <span className="font-semibold">Geri bildirim:</span> {r.adminFeedback}
                  </div>
                )}

                {pending && (
                  <div className="mt-3 pt-3 border-t border-kt-gray-100">
                    <textarea
                      className="input min-h-[60px] text-sm mb-2"
                      placeholder="Geri bildirim (reddetme/düzeltme için önerilir)..."
                      value={feedback[r.id] ?? ''}
                      onChange={(e) =>
                        setFeedback((p) => ({ ...p, [r.id]: e.target.value }))
                      }
                      maxLength={1000}
                    />
                    <div className="flex gap-2 justify-end flex-wrap">
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => review(r.id, 'request_feedback')}
                        className="btn-secondary text-sm"
                      >
                        Düzeltme iste
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => review(r.id, 'reject')}
                        className="btn text-sm bg-red-50 text-red-700 hover:bg-red-100 border border-red-100"
                      >
                        Reddet
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => review(r.id, 'approve')}
                        className="btn-primary text-sm"
                      >
                        Onayla
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
