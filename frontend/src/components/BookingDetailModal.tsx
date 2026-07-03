import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Booking, LifecycleStage, ReviewBookingPayload, StageEvent } from '../types';
import { MovableModalShell } from './MovableModalShell';
import { ProjectLifecycleBar } from './governance/ProjectLifecycleBar';
import { StatusBadge } from './StatusBadge';
import { bookingPeriodLabel } from '../lib/utils';
import { ModernTimeline } from './ModernTimeline';

const STAGE_LABEL: Record<LifecycleStage, string> = {
  application: 'Başvuru',
  development: 'Geliştirme',
  stage: 'Test',
  production: 'Pre-Production',
  live: 'Canlı',
};

const STAGE_ORDER: LifecycleStage[] = [
  'application',
  'development',
  'stage',
  'production',
  'live',
];

export type BookingDetailViewerRole = 'admin' | 'danisman' | 'arge' | 'user';

interface BookingDetailModalProps {
  booking: Booking | null;
  open: boolean;
  loading?: boolean;
  onClose: () => void;
  /** Hangi rol açıyor — UI'da görünür alanları ve aksiyon butonlarını belirler. Default 'admin'. */
  viewerRole?: BookingDetailViewerRole;
  /** Review aksiyonu (approve/reject/request_feedback). Admin her zaman; Danışman sadece pending booking için. */
  onReview?: (action: ReviewBookingPayload) => Promise<void>;
  /** Onaylı booking'i bir sonraki aşamaya ilerlet (admin + arge). */
  onAdvanceStage?: () => Promise<void>;
  /** Onaylı booking'i bir önceki aşamaya geri al (admin + arge). */
  onRegressStage?: () => Promise<void>;
  /** Kullanıcının stage advance talebini reddet (arge). Gerekçe (note) zorunlu değil ama destekleniyor. */
  onRejectAdvanceRequest?: (note?: string) => Promise<void>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR');
}

