/**
 * "Taleplerim" sayfasının Lisans Talepleri sekmesi.
 * Kullanıcının lisans taleplerini salt-okunur listeler; oluşturma/detay
 * "Lisanslarım" sayfasında (/licenses) yapılır.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from './EmptyState';
import { StatusBadge } from './StatusBadge';
import { useToast } from './Toast';
import { api } from '../services/api';
import type { LicenseRequest } from '../types';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function LicenseRequestsTab() {
  const toast = useToast();
  const [items, setItems] = useState<LicenseRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.listMyLicenseRequests();
        if (!cancelled) setItems(r.items);
      } catch (err) {
        if (!cancelled) {
          toast.push('error', (err as Error).message || 'Lisans talepleri yüklenemedi.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Link to="/licenses" className="btn-primary text-sm inline-flex">
          Lisans talebi oluştur →
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-24" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="licenses"
          title="Henüz lisans talebiniz yok"
          description="Claude, Cursor, Copilot gibi araçlar için lisans talebinde bulunabilirsiniz."
          tone="cyan"
          action={
            <Link to="/licenses" className="btn-primary inline-flex">
              Lisans talebi oluştur
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((r) => (
            <Link
              key={r.id}
              to="/licenses"
              className="card p-6 block hover:ring-2 hover:ring-kt-gold-300/50 transition animate-fade-in"
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-kt-green-900">
                    {r.requestTitle ?? r.licenseName}
                  </h3>
                  <div className="text-sm text-kt-gray-600 mt-0.5">
                    {r.items.map((i) => i.licenseName).join(', ')}
                  </div>
                  <div className="text-xs text-kt-gray-400 mt-1">
                    {r.durationMonths} ay · Gönderildi: {fmtDate(r.createdAt)}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <p className="text-sm text-kt-gray-700 line-clamp-2">{r.reason}</p>
              <div className="text-xs text-kt-gold-700 font-semibold mt-2">
                Detay için Lisanslarım →
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
