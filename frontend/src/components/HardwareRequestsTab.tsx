/**
 * "Taleplerim" sayfasının Donanım Talepleri sekmesi.
 * Kullanıcı kendi donanım taleplerini listeler, oluşturur ve düzenler.
 */
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from './EmptyState';
import { HardwareRequestModal } from './HardwareRequestModal';
import { StatusBadge } from './StatusBadge';
import { useToast } from './Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { CreateHardwareRequestPayload, EquipmentType, HardwareRequest } from '../types';

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

export function HardwareRequestsTab() {
  const toast = useToast();
  const [items, setItems] = useState<HardwareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HardwareRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listMyHardwareRequests();
      setItems(r.items);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Donanım talepleri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeEvents('user', (type) => {
    if (type === 'hardware_request.reviewed' || type === 'hardware_request.created') {
      load();
    }
  });

  async function handleSubmit(payload: CreateHardwareRequestPayload) {
    setSubmitting(true);
    try {
      if (editing) {
        await api.updateHardwareRequest(editing.id, payload);
        toast.push('success', 'Donanım talebiniz güncellendi.');
      } else {
        await api.createHardwareRequest(payload);
        toast.push('success', 'Donanım talebiniz gönderildi.');
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    } finally {
      setSubmitting(false);
    }
  }

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(req: HardwareRequest) {
    setEditing(req);
    setModalOpen(true);
  }

  function closeModal() {
    if (submitting) return;
    setModalOpen(false);
    setEditing(null);
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button type="button" onClick={openNew} className="btn-primary text-sm">
          + Yeni donanım talebi
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-28" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="bookings"
          title="Henüz donanım talebiniz yok"
          description="Mouse, klavye, kamera gibi ekipman ihtiyaçlarınızı buradan talep edebilirsiniz."
          tone="cyan"
          action={
            <button type="button" onClick={openNew} className="btn-primary inline-flex">
              İlk talebi oluştur
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((r) => {
            const modifiable = r.status === 'pending' || r.status === 'feedback_requested';
            return (
              <article key={r.id} className="card p-6 animate-fade-in">
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
                      Aciliyet: {URGENCY_LABEL[r.urgency]} · Gönderildi: {fmtDate(r.createdAt)}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-sm text-kt-gray-700 whitespace-pre-wrap">{r.reason}</p>

                {r.adminFeedback && (
                  <div
                    className={`mt-3 p-3 rounded-xl border-l-4 ${
                      r.status === 'rejected'
                        ? 'bg-red-50 border-red-400'
                        : r.status === 'feedback_requested'
                        ? 'bg-blue-50 border-blue-400'
                        : 'bg-emerald-50 border-emerald-400'
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wider mb-1 text-kt-green-700">
                      Admin geri bildirimi
                    </div>
                    <p className="text-sm text-kt-green-800 whitespace-pre-wrap">
                      {r.adminFeedback}
                    </p>
                  </div>
                )}

                {modifiable && (
                  <div className="mt-4 pt-3 border-t border-kt-gray-100 flex justify-end">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="btn-secondary text-sm"
                    >
                      Düzenle
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <HardwareRequestModal
        open={modalOpen}
        loading={submitting}
        editing={editing}
        onClose={closeModal}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
