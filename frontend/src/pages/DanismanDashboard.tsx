/**
 * Analitik Danışman Dashboard — `/danisman`
 *
 * RACI: R/A "Başvuru değerlendirme".
 * Görev: gelen license_request + booking taleplerini değerlendirir.
 *   approve / reject / request_feedback (her ikisi) + swat (license_request için)
 *
 * Bu sayfa kullanıcı profili (kind='user') üzerinden çalışır; route guard
 * `requireUserGovernanceRole('analitik_danisman')` ile backend'de korunur.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import { BookingDetailModal } from '../components/BookingDetailModal';
import { EmptyState } from '../components/EmptyState';
import { KpiCard } from '../components/KpiCard';
import { Inbox, KeyRound } from 'lucide-react';
import { SlaBadge } from '../components/governance/SlaBadge';
import type { SlaInfo } from '../types';

/** Booking için client-side SLA hesabı — backend yoksa fallback. Standard=24sa, SWAT=120sa. */
function computeBookingSla(b: Booking): SlaInfo | null {
  if (b.status !== 'pending' && b.status !== 'feedback_requested') return null;
  const slaHours = b.reviewTrack === 'swat' ? 120 : 24;
  const created = new Date(b.createdAt).getTime();
  const deadlineMs = created + slaHours * 3600 * 1000;
  const remainingHours = (deadlineMs - Date.now()) / 3600 / 1000;
  return {
    checkpoint: b.reviewTrack === 'swat' ? 'SWAT İnceleme' : 'Başvuru Değerlendirme',
    deadline: new Date(deadlineMs).toISOString(),
    slaHours,
    remainingHours: Math.round(remainingHours * 10) / 10,
    overdue: remainingHours < 0,
  };
}
import { bookingPeriodLabel } from '../lib/utils';
import type {
  Booking,
  LicenseRequestStatus,
  LicenseRequestWithUser,
} from '../types';

type Tab = 'bookings' | 'licenses';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit' });
}

const STATUS_BADGE: Record<LicenseRequestStatus | Booking['status'], string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  rejected: 'bg-rose-100 text-rose-800 border-rose-300',
  feedback_requested: 'bg-blue-100 text-blue-800 border-blue-300',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-300',
};

const STATUS_LABEL: Record<LicenseRequestStatus | Booking['status'], string> = {
  pending: 'Beklemede',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  feedback_requested: 'Revize',
  cancelled: 'İptal Edildi',
};

interface ActionModalState {
  kind: 'booking' | 'license';
  id: string;
  title: string;
  action: 'approve' | 'reject' | 'request_feedback' | 'swat';
}