export function BookingDetailModal({
  booking,
  open,
  loading,
  onClose,
  viewerRole = 'admin',
  onReview,
  onAdvanceStage,
  onRegressStage,
  onRejectAdvanceRequest,
}: BookingDetailModalProps) {
  const [mode, setMode] = useState<'idle' | 'feedback' | 'reject' | 'reject_advance'>('idle');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');
  const [stageEvents, setStageEvents] = useState<StageEvent[]>([]);
  const [stageEventsLoading, setStageEventsLoading] = useState(false);

  // Modal her açıldığında "Genel" tab'ı ile başla
  useEffect(() => {
    if (open) setActiveTab('overview');
  }, [open, booking?.id]);

  // Yaşam döngüsü olaylarını çek — sadece admin endpoint var (henüz danisman/arge yok).
  // Booking onaylıysa history tab gösterilebilir.
  useEffect(() => {
    if (!open || !booking || viewerRole !== 'admin') {
      setStageEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setStageEventsLoading(true);
        const res = await api.adminGetBookingDetail(booking.id);
        if (!cancelled) setStageEvents(res.stageEvents);
      } catch {
        if (!cancelled) setStageEvents([]);
      } finally {
        if (!cancelled) setStageEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, booking, viewerRole]);

  if (!open || !booking) return null;

  function reset() {
    setMode('idle');
    setFeedback('');
    setError(null);
  }

  async function handleApprove() {
    if (!onReview) return;
    setError(null);
    await onReview({ action: 'approve' });
    reset();
  }

  async function handleReject() {
    if (!onReview) return;
    if (feedback.trim().length > 0 && feedback.trim().length < 5) {
      setError('Mesaj en az 5 karakter olmalı.');
      return;
    }
    setError(null);
    await onReview({ action: 'reject', feedback: feedback.trim() || undefined });
    reset();
  }

  async function handleFeedback() {
    if (!onReview) return;
    const v = feedback.trim();
    if (v.length < 10) {
      setError('Feedback en az 10 karakter olmalı.');
      return;
    }
    setError(null);
    await onReview({ action: 'request_feedback', feedback: v });
    reset();
  }

  async function handleRejectAdvance() {
    if (!onRejectAdvanceRequest) return;
    setError(null);
    await onRejectAdvanceRequest(feedback.trim() || undefined);
    reset();
  }

  // TEK ONAY: talebi yalnız ADMIN sonuçlandırır; danışman salt görüntüler.
  // Yalnız değerlendirilebilir durumlar (pending / feedback_requested) incelenir;
  // sonuçlanmış (approved/rejected) talep yeniden incelenmez (BOOKING_NOT_REVIEWABLE).
  const reviewable =
    !!onReview &&
    (booking.status === 'pending' || booking.status === 'feedback_requested') &&
    viewerRole === 'admin';
  const isReReview = false;

  // Yaşam döngüsü görünürlüğü: onaylı booking için admin, arge, kullanıcı görür (read-only kullanıcı için).
  const showLifecycle =
    booking.status === 'approved' && viewerRole !== 'danisman';
  // Stage advance/regress butonları sadece admin + arge'ye verilir.
  const canMutateStage =
    showLifecycle && (viewerRole === 'admin' || viewerRole === 'arge');
  // Ar-Ge advance request'i reddedebilir (admin de regress ile aynı sonucu yapabilir).
  const canRejectAdvance =
    viewerRole === 'arge' && !!booking.stageAdvanceRequestedAt && !!onRejectAdvanceRequest;

  return (
    <MovableModalShell open={open} onClose={() => !loading && onClose()} maxWidthClass="max-w-3xl">
        <div className="p-6 border-b border-kt-gray-100 bg-gradient-to-r from-kt-green-800 to-kt-green-900 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-1">
                Randevu Talebi · {booking.roomCode}
              </div>
              <h2 className="text-2xl font-bold mb-2">{booking.projectName}</h2>
              <StatusBadge status={booking.status} />
              {/* Onay durumu — bekleyen taleplerde admin kararı (tek onay merci). */}
              {(booking.status === 'pending' || booking.status === 'feedback_requested') && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span
                    className={`px-2 py-0.5 rounded-md font-semibold ${
                      booking.adminDecision === 'approved'
                        ? 'bg-emerald-500/30 text-emerald-50'
                        : booking.adminDecision === 'rejected'
                          ? 'bg-red-500/30 text-red-50'
                          : 'bg-white/15 text-white/80'
                    }`}
                  >
                    Admin onayı: {booking.adminDecision === 'approved' ? '✓ onayladı' : booking.adminDecision === 'rejected' ? '✕ reddetti' : '⏳ bekliyor'}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              disabled={loading}
              className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Tab navigation — sadece admin için "Geçmiş" tab'ı eklenir (endpoint admin-only).
            Diğer roller direkt "Genel" görünür kalır. */}
        {viewerRole === 'admin' && (
          <div className="px-6 border-b border-kt-gray-100 bg-white flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-3 text-sm font-semibold transition border-b-2 -mb-px ${
                activeTab === 'overview'
                  ? 'text-kt-green-900 border-kt-gold-400'
                  : 'text-kt-gray-500 border-transparent hover:text-kt-green-800'
              }`}
            >
              Genel
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-4 py-3 text-sm font-semibold transition border-b-2 -mb-px flex items-center gap-1.5 ${
                activeTab === 'history'
                  ? 'text-kt-green-900 border-kt-gold-400'
                  : 'text-kt-gray-500 border-transparent hover:text-kt-green-800'
              }`}
            >
              Geçmiş
              {(stageEvents?.length ?? 0) > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-kt-gold-100 text-kt-gold-700">
                  {(stageEvents?.length ?? 0)}
                </span>
              )}
            </button>
          </div>
        )}

        <div className="overflow-y-auto scrollbar-thin px-6 py-5 space-y-5 flex-1">
          {activeTab === 'history' && viewerRole === 'admin' ? (
            <section>
              <h3 className="font-bold text-kt-green-900 mb-3">Yaşam Döngüsü Zaman Çizelgesi</h3>
              {stageEventsLoading ? (
                <p className="text-sm text-kt-gray-500">Yükleniyor…</p>
              ) : (
                <ModernTimeline events={stageEvents ?? []} />
              )}
            </section>
          ) : (
            <>
          {isReReview && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-kt-gold-50 border border-kt-gold-200 text-kt-gold-900">
              <svg className="w-5 h-5 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <div className="text-sm">
                <div className="font-bold mb-0.5">Bu talep daha önce {booking.status === 'approved' ? 'onaylanmıştı' : 'reddedilmişti'}.</div>
                <p className="text-kt-gold-800">
                  Admin olarak kararı değiştirebilir, yeniden inceleyebilir veya kullanıcıdan düzeltme isteyebilirsiniz.
                  Yeni karar audit log'a kaydedilir.
                </p>
              </div>
            </div>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-kt-gray-50 rounded-xl p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-kt-gray-500 mb-2">Kullanıcı</div>
              <div className="flex items-center gap-3">
                {booking.userPhoto ? (
                  <img
                    src={booking.userPhoto}
                    alt={booking.userFullName || 'Kullanıcı'}
                    className="w-11 h-11 rounded-full object-cover border border-kt-gray-200 shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-kt-green-100 text-kt-green-700 font-bold flex items-center justify-center shrink-0">
                    {(booking.userFullName || booking.userEmail || '?').trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-kt-green-900 truncate">
                    {booking.userFullName || 'İsimsiz kullanıcı'}
                  </div>
                  <div className="text-sm text-kt-gray-600 break-all">{booking.userEmail}</div>
                </div>
              </div>
            </div>
            <div className="bg-kt-gray-50 rounded-xl p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-kt-gray-500 mb-1">Oda</div>
              <div className="font-semibold text-kt-green-900">{booking.roomName}</div>
              <div className="text-sm text-kt-gray-600">Kod: {booking.roomCode}</div>
            </div>
            <div className="bg-kt-gray-50 rounded-xl p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-kt-gray-500 mb-1">Süre</div>
              <div className="font-semibold text-kt-green-900">{bookingPeriodLabel(booking.period, booking.periodMonths)}</div>
              <div className="text-sm text-kt-gray-600">{fmtDate(booking.startDate)} — {fmtDate(booking.endDate)}</div>
            </div>
            <div className="bg-kt-gray-50 rounded-xl p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-kt-gray-500 mb-1">Talep Zamanı</div>
              <div className="font-semibold text-kt-green-900">{fmtDateTime(booking.createdAt)}</div>
              {booking.reviewedAt && (
                <div className="text-sm text-kt-gray-600">İncelendi: {fmtDateTime(booking.reviewedAt)}</div>
              )}
            </div>
          </section>

          <section>
            <h3 className="font-bold text-kt-green-900 mb-2">Proje Açıklaması</h3>
            <p className="text-kt-green-800 whitespace-pre-wrap leading-relaxed">{booking.projectDescription}</p>
          </section>

          <section>
            <h3 className="font-bold text-kt-green-900 mb-2">Yardım Talebi</h3>
            <p className="text-kt-green-800 whitespace-pre-wrap leading-relaxed">{booking.helpNeeded}</p>
          </section>

          <section>
            <h3 className="font-bold text-kt-green-900 mb-2">
              Teknolojiler <span className="text-sm text-kt-gray-500 font-normal">({booking.technologies.length})</span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {booking.technologies.map((t) => (
                <span key={t} className="px-3 py-1 rounded-lg bg-kt-gold-50 text-kt-gold-700 text-sm font-semibold border border-kt-gold-100">
                  {t}
                </span>
              ))}
            </div>
          </section>

          {/* Yaşam döngüsü — onaylı booking için (Danışman görmez, çünkü onlar approve öncesi inceler). */}
          {showLifecycle && (
            <section className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-kt-green-900">Proje Yaşam Döngüsü</h3>
                    {booking.reviewTrack === 'swat' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300">
                        ⚡ SWAT
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-kt-gray-600">
                    Şu anki aşama:{' '}
                    <strong className="text-cyan-800">
                      {STAGE_LABEL[booking.lifecycleStage]}
                    </strong>{' '}
                    · Aşamaya giriş:{' '}
                    {new Date(booking.stageEnteredAt).toLocaleDateString('tr-TR')}
                  </p>
                </div>
                {canMutateStage && (() => {
                  const idx = STAGE_ORDER.indexOf(booking.lifecycleStage);
                  const isTerminal = idx >= STAGE_ORDER.length - 1;
                  const isAtStart = idx <= 1;
                  const next = !isTerminal ? STAGE_ORDER[idx + 1] : null;
                  const prev = !isAtStart ? STAGE_ORDER[idx - 1] : null;
                  return (
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {onRegressStage && prev && (
                        <button
                          type="button"
                          onClick={() => onRegressStage()}
                          disabled={loading}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md text-kt-gray-700 hover:bg-kt-gray-100 border border-kt-gray-300 transition"
                          title={`${STAGE_LABEL[prev]} aşamasına geri al`}
                        >
                          ← {STAGE_LABEL[prev]}
                        </button>
                      )}
                      {onAdvanceStage && next && (
                        <button
                          type="button"
                          onClick={() => onAdvanceStage()}
                          disabled={loading}
                          className="btn-primary text-xs px-3 py-1.5"
                        >
                          → {STAGE_LABEL[next]}
                        </button>
                      )}
                      {isTerminal && (
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-md">
                          ● Canlı
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <ProjectLifecycleBar stage={booking.lifecycleStage} />

              {/* Kullanıcı'nın ilerletme talebi */}
              {booking.stageAdvanceRequestedAt && (
                <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900">
                  <div className="flex items-start gap-2">
                    <svg
                      className="w-4 h-4 mt-0.5 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                      />
                    </svg>
                    <div className="text-xs flex-1">
                      <div className="font-bold mb-0.5">
                        Kullanıcı aşama ilerletmesi talep etti
                      </div>
                      <div className="opacity-90">
                        {new Date(booking.stageAdvanceRequestedAt).toLocaleString('tr-TR', {
                          day: '2-digit',
                          month: 'short',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      {booking.stageAdvanceNote && (
                        <div className="italic mt-1 p-2 bg-white/60 rounded">
                          "{booking.stageAdvanceNote}"
                        </div>
                      )}
                      <div className="mt-1 text-[11px] opacity-80">
                        {canMutateStage
                          ? 'Yukarıdaki "→" düğmesiyle onaylayın veya gerekirse aşamayı geri alın.'
                          : 'Ar-Ge mühendisi inceleyip karar verecek.'}
                      </div>
                      {canRejectAdvance && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => setMode('reject_advance')}
                            disabled={loading || mode === 'reject_advance'}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-md text-rose-700 bg-rose-100 hover:bg-rose-200 border border-rose-300 transition"
                          >
                            ✕ Talebi Reddet (gerekçeyle)
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {booking.adminFeedback && (
            <section>
              <h3 className="font-bold text-kt-green-900 mb-2">Önceki Geri Bildirim</h3>
              <div className="p-4 bg-blue-50 border-l-4 border-blue-400 rounded-r-xl">
                <p className="text-blue-900 whitespace-pre-wrap leading-relaxed">{booking.adminFeedback}</p>
              </div>
            </section>
          )}

          {mode !== 'idle' && (
            <section className="animate-fade-in">
              <label className="label">
                {mode === 'feedback' && 'Kullanıcıdan Beklenen Düzeltme'}
                {mode === 'reject' && 'Red Sebebi (opsiyonel)'}
                {mode === 'reject_advance' && 'Aşama İlerletme Talebini Reddetme Gerekçesi (opsiyonel)'}
              </label>
              <textarea
                className="textarea"
                rows={4}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                maxLength={2000}
                placeholder={
                  mode === 'feedback'
                    ? 'Ör: Lütfen proje açıklamasında hedef kitleyi de belirtin.'
                    : mode === 'reject_advance'
                      ? 'Ör: Build aşamasında security gate başarısız, kullanıcı düzeltmeden Stage onaylanmayacak.'
                      : 'Ör: Bu hafta için tüm odalar workshop için ayrıldı.'
                }
              />
              {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
            </section>
          )}
            </>
          )}
        </div>

        {/* Action footer — role-aware. History tab açıkken sadece "Kapat" gösterilir. */}
        <div className="px-6 py-4 border-t border-kt-gray-100 bg-kt-gray-50 flex flex-wrap items-center justify-end gap-2">
          {activeTab === 'history' ? (
            <button onClick={onClose} className="btn-ghost" disabled={loading}>Kapat</button>
          ) : (
          <>
          {mode === 'idle' && (
            <>
              <button onClick={onClose} className="btn-ghost" disabled={loading}>Kapat</button>
              {reviewable && (
                <>
                  <button onClick={() => setMode('feedback')} className="btn-secondary" disabled={loading}>
                    💬 Düzeltme İste
                  </button>
                  <button onClick={() => setMode('reject')} className="btn-danger" disabled={loading}>
                    ✕ Reddet
                  </button>
                  <button onClick={handleApprove} className="btn-success" disabled={loading}>
                    ✓ Onayla
                  </button>
                </>
              )}
            </>
          )}
          {mode !== 'idle' && (
            <>
              <button onClick={reset} className="btn-ghost" disabled={loading}>Vazgeç</button>
              {mode === 'feedback' && (
                <button onClick={handleFeedback} className="btn-primary" disabled={loading}>
                  {loading ? 'Gönderiliyor...' : 'Geri Bildirimi Gönder'}
                </button>
              )}
              {mode === 'reject' && (
                <button onClick={handleReject} className="btn-danger" disabled={loading}>
                  {loading ? 'Gönderiliyor...' : 'Reddi Onayla'}
                </button>
              )}
              {mode === 'reject_advance' && (
                <button onClick={handleRejectAdvance} className="btn-danger" disabled={loading}>
                  {loading ? 'Gönderiliyor...' : 'Talebi Reddet'}
                </button>
              )}
            </>
          )}
          </>
          )}
        </div>
    </MovableModalShell>
  );
}
