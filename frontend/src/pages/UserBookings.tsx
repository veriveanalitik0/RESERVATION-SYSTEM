import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { AppointmentModal } from '../components/AppointmentModal';
import { BookingDetailModal } from '../components/BookingDetailModal';
import { BookingModal } from '../components/BookingModal';
import { EmptyState } from '../components/EmptyState';
import { HardwareRequestsTab } from '../components/HardwareRequestsTab';
import { LicenseRequestsTab } from '../components/LicenseRequestsTab';
import { ProjectLifecycleBar } from '../components/governance/ProjectLifecycleBar';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Appointment, Booking, CreateBookingPayload, Room } from '../types';
import { bookingPeriodLabel } from '../lib/utils';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function UserBookings() {
  const toast = useToast();
  const [tab, setTab] = useState<'rooms' | 'licenses' | 'hardware'>('rooms');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState<Booking | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<Booking | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Detay modal — booking'in tüm context'i, lifecycle ve thread tek modal'da (read-only view).
  const [detailId, setDetailId] = useState<string | null>(null);
  const selectedDetail = detailId ? bookings.find((b) => b.id === detailId) ?? null : null;

  // Randevu state'i: hangi booking için modal açık + booking → randevu listesi map'i
  const [scheduling, setScheduling] = useState<Booking | null>(null);
  const [confirmCancelApptId, setConfirmCancelApptId] = useState<string | null>(null);
  const [appointmentsByBooking, setAppointmentsByBooking] = useState<
    Record<string, Appointment[]>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, rRes] = await Promise.all([api.listUserBookings(), api.listUserRooms()]);
      setBookings(bRes.bookings);
      setRooms(rRes.rooms);

      // Onaylanmış booking'lerin randevularını paralelle çek
      const approved = bRes.bookings.filter((b) => b.status === 'approved');
      const apptRes = await Promise.all(
        approved.map((b) =>
          api
            .listBookingAppointments(b.id)
            .then((r) => [b.id, r.appointments] as const)
            .catch(() => [b.id, [] as Appointment[]] as const)
        )
      );
      setAppointmentsByBooking(Object.fromEntries(apptRes));
    } catch (err) {
      toast.push('error', (err as Error).message || 'Talepler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  async function submitAppointment(payload: {
    bookingId: string;
    startAt: string;
    endAt: string;
    title?: string;
    notes?: string;
  }) {
    setSubmitting(true);
    try {
      await api.createAppointment(payload);
      toast.push('success', 'Randevunuz takvime eklendi.');
      setScheduling(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Randevu oluşturulamadı.');
      throw err; // modal hata mesajını yakalasın
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelAppointment(appointmentId: string) {
    try {
      await api.cancelAppointment(appointmentId);
      toast.push('info', 'Randevu iptal edildi.');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İptal başarısız.');
    }
  }

  async function requestStageAdvance(bookingId: string, note?: string) {
    try {
      await api.requestStageAdvance(bookingId, note);
      toast.push('success', 'Canlıya geçiş talebiniz alındı ve admin onayına iletildi.');
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Talep oluşturulamadı.');
    }
  }

  async function selfAdvanceStage(bookingId: string) {
    try {
      const res = await api.selfAdvanceStage(bookingId);
      toast.push('success', `Aşama ilerletildi: ${STAGE_LABEL[res.booking.lifecycleStage] ?? res.booking.lifecycleStage}.`);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Aşama ilerletilemedi.');
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  // Real-time: kendi booking'in admin tarafından onaylanırsa anında refresh
  useRealtimeEvents('user', (type, data) => {
    if (
      type === 'booking.reviewed' ||
      type === 'booking.created' ||
      type === 'booking.updated' ||
      type === 'waitlist.changed' ||
      type === 'appointment.changed'
    ) {
      load();
      if (type === 'booking.reviewed' && data && typeof data === 'object') {
        const status = (data as { status?: string }).status;
        if (status === 'approved') toast.push('success', 'Talebiniz onaylandı.');
        else if (status === 'rejected') toast.push('info', 'Talebiniz reddedildi.');
        else if (status === 'feedback_requested')
          toast.push('info', 'Admin sizden düzeltme istedi.');
      }
    }
  });

  function startEdit(booking: Booking) {
    setEditing(booking);
  }

  async function submitEdit(payload: CreateBookingPayload) {
    if (!editing) return;
    setSubmitting(true);
    try {
      await api.updateBooking(editing.id, payload);
      toast.push('success', 'Talebiniz güncellendi ve yeniden onay sürecine iletildi. Sonuçlandığında bilgilendirileceksiniz.');
      setEditing(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Güncelleme başarısız.');
    } finally {
      setSubmitting(false);
    }
  }

  async function doCancelApproved(booking: Booking) {
    setCancelling(true);
    try {
      await api.cancelApprovedBooking(booking.id);
      toast.push('info', 'Rezervasyonunuz iptal edildi. Oda diğer kullanıcılara açıldı.');
      setConfirmCancel(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'İptal başarısız.');
    } finally {
      setCancelling(false);
    }
  }

  async function doWithdraw(booking: Booking) {
    setWithdrawing(booking.id);
    try {
      await api.deleteBooking(booking.id);
      toast.push('info', 'Talebiniz geri çekildi.');
      setConfirmWithdraw(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Geri çekme başarısız.');
    } finally {
      setWithdrawing(null);
    }
  }

  async function doPurge(booking: Booking) {
    setWithdrawing(booking.id);
    try {
      await api.deleteBooking(booking.id);
      toast.push('info', 'Proje kalıcı olarak silindi.');
      setConfirmPurge(null);
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Silme başarısız.');
    } finally {
      setWithdrawing(null);
    }
  }

  function canModify(status: Booking['status']) {
    return status === 'pending' || status === 'feedback_requested';
  }

  /** Kalıcı silinebilir: iptal edilmiş ya da canlıya alınmış (tamamlanmış) proje. */
  function canPurge(b: Booking) {
    return b.status === 'cancelled' || (b.status === 'approved' && b.lifecycleStage === 'live');
  }

  /** Edit modal için oda objesini bul (booking sadece roomId tutuyor). */
  function roomForBooking(b: Booking): Room | null {
    return rooms.find((r) => r.id === b.roomId) ?? null;
  }

  return (
    <AppShell kind="user">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Taleplerim</h1>
        <p className="text-kt-gray-500">Oda, lisans ve donanım taleplerinizi buradan yönetin.</p>
      </div>

      <div className="flex gap-1 mb-6 border-b border-kt-gray-200">
        {([
          ['rooms', 'Oda Talepleri'],
          ['licenses', 'Lisans Talepleri'],
          ['hardware', 'Donanım Talepleri'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-kt-gold-500 text-kt-green-900'
                : 'border-transparent text-kt-gray-500 hover:text-kt-green-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'licenses' && <LicenseRequestsTab />}
      {tab === 'hardware' && <HardwareRequestsTab />}

      {tab === 'rooms' && (loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-32" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <EmptyState
          icon="bookings"
          title="Henüz bir talebiniz yok"
          description="AI Lab odalarımızdan birini seçip ilk randevu talebinizi gönderin. Admin onayından sonra oda sizin olur."
          tone="cyan"
          action={
            <Link to="/rooms" className="btn-primary inline-flex">
              Odaları Görüntüle
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {bookings.map((b) => {
            const modifiable = canModify(b.status);
            const isBeingWithdrawn = withdrawing === b.id;
            return (
              <article key={b.id} className="card p-6 animate-fade-in">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-kt-gold-600 tracking-wider">{b.roomCode}</span>
                      <span className="text-kt-gray-300">·</span>
                      <span className="text-sm text-kt-gray-500">{b.roomName}</span>
                    </div>
                    <h3 className="text-xl font-bold text-kt-green-900 mb-1">{b.projectName}</h3>
                    <div className="text-sm text-kt-gray-600">
                      {fmtDate(b.startDate)} — {fmtDate(b.endDate)} · {bookingPeriodLabel(b.period, b.periodMonths)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={b.status} />
                    <button
                      type="button"
                      onClick={() => setDetailId(b.id)}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-md text-kt-green-700 border border-kt-gray-200 bg-white hover:border-kt-gold-400 hover:text-kt-gold-700 transition"
                    >
                      Detay →
                    </button>
                  </div>
                </div>

                <p className="text-sm text-kt-gray-700 mb-3 line-clamp-2">{b.projectDescription}</p>

                {/* Onaylı booking için proje yaşam döngüsü çubuğu */}
                {b.status === 'approved' && (
                  <LifecycleSection booking={b} onRequest={requestStageAdvance} onSelfAdvance={selfAdvanceStage} />
                )}

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {b.technologies.slice(0, 8).map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-md bg-kt-gray-100 text-kt-green-700 text-xs font-medium">
                      {t}
                    </span>
                  ))}
                  {b.technologies.length > 8 && (
                    <span className="px-2 py-0.5 text-xs text-kt-gray-500">
                      +{b.technologies.length - 8} daha
                    </span>
                  )}
                </div>

                {/* Onaylı booking için randevu listesi + ekleme */}
                {b.status === 'approved' && (
                  <AppointmentsSection
                    booking={b}
                    appointments={appointmentsByBooking[b.id] ?? []}
                    onAdd={() => setScheduling(b)}
                    onCancel={(id) => setConfirmCancelApptId(id)}
                  />
                )}

                {b.adminFeedback && (
                  <div
                    className={`mt-4 p-4 rounded-xl border-l-4 ${
                      b.status === 'rejected'
                        ? 'bg-red-50 border-red-400'
                        : b.status === 'feedback_requested'
                        ? 'bg-blue-50 border-blue-400'
                        : 'bg-emerald-50 border-emerald-400'
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wider mb-1 text-kt-green-700">
                      Admin Geri Bildirimi
                    </div>
                    <p className="text-sm text-kt-green-800 whitespace-pre-wrap">{b.adminFeedback}</p>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-kt-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-xs text-kt-gray-400 flex items-center gap-3 flex-wrap">
                    <span>Gönderildi: {fmtDate(b.createdAt)}</span>
                    {b.reviewedAt && <span>İncelendi: {fmtDate(b.reviewedAt)}</span>}
                  </div>
                  {modifiable && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(b)}
                        disabled={isBeingWithdrawn}
                        className="btn-secondary text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                        Düzenle
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmWithdraw(b)}
                        disabled={isBeingWithdrawn}
                        className="btn text-sm bg-red-50 text-red-700 hover:bg-red-100 border border-red-100"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>
                        </svg>
                        Geri Çek
                      </button>
                    </div>
                  )}
                  {b.status === 'approved' && b.lifecycleStage !== 'live' && (
                    <button
                      type="button"
                      onClick={() => setConfirmCancel(b)}
                      disabled={cancelling}
                      className="btn text-sm bg-red-50 text-red-700 hover:bg-red-100 border border-red-100"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
                      </svg>
                      Rezervasyonu İptal Et
                    </button>
                  )}
                  {canPurge(b) && (
                    <button
                      type="button"
                      onClick={() => setConfirmPurge(b)}
                      disabled={isBeingWithdrawn}
                      className="btn text-sm bg-red-600 text-white hover:bg-red-700 border border-red-600"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>
                      </svg>
                      {b.status === 'cancelled' ? 'İptal Edilen Projeyi Sil' : 'Tamamlanan Projeyi Sil'}
                    </button>
                  )}
                  {!modifiable && b.status !== 'approved' && !canPurge(b) && (
                    <span className="text-xs text-kt-gray-400 italic">
                      Reddedilmiş talepler değiştirilemez.
                    </span>
                  )}
                </div>

              </article>
            );
          })}
        </div>
      ))}

      {/* Edit Modal */}
      <BookingModal
        room={editing ? roomForBooking(editing) : null}
        open={!!editing}
        loading={submitting}
        editingBooking={editing}
        onClose={() => !submitting && setEditing(null)}
        onSubmit={submitEdit}
      />

      {/* Detail Modal (read-only) — booking tüm context'i + thread + lifecycle */}
      <BookingDetailModal
        booking={selectedDetail}
        open={!!detailId}
        loading={false}
        onClose={() => setDetailId(null)}
        viewerRole="user"
      />

      {/* Appointment Modal */}
      {scheduling && (
        <AppointmentModal
          booking={scheduling}
          onClose={() => setScheduling(null)}
          onSubmit={submitAppointment}
          submitting={submitting}
        />
      )}

      {/* Withdraw Confirmation */}
      {confirmWithdraw && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-kt-green-950/70 backdrop-blur-sm animate-fade-in"
        >
          <div
            className="bg-white rounded-2xl shadow-kt-card max-w-md w-full p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-kt-green-900 mb-1">Talebi geri çek?</h3>
                <p className="text-sm text-kt-gray-600">
                  <span className="font-semibold">{confirmWithdraw.projectName}</span> projesi için
                  gönderdiğin <span className="font-mono text-xs">{confirmWithdraw.roomCode}</span> talebi kaldırılacak.
                  Bu işlem geri alınamaz.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmWithdraw(null)}
                disabled={!!withdrawing}
                className="btn-ghost"
              >
                Vazgeç
              </button>
              <button
                onClick={() => doWithdraw(confirmWithdraw)}
                disabled={!!withdrawing}
                className="btn-danger"
              >
                {withdrawing ? 'Çekiliyor...' : 'Evet, geri çek'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <ConfirmDialog
        open={!!confirmCancel}
        title="Rezervasyon iptal edilsin mi?"
        message={`"${confirmCancel?.projectName ?? ''}" projesinin ${confirmCancel?.roomCode ?? ''} rezervasyonu iptal edilecek. Bu işlem geri alınamaz; oda diğer kullanıcılara ve bekleme listesine açılır.`}
        confirmLabel="Evet, iptal et"
        loading={cancelling}
        onConfirm={() => {
          if (confirmCancel) void doCancelApproved(confirmCancel);
        }}
        onCancel={() => setConfirmCancel(null)}
      />
      <ConfirmDialog
        open={!!confirmPurge}
        title="Proje kalıcı olarak silinsin mi?"
        message={`"${confirmPurge?.projectName ?? ''}" projesi ve tüm geçmişi (randevular, aşama kayıtları, beğeni/yorumlar) kalıcı olarak silinecek. Bu işlem GERİ ALINAMAZ.`}
        confirmLabel="Evet, kalıcı sil"
        loading={withdrawing === confirmPurge?.id}
        onConfirm={() => {
          if (confirmPurge) void doPurge(confirmPurge);
        }}
        onCancel={() => setConfirmPurge(null)}
      />
      <ConfirmDialog
        open={!!confirmCancelApptId}
        title="Randevu iptal edilsin mi?"
        message="Bu saatli randevu iptal edilecek. Bu işlem geri alınamaz."
        confirmLabel="Evet, iptal et"
        onConfirm={() => {
          if (confirmCancelApptId) void cancelAppointment(confirmCancelApptId);
          setConfirmCancelApptId(null);
        }}
        onCancel={() => setConfirmCancelApptId(null)}
      />
    </AppShell>
  );
}

/* ============================================================
 * Onaylı booking kartı içinde proje yaşam döngüsü + ilerletme talebi
 * ============================================================ */

const STAGE_LABEL: Record<string, string> = {
  application: 'Başvuru',
  development: 'Geliştirme',
  stage: 'Test',
  production: 'Pre-Production',
  live: 'Canlı',
};
const STAGE_ORDER = ['application', 'development', 'stage', 'production', 'live'] as const;

function LifecycleSection({
  booking,
  onRequest,
  onSelfAdvance,
}: {
  booking: Booking;
  onRequest: (bookingId: string, note?: string) => Promise<void>;
  onSelfAdvance: (bookingId: string) => Promise<void>;
}) {
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState('');

  const currentIdx = STAGE_ORDER.indexOf(booking.lifecycleStage);
  const isTerminal = currentIdx >= STAGE_ORDER.length - 1;
  const nextStage = !isTerminal ? STAGE_ORDER[currentIdx + 1] : null;
  const hasPendingRequest = !!booking.stageAdvanceRequestedAt;
  // Canlıya geçiş onay ister; öncesi self-servis. application → development
  // otomatik (ilk onayda) olduğundan orada buton gösterilmez.
  const nextIsLive = nextStage === 'live';
  const canSelfAdvance =
    !!nextStage && !nextIsLive && booking.lifecycleStage !== 'application';

  async function submit() {
    setRequesting(true);
    try {
      await onRequest(booking.id, note.trim() || undefined);
      setNote('');
    } finally {
      setRequesting(false);
    }
  }

  async function selfAdvance() {
    setRequesting(true);
    try {
      await onSelfAdvance(booking.id);
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="my-4">
      <ProjectLifecycleBar stage={booking.lifecycleStage} />

      {/* Bekleyen talep — admin'e gitti */}
      {hasPendingRequest && (
        <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
          <div className="flex items-start gap-2">
            <svg
              className="w-4 h-4 mt-0.5 shrink-0 text-amber-700"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="text-xs flex-1">
              <div className="font-semibold mb-0.5">
                Canlıya geçiş talebiniz admin onayını bekliyor.
              </div>
              <div className="opacity-80">
                {new Date(booking.stageAdvanceRequestedAt!).toLocaleString('tr-TR', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {booking.stageAdvanceNote && (
                  <span className="italic">
                    {' '}
                    · "{booking.stageAdvanceNote}"
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Canlı ÖNCESİ aşamalar: kullanıcı onaysız kendisi ilerletir. */}
      {!hasPendingRequest && canSelfAdvance && nextStage && (
        <div className="mt-3 p-3 rounded-xl bg-gradient-to-br from-kt-green-50 to-emerald-50 border border-kt-green-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-kt-green-900 font-semibold">
              <span className="opacity-80">Sıradaki aşama:</span>{' '}
              <strong>{STAGE_LABEL[nextStage]}</strong> — onay gerekmez, kendin ilerletebilirsin.
            </p>
            <button
              type="button"
              onClick={() => void selfAdvance()}
              disabled={requesting}
              className="btn-primary text-xs px-3 py-1.5"
            >
              {requesting ? 'İlerletiliyor…' : `${STAGE_LABEL[nextStage]} aşamasına geç`}
            </button>
          </div>
        </div>
      )}

      {/* CANLIYA geçiş: admin onayı zorunlu — talep formu. */}
      {!hasPendingRequest && nextIsLive && nextStage && (
        <div className="mt-3 p-3 rounded-xl bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200">
          <div className="flex items-center gap-2 mb-2">
            <svg
              className="w-4 h-4 text-cyan-700 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
            <p className="text-xs text-cyan-900 font-semibold">
              <span className="opacity-80">Sıradaki aşama:</span>{' '}
              <strong>{STAGE_LABEL[nextStage]}</strong> — canlıya geçiş admin onayını gerektirir.
            </p>
          </div>
          <textarea
            className="textarea text-xs min-h-[48px] mb-2"
            placeholder="Hangi kriteri karşıladığınızı kısaca anlatın (opsiyonel)..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            disabled={requesting}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={requesting}
              className="btn-primary text-xs px-3 py-1.5"
            >
              {requesting ? 'Gönderiliyor…' : 'Canlıya geçiş onayı iste'}
            </button>
          </div>
        </div>
      )}

      {isTerminal && (
        <div className="mt-3 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          ● Projeniz canlı aşamada — yaşam döngüsü tamamlandı.
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * Onaylı booking kartı içinde randevu listesi + "Randevu Ekle"
 * ============================================================ */

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AppointmentsSection({
  booking: _booking,
  appointments,
  onAdd,
  onCancel,
}: {
  booking: Booking;
  appointments: Appointment[];
  onAdd: () => void;
  onCancel: (id: string) => void;
}) {
  const upcoming = appointments
    .filter((a) => a.status === 'scheduled' && new Date(a.endAt).getTime() >= Date.now())
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <div className="my-4 p-4 rounded-xl bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-cyan-700"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <h4 className="text-sm font-bold text-cyan-900">Odaya geliş randevuları</h4>
          <span className="text-xs text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full font-semibold">
            {upcoming.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="btn-primary text-xs px-3 py-1.5"
        >
          + Randevu Ekle
        </button>
      </div>

      {upcoming.length === 0 ? (
        <p className="text-xs text-cyan-700/80 italic">
          Henüz randevu yok. Odaya gelmek istediğiniz tarihler için randevu oluşturun.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {upcoming.slice(0, 5).map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 text-xs bg-white/80 rounded-lg px-3 py-2 border border-cyan-200/60"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-kt-green-900 truncate">
                  {a.title}
                </div>
                <div className="text-cyan-800 mt-0.5">
                  {fmtTime(a.startAt)} – {new Date(a.endAt).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onCancel(a.id)}
                className="text-rose-600 hover:text-rose-800 font-semibold shrink-0"
                title="Randevuyu iptal et"
              >
                İptal
              </button>
            </li>
          ))}
          {upcoming.length > 5 && (
            <li className="text-[11px] text-cyan-700 px-3">
              + {upcoming.length - 5} ek randevu — tamamı{' '}
              <Link to="/takvim" className="underline font-semibold">
                takvimde
              </Link>
              .
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
