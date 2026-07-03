/**
 * Kullanıcının waitlist kayıtları sayfası.
 *
 * - Waiting / promoted / expired / cancelled durumlarını gösterir.
 * - Waiting için "Geri çek" butonu.
 * - Promoted ise: ilgili booking ID'sini link olarak gösterir.
 * - Real-time event'ler (waitlist.changed) ile otomatik refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { WaitlistEntry } from '../types';
import { bookingPeriodLabel } from '../lib/utils';

function statusBadge(status: WaitlistEntry['status']): { label: string; cls: string } {
  switch (status) {
    case 'waiting':
      return { label: 'Sırada', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
    case 'promoted':
      return { label: 'Talep oluştu', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    case 'expired':
      return { label: 'Süresi geçti', cls: 'bg-kt-gray-100 text-kt-gray-600 border-kt-gray-200' };
    case 'cancelled':
      return { label: 'İptal edildi', cls: 'bg-rose-100 text-rose-700 border-rose-200' };
  }
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function UserWaitlist() {
  const toast = useToast();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  // Çift onay: geri alınamaz işlemler onaylanmadan çalışmaz.
  const [confirmAction, setConfirmAction] = useState<{ kind: 'cancel' | 'remove'; id: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listUserWaitlist();
      setEntries(res.entries);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Liste yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeEvents('user', (type, data) => {
    if (type === 'waitlist.changed' || type === 'booking.created') {
      load();
      if (type === 'waitlist.changed' && (data as { action?: string })?.action === 'promoted') {
        toast.push('success', 'Sıranız geldi! Talebiniz oluşturuldu.');
      }
    }
  });

  async function handleCancel(id: string) {
    setCancelling(id);
    try {
      await api.cancelWaitlist(id);
      toast.push('info', 'Bekleme listesinden çıkıldı.');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İptal başarısız.');
    } finally {
      setCancelling(null);
    }
  }

  // Geçmiş (iptal/süresi geçmiş) kaydı listeden kalıcı kaldır.
  async function handleRemove(id: string) {
    setCancelling(id);
    try {
      await api.removeWaitlistEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.push('success', 'Kayıt kaldırıldı.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Kaldırılamadı.');
    } finally {
      setCancelling(null);
    }
  }

  const grouped = useMemo(() => {
    return {
      waiting: entries.filter((e) => e.status === 'waiting'),
      promoted: entries.filter((e) => e.status === 'promoted'),
      other: entries.filter((e) => e.status === 'cancelled' || e.status === 'expired'),
    };
  }, [entries]);

  return (
    <AppShell kind="user">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Bekleme Listem</h1>
        <p className="text-kt-gray-500">
          Dolu olan odalar için sıraya yazıldığınız talepler. Oda boşalınca otomatik
          randevu oluşturulur.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-kt-gold-50 text-kt-gold-700 mx-auto mb-4 flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <h3 className="text-xl font-bold text-kt-green-800 mb-2">Sırada kaydınız yok</h3>
          <p className="text-kt-gray-500">
            Dolu bir odaya randevu almak istediğinizde "Sıraya gir" butonunu kullanabilirsiniz.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.waiting.length > 0 && (
            <section>
              <h2 className="text-sm font-bold uppercase tracking-wider text-kt-gray-500 mb-2">
                Bekleyenler ({grouped.waiting.length})
              </h2>
              <div className="space-y-2">
                {grouped.waiting.map((e) => (
                  <article key={e.id} className="card p-5 hover:shadow-kt-card transition-shadow">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-bold text-kt-gold-700 tracking-wider">
                            {e.roomCode}
                          </span>
                          <span className="text-kt-gray-300 text-xs">·</span>
                          <span className="text-xs text-kt-gray-500 truncate">{e.roomName}</span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${statusBadge(e.status).cls}`}>
                            {statusBadge(e.status).label} · #{e.position}
                          </span>
                        </div>
                        <h3 className="font-bold text-kt-green-900 truncate">{e.projectName}</h3>
                        <div className="text-xs text-kt-gray-500 mt-0.5">
                          {fmtDate(e.desiredStartDate)} – {fmtDate(e.desiredEndDate)} · {bookingPeriodLabel(e.period, e.periodMonths)}
                        </div>
                      </div>
                      <button
                        onClick={() => setConfirmAction({ kind: 'cancel', id: e.id })}
                        disabled={cancelling === e.id}
                        className="px-4 py-2 rounded-xl border border-rose-200 text-rose-700 text-sm font-semibold hover:bg-rose-50 transition-colors disabled:opacity-60"
                      >
                        {cancelling === e.id ? 'İptal ediliyor…' : 'Geri çek'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {grouped.promoted.length > 0 && (
            <section>
              <h2 className="text-sm font-bold uppercase tracking-wider text-kt-gray-500 mb-2">
                Talep oluştu ({grouped.promoted.length})
              </h2>
              <div className="space-y-2">
                {grouped.promoted.map((e) => (
                  <article key={e.id} className="card p-5 border-emerald-200">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-bold text-emerald-700 tracking-wider">
                            {e.roomCode}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${statusBadge(e.status).cls}`}>
                            {statusBadge(e.status).label}
                          </span>
                        </div>
                        <h3 className="font-bold text-kt-green-900 truncate">{e.projectName}</h3>
                        <div className="text-xs text-emerald-700 mt-0.5">
                          Oda serbest kaldı, talebiniz oluşturuldu. Taleplerim sayfasını kontrol edin.
                        </div>
                      </div>
                      <a href="/bookings" className="btn-secondary text-sm">
                        Taleplerime git →
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {grouped.other.length > 0 && (
            <section>
              <h2 className="text-sm font-bold uppercase tracking-wider text-kt-gray-500 mb-2">
                Geçmiş ({grouped.other.length})
              </h2>
              <div className="space-y-2">
                {grouped.other.map((e) => (
                  <article key={e.id} className="card p-4 opacity-75">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-bold text-kt-gray-500 tracking-wider">
                            {e.roomCode}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${statusBadge(e.status).cls}`}>
                            {statusBadge(e.status).label}
                          </span>
                        </div>
                        <h3 className="font-semibold text-kt-gray-700 truncate">{e.projectName}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmAction({ kind: 'remove', id: e.id })}
                        disabled={cancelling === e.id}
                        className="btn-ghost text-rose-600 text-xs shrink-0"
                        title="Bu kaydı listeden kaldır"
                      >
                        {cancelling === e.id ? 'Kaldırılıyor…' : 'Kaldır'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.kind === 'cancel' ? 'Sıradan çıkılsın mı?' : 'Kayıt kaldırılsın mı?'}
        message={
          confirmAction?.kind === 'cancel'
            ? 'Bekleme listesindeki sıranız iptal edilecek. Bu işlem geri alınamaz; tekrar sıraya girerseniz en sona eklenirsiniz.'
            : 'Bu geçmiş kayıt listenizden kalıcı olarak kaldırılacak.'
        }
        confirmLabel={confirmAction?.kind === 'cancel' ? 'Evet, sıradan çık' : 'Evet, kaldır'}
        loading={!!cancelling}
        onConfirm={() => {
          if (!confirmAction) return;
          const { kind, id } = confirmAction;
          void (kind === 'cancel' ? handleCancel(id) : handleRemove(id)).finally(() =>
            setConfirmAction(null)
          );
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </AppShell>
  );
}