export default function DanismanDashboard() {
  const toast = useToast();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [licenseRequests, setLicenseRequests] = useState<LicenseRequestWithUser[]>([]);
  const [counts, setCounts] = useState<{
    licenseRequestsPending: number;
    bookingsPending: number;
  }>({ licenseRequestsPending: 0, bookingsPending: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('bookings');
  const [search, setSearch] = useState('');
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Detay görünümü: booking card'larına tıklayınca açılan tam BookingDetailModal.
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const selectedDetailBooking = useMemo(
    () => (detailBookingId ? bookings.find((b) => b.id === detailBookingId) ?? null : null),
    [bookings, detailBookingId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.danismanInbox();
      setBookings(res.bookings);
      setLicenseRequests(res.licenseRequests);
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

  useRealtimeEvents('danisman', (type) => {
    if (type.startsWith('booking.') || type === 'license.changed') void load();
  });

  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter(
      (b) =>
        b.projectName.toLowerCase().includes(q) ||
        (b.userFullName ?? '').toLowerCase().includes(q) ||
        b.roomCode.toLowerCase().includes(q)
    );
  }, [bookings, search]);

  const filteredLicenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return licenseRequests;
    return licenseRequests.filter(
      (r) =>
        (r.requestTitle ?? '').toLowerCase().includes(q) ||
        r.licenseName.toLowerCase().includes(q) ||
        r.userFullName.toLowerCase().includes(q)
    );
  }, [licenseRequests, search]);

  function openAction(
    kind: 'booking' | 'license',
    id: string,
    title: string,
    action: ActionModalState['action']
  ) {
    setActionModal({ kind, id, title, action });
    setFeedback('');
  }

  async function submitAction() {
    if (!actionModal) return;
    setSubmitting(true);
    try {
      // Booking review yetkisi kaldırıldı — yalnız lisans talepleri işlenir.
      await api.danismanReviewLicense(actionModal.id, {
        action: actionModal.action,
        feedback: feedback.trim() || undefined,
      });
      toast.push('success', 'Lisans talebi işlendi.');
      setActionModal(null);
      setFeedback('');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell
      kind="danisman"
      profileLink="/danisman"
      roleLabel="Analitik Danışman"
    >
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="role-badge-cyan">
            <span className="role-badge-dot bg-cyan-400" />
            Analitik Danışman
          </div>
          <h1 className="text-3xl font-extrabold text-kt-green-900">Gelen Talepler</h1>
          <p className="text-kt-gray-500 text-sm mt-1">
            Kullanıcı başvurularını değerlendirin — onayla, revize iste, reddet ya da SWAT'a yönlendirin.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 min-w-[280px] sm:min-w-[360px]">
          <KpiCard
            icon={Inbox}
            label="Bekleyen Booking"
            value={counts.bookingsPending}
            unit="talep"
            tone="cyan"
            compact
          />
          <KpiCard
            icon={KeyRound}
            label="Bekleyen Lisans"
            value={counts.licenseRequestsPending}
            unit="talep"
            tone="violet"
            compact
          />
        </div>
      </div>

      {/* Tab + arama */}
      <div className="card p-4 mb-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <div className="inline-flex p-1 bg-kt-gray-100 rounded-xl">
          <button
            type="button"
            onClick={() => setTab('bookings')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
              tab === 'bookings'
                ? 'bg-white text-kt-green-900 shadow-sm'
                : 'text-kt-gray-600 hover:text-kt-green-800'
            }`}
          >
            Oda Talepleri ({bookings.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('licenses')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
              tab === 'licenses'
                ? 'bg-white text-kt-green-900 shadow-sm'
                : 'text-kt-gray-600 hover:text-kt-green-800'
            }`}
          >
            Lisans Talepleri ({licenseRequests.length})
          </button>
        </div>
        <input
          type="search"
          className="input md:max-w-xs"
          placeholder="Talep / kullanıcı / proje ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={80}
        />
      </div>

      {/* Liste */}
      {loading ? (
        <div className="card p-10 text-center text-kt-gray-500">Yükleniyor…</div>
      ) : tab === 'bookings' ? (
        filteredBookings.length === 0 ? (
          <EmptyState
            icon="bookings"
            tone="cyan"
            title={search ? 'Eşleşen talep yok' : 'Bekleyen oda talebi yok'}
            description={search ? 'Arama terimini değiştirip tekrar deneyin.' : 'Yeni başvurular geldiğinde burada listelenecek. SSE bağlantısı açık.'}
          />
        ) : (
          <div className="space-y-3">
            {filteredBookings.map((b) => (
              <article
                key={b.id}
                onClick={() => setDetailBookingId(b.id)}
                className="card p-5 cursor-pointer hover:ring-2 hover:ring-kt-gold-300 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-xs font-bold text-kt-gold-700 tracking-wider">
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
                      {fmtDate(b.startDate)} – {fmtDate(b.endDate)} · {bookingPeriodLabel(b.period, b.periodMonths)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <SlaBadge sla={computeBookingSla(b)} />
                    <span
                      className={`text-[11px] font-bold px-2 py-1 rounded-md border ${STATUS_BADGE[b.status]}`}
                    >
                      {STATUS_LABEL[b.status]}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-kt-gray-700 line-clamp-2 mb-3">
                  {b.projectDescription}
                </p>
                {b.technologies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {b.technologies.slice(0, 6).map((t) => (
                      <span
                        key={t}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-kt-gray-100 text-kt-green-700"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className="flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-kt-gray-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[11px] text-kt-gray-400 italic">
                    Karta tıklayarak tüm detayları görüntüleyebilirsiniz →
                  </span>
                  <span className="text-[11px] px-2 py-1 rounded-md bg-kt-gray-100 text-kt-gray-500 font-semibold">
                    Salt görüntüleme — onay/ret yetkisi admin'dedir
                  </span>
                </div>
              </article>
            ))}
          </div>
        )
      ) : filteredLicenses.length === 0 ? (
        <EmptyState
          icon="licenses"
          tone="violet"
          title={search ? 'Eşleşen lisans talebi yok' : 'Bekleyen lisans talebi yok'}
          description={search ? 'Arama terimini değiştirip tekrar deneyin.' : 'Yeni lisans talepleri burada listelenecek (standard veya SWAT track).'}
        />
      ) : (
        <div className="space-y-3">
          {filteredLicenses.map((r) => {
            const title = r.requestTitle ?? r.licenseName;
            const reviewable = r.status === 'pending' || r.status === 'feedback_requested';
            return (
              <article key={r.id} className="card p-5">
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs text-kt-gray-500">
                        {r.userFullName} · {r.userEmail}
                      </span>
                      {r.reviewTrack === 'swat' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-300">
                          ⚡ SWAT
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-kt-green-900 truncate">{title}</h3>
                    <div className="text-xs text-kt-gray-500 mt-0.5">
                      {r.licenseName}
                      {r.vendor && <span> · {r.vendor}</span>}
                      {r.durationMonths && <span> · {r.durationMonths} ay</span>}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-1 rounded-md border shrink-0 ${STATUS_BADGE[r.status]}`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                {reviewable && (
                  <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-kt-gray-100">
                    {r.reviewTrack !== 'swat' && (
                      <button
                        type="button"
                        onClick={() => openAction('license', r.id, title, 'swat')}
                        className="btn-pill-info btn-pill-xs"
                      >
                        <span className="btn-pill-shimmer" />
                        <span className="relative z-10">⚡ SWAT'a Gönder</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openAction('license', r.id, title, 'request_feedback')}
                      className="btn-pill-warning btn-pill-xs"
                    >
                      <span className="btn-pill-shimmer" />
                      <span className="relative z-10">Revize İste</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openAction('license', r.id, title, 'reject')}
                      className="btn-pill-danger btn-pill-xs"
                    >
                      <span className="btn-pill-shimmer" />
                      <span className="relative z-10">Reddet</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openAction('license', r.id, title, 'approve')}
                      className="btn-pill-success btn-pill-xs"
                    >
                      <span className="btn-pill-shimmer" />
                      <span className="relative z-10">Onayla</span>
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Aksiyon modal */}
      {actionModal && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-kt-green-900 mb-1">
              {actionModal.action === 'approve' && 'Onaylansın mı?'}
              {actionModal.action === 'reject' && 'Reddedilsin mi?'}
              {actionModal.action === 'request_feedback' && 'Revize iste'}
              {actionModal.action === 'swat' && 'SWAT incelemesine gönder'}
            </h3>
            <p className="text-sm text-kt-gray-500 mb-4">{actionModal.title}</p>
            <label className="label">
              {actionModal.action === 'approve' ? 'Not (opsiyonel)' : 'Açıklama'}
            </label>
            <textarea
              className="textarea"
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              maxLength={1000}
              placeholder={
                actionModal.action === 'reject'
                  ? 'Reddedilme sebebi (kullanıcıya gösterilir)...'
                  : actionModal.action === 'request_feedback'
                    ? 'Kullanıcıdan ne istiyorsunuz?'
                    : actionModal.action === 'swat'
                      ? 'SWAT ekibine iletilecek not...'
                      : 'Opsiyonel onay notu...'
              }
              disabled={submitting}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                disabled={submitting}
                className="btn-pill-neutral btn-pill-sm"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={submitAction}
                disabled={submitting}
                className={`btn-pill-sm ${
                  actionModal.action === 'reject'
                    ? 'btn-pill-danger'
                    : actionModal.action === 'approve'
                      ? 'btn-pill-success'
                      : actionModal.action === 'request_feedback'
                        ? 'btn-pill-warning'
                        : 'btn-pill-info'
                }`}
              >
                <span className="btn-pill-shimmer" />
                <span className="relative z-10">{submitting ? 'Gönderiliyor…' : 'Onayla'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Tam booking detayı — SALT GÖRÜNTÜLEME (onay yetkisi admin'de). */}
      <BookingDetailModal
        booking={selectedDetailBooking}
        open={!!detailBookingId}
        onClose={() => setDetailBookingId(null)}
        viewerRole="danisman"
      />
    </AppShell>
  );
}
