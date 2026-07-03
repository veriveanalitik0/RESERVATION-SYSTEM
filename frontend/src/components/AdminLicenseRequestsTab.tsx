/**
 * Admin Başvuru / Proje Yönetişim sekmesi.
 *
 * - Başvuru değerlendirme: approve / reject / request_feedback / swat
 * - SWAT kuyruğu filtresi
 * - Onaylı projeler için yaşam döngüsü yönetişim paneli (kapı/onay/aşama)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import type {
  GovernanceAdmin,
  LicenseRequestStatus,
  LicenseRequestWithUser,
  ProjectType,
} from '../types';
import { SlaBadge } from './governance/SlaBadge';
import { AdminGovernancePanel } from './governance/AdminGovernancePanel';

type ReviewAction = 'approve' | 'reject' | 'request_feedback';
type FilterKey = 'all' | LicenseRequestStatus;

const DURATION_LABEL: Record<number, string> = {
  1: '1 ay',
  3: '3 ay',
  6: '6 ay',
  12: '1 yıl',
};

function statusBadge(status: LicenseRequestStatus) {
  switch (status) {
    case 'pending':
      return { label: 'Beklemede', cls: 'badge-pending' };
    case 'approved':
      return { label: 'Onaylandı', cls: 'badge-approved' };
    case 'rejected':
      return { label: 'Reddedildi', cls: 'badge-rejected' };
    case 'feedback_requested':
      return { label: 'Revize İsteniyor', cls: 'badge-feedback' };
  }
}

function projectTypeLabel(t: ProjectType | null): string | null {
  if (t === 'poc') return 'Deneysel (PoC)';
  if (t === 'integration') return 'Kuruma Entegre';
  return null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const ACTION_META: Record<ReviewAction, { title: string; button: string; cls: string; toast: string }> = {
  approve: { title: 'onaylansın mı?', button: 'Onayla', cls: 'btn-success', toast: 'onaylandı' },
  reject: { title: 'reddedilsin mı?', button: 'Reddet', cls: 'btn-danger', toast: 'reddedildi' },
  request_feedback: { title: 'için revize iste', button: 'Revize İste', cls: 'btn-primary', toast: 'revize istendi' },
};

interface AdminLicenseRequestsTabProps {
  /** Read-only görüntüleyen (danışman / Ar-Ge) için review aksiyonlarını gizler. */
  readOnly?: boolean;
}

export function AdminLicenseRequestsTab({ readOnly = false }: AdminLicenseRequestsTabProps = {}) {
  const toast = useToast();
  const { admin } = useAuth();
  const [items, setItems] = useState<LicenseRequestWithUser[]>([]);
  const [admins, setAdmins] = useState<GovernanceAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [modalReq, setModalReq] = useState<LicenseRequestWithUser | null>(null);
  const [modalAction, setModalAction] = useState<ReviewAction | null>(null);
  const [modalFeedback, setModalFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, adminRes] = await Promise.all([
        api.adminListLicenseRequests(),
        api.adminGovernanceAdmins().catch(() => ({ admins: [] as GovernanceAdmin[] })),
      ]);
      setItems(res.items);
      setAdmins(adminRes.admins);
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        (r.requestTitle ?? '').toLowerCase().includes(q) ||
        r.licenseName.toLowerCase().includes(q) ||
        r.userFullName.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        (r.vendor ?? '').toLowerCase().includes(q) ||
        (r.userDepartment ?? '').toLowerCase().includes(q) ||
        r.items.some(
          (it) =>
            it.licenseName.toLowerCase().includes(q) ||
            (it.vendor ?? '').toLowerCase().includes(q)
        )
      );
    });
  }, [items, statusFilter, search]);

  const counts = useMemo(
    () => ({
      all: items.length,
      pending: items.filter((r) => r.status === 'pending').length,
      feedback_requested: items.filter((r) => r.status === 'feedback_requested').length,
      approved: items.filter((r) => r.status === 'approved').length,
      rejected: items.filter((r) => r.status === 'rejected').length,
    }),
    [items]
  );

  function openModal(req: LicenseRequestWithUser, action: ReviewAction) {
    setModalReq(req);
    setModalAction(action);
    setModalFeedback(req.adminFeedback ?? '');
  }

  function closeModal() {
    setModalReq(null);
    setModalAction(null);
    setModalFeedback('');
  }

  async function submitReview() {
    if (!modalReq || !modalAction || submitting) return;
    setSubmitting(true);
    try {
      await api.adminReviewLicenseRequest(modalReq.id, {
        action: modalAction,
        adminFeedback: modalFeedback.trim() || null,
      });
      toast.push('success', `Başvuru ${ACTION_META[modalAction].toast}.`);
      closeModal();
      await load();
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const FILTERS: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: `Tümü (${counts.all})` },
    { key: 'pending', label: `Beklemede (${counts.pending})` },
    { key: 'feedback_requested', label: `Revize (${counts.feedback_requested})` },
    { key: 'approved', label: `Onaylanan (${counts.approved})` },
    { key: 'rejected', label: `Reddedilen (${counts.rejected})` },
  ];

  return (
    <>
      {/* Filter + search */}
      <div className="card p-4 md:p-5 mb-4">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="flex gap-1.5 p-1 bg-kt-gray-100 rounded-xl self-start flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all ${
                  statusFilter === f.key
                    ? 'bg-white text-kt-green-900 shadow-kt-soft'
                    : 'text-kt-gray-500 hover:text-kt-green-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 md:max-w-md">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-kt-gray-400"
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              className="input pl-10"
              placeholder="Başvuru adı, araç, kullanıcı veya departman ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={80}
            />
          </div>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse h-28" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-kt-gray-500">
          {statusFilter === 'all' ? 'Henüz başvuru yok.' : 'Bu filtreye uyan başvuru yok.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const badge = statusBadge(r.status);
            const canReview =
              !readOnly && (r.status === 'pending' || r.status === 'feedback_requested');
            const title = r.requestTitle ?? r.licenseName;
            const isProject = r.status === 'approved';
            const expanded = expandedId === r.id;
            const itemsList = r.items.length > 0
              ? r.items
              : [{ licenseName: r.licenseName, vendor: r.vendor, licenseKey: r.licenseKey, category: r.category }];
            return (
              <div key={r.id} className="card p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-1">
                      <span className="text-lg font-bold text-kt-green-900">{title}</span>
                      <span className={badge.cls}>{badge.label}</span>
                      <SlaBadge sla={r.sla} />
                    </div>
                    <div className="text-sm text-kt-gray-600">
                      <span className="font-semibold">{r.userFullName}</span>
                      <span className="text-kt-gray-400"> · </span>
                      <span>{r.userEmail}</span>
                      {r.userDepartment && (
                        <>
                          <span className="text-kt-gray-400"> · </span>
                          <span>{r.userDepartment}</span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-kt-gray-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      <span>Lisans: {DURATION_LABEL[r.durationMonths]}</span>
                      <span>· Talep: {fmtDate(r.createdAt)}</span>
                      {r.projectType && <span>· {projectTypeLabel(r.projectType)}</span>}
                      {r.assignedEngineerName && (
                        <span>· Mühendis: {r.assignedEngineerName}</span>
                      )}
                      {r.reviewedAt && (
                        <span>
                          · Review: {fmtDate(r.reviewedAt)}{' '}
                          {r.reviewerName ? `(${r.reviewerName})` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Araç chip'leri */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {itemsList.map((it, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-2 py-0.5 rounded-full bg-kt-green-50 border border-kt-green-200 text-kt-green-800"
                    >
                      {it.licenseName}
                      {it.vendor && <span className="opacity-70"> · {it.vendor}</span>}
                    </span>
                  ))}
                </div>

                <div className="space-y-2 text-sm text-kt-gray-700 mb-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                      Kullanım Amacı
                    </div>
                    <p className="leading-relaxed whitespace-pre-line">{r.reason}</p>
                  </div>
                  {r.expectedBenefit && (
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                        Beklenen Fayda
                      </div>
                      <p className="leading-relaxed whitespace-pre-line">{r.expectedBenefit}</p>
                    </div>
                  )}
                  {r.successCriteria && (
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                        Başarı Kriteri
                      </div>
                      <p className="leading-relaxed whitespace-pre-line">{r.successCriteria}</p>
                    </div>
                  )}
                  {r.dataToUse && (
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                        Kullanılacak Veri
                      </div>
                      <p className="leading-relaxed whitespace-pre-line">{r.dataToUse}</p>
                    </div>
                  )}
                  {r.technicalStack && (
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-0.5">
                        Teknik Yığın
                      </div>
                      <p className="leading-relaxed whitespace-pre-line">{r.technicalStack}</p>
                    </div>
                  )}
                  {r.usesExternalApi != null && (
                    <div className="text-xs text-kt-gray-500">
                      Dış servis / API erişimi:{' '}
                      <strong>{r.usesExternalApi ? 'Var' : 'Yok'}</strong>
                    </div>
                  )}
                </div>

                {r.adminFeedback && (
                  <div className="mb-3 px-4 py-2 rounded-lg bg-kt-gray-50 border border-kt-gray-200 text-xs text-kt-gray-700">
                    <div className="font-bold uppercase tracking-wider text-kt-gray-500 mb-1">
                      Admin notu
                    </div>
                    <div className="whitespace-pre-line">{r.adminFeedback}</div>
                  </div>
                )}

                {/* Yönetişim paneli — onaylı projeler */}
                {expanded && isProject && (
                  <div className="mt-3 pt-3 border-t border-kt-gray-100">
                    <AdminGovernancePanel
                      requestId={r.id}
                      admins={admins}
                      currentAdminId={admin?.id}
                      onChanged={load}
                      readOnly={readOnly}
                    />
                  </div>
                )}

                {/* Aksiyonlar */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-kt-gray-100">
                  {canReview && (
                    <>
                      <button onClick={() => openModal(r, 'approve')} className="btn-success text-sm">
                        Onayla
                      </button>
                      <button
                        onClick={() => openModal(r, 'request_feedback')}
                        className="btn-secondary text-sm"
                      >
                        Revize İste
                      </button>
                      <button onClick={() => openModal(r, 'reject')} className="btn-danger text-sm">
                        Reddet
                      </button>
                    </>
                  )}
                  {isProject && (
                    <button
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                      className="btn-ghost text-sm ml-auto"
                    >
                      {expanded ? 'Yönetişim panelini gizle' : 'Yönetişim paneli'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Review modal */}
      {modalReq && modalAction && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-kt-green-900 mb-1">
              {modalAction === 'request_feedback'
                ? 'Revize iste'
                : `${modalReq.requestTitle ?? modalReq.licenseName} ${ACTION_META[modalAction].title}`}
            </h3>
            <p className="text-sm text-kt-gray-500 mb-4">
              Talep eden: <span className="font-semibold">{modalReq.userFullName}</span> ·{' '}
              {modalReq.userEmail}
            </p>

            <div className="mb-4">
              <label htmlFor="modal-feedback" className="label">
                {modalAction === 'approve' ? 'Not (opsiyonel)' : 'Açıklama (önerilir)'}
              </label>
              <textarea
                id="modal-feedback"
                className="textarea"
                placeholder={
                  modalAction === 'reject'
                    ? 'Neden reddediyorsun? (kullanıcıya gösterilecek)'
                    : modalAction === 'request_feedback'
                      ? 'Kullanıcıdan ne istiyorsun? (örn. daha detaylı gerekçe)'
                      : 'İlgili ekibe veya kullanıcıya iletilecek not.'
                }
                value={modalFeedback}
                onChange={(e) => setModalFeedback(e.target.value)}
                maxLength={1000}
                rows={4}
                disabled={submitting}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={closeModal} disabled={submitting} className="btn-ghost">
                İptal
              </button>
              <button
                onClick={submitReview}
                disabled={submitting}
                className={ACTION_META[modalAction].cls}
              >
                {submitting ? 'İşleniyor…' : ACTION_META[modalAction].button}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
