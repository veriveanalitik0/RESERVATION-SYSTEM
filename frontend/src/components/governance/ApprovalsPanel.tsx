/**
 * İnsan onay noktaları paneli — Stage + Production (kılavuz §7).
 * Admin (YZ/Ar-Ge) modunda bekleyen onaylar karara bağlanabilir.
 */
import { useState } from 'react';
import type { ApprovalType, HumanApproval } from '../../types';

interface DecideInput {
  decision: 'approved' | 'rejected';
  releaseNote: string;
  riskAssessment: string;
}

interface Props {
  approvals: HumanApproval[];
  /** Verilirse admin modu — bekleyen onaylar karara bağlanabilir. */
  onDecide?: (type: ApprovalType, input: DecideInput) => void;
  busy?: boolean;
}

const TYPE_LABEL: Record<ApprovalType, string> = {
  stage: 'Stage Onayı',
  production: 'Production Onayı',
};

function decisionBadge(decision: HumanApproval['decision']) {
  switch (decision) {
    case 'approved':
      return { label: 'Onaylandı', cls: 'bg-kt-green-100 text-kt-green-800 border-kt-green-300' };
    case 'rejected':
      return { label: 'Reddedildi', cls: 'bg-red-100 text-red-800 border-red-300' };
    case 'pending':
      return { label: 'Bekliyor', cls: 'bg-blue-100 text-blue-800 border-blue-300' };
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function ApprovalsPanel({ approvals, onDecide, busy }: Props) {
  const [openType, setOpenType] = useState<ApprovalType | null>(null);
  const [releaseNote, setReleaseNote] = useState('');
  const [riskAssessment, setRiskAssessment] = useState('');

  if (approvals.length === 0) {
    return (
      <div className="text-sm text-kt-gray-400 italic">
        İnsan onayı Stage aşamasında istenir.
      </div>
    );
  }

  function submit(type: ApprovalType, decision: 'approved' | 'rejected') {
    onDecide?.(type, { decision, releaseNote, riskAssessment });
    setOpenType(null);
    setReleaseNote('');
    setRiskAssessment('');
  }

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-2">
        İnsan Onay Noktaları
      </div>
      <ul className="space-y-2">
        {approvals.map((a) => {
          const badge = decisionBadge(a.decision);
          const canDecide = !!onDecide && a.decision === 'pending';
          return (
            <li
              key={a.id}
              className="px-3 py-2 rounded-lg bg-white border border-kt-gray-200"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-kt-green-900">
                  {TYPE_LABEL[a.approvalType]}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${badge.cls}`}
                >
                  {badge.label}
                </span>
                {a.approverName && (
                  <span className="text-[11px] text-kt-gray-500 ml-auto">
                    {a.approverName}
                    {a.decidedAt && ` · ${fmt(a.decidedAt)}`}
                  </span>
                )}
              </div>
              {a.releaseNote && (
                <div className="text-xs text-kt-gray-600 mt-1">
                  <span className="font-semibold">Release notu:</span> {a.releaseNote}
                </div>
              )}
              {a.riskAssessment && (
                <div className="text-xs text-kt-gray-600 mt-0.5">
                  <span className="font-semibold">Risk:</span> {a.riskAssessment}
                </div>
              )}

              {canDecide && openType !== a.approvalType && (
                <button
                  type="button"
                  onClick={() => setOpenType(a.approvalType)}
                  className="mt-2 text-xs font-semibold text-kt-green-700 hover:text-kt-gold-700"
                >
                  Karar ver →
                </button>
              )}

              {canDecide && openType === a.approvalType && (
                <div className="mt-2 space-y-2 border-t border-kt-gray-100 pt-2">
                  <textarea
                    className="textarea text-sm"
                    rows={2}
                    placeholder="Release notu (opsiyonel)"
                    value={releaseNote}
                    onChange={(e) => setReleaseNote(e.target.value)}
                    maxLength={1000}
                    disabled={busy}
                  />
                  <textarea
                    className="textarea text-sm"
                    rows={2}
                    placeholder="Risk değerlendirmesi (opsiyonel)"
                    value={riskAssessment}
                    onChange={(e) => setRiskAssessment(e.target.value)}
                    maxLength={1000}
                    disabled={busy}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit(a.approvalType, 'approved')}
                      className="btn-success text-xs"
                    >
                      Onayla
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit(a.approvalType, 'rejected')}
                      className="btn-danger text-xs"
                    >
                      Reddet
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setOpenType(null)}
                      className="btn-ghost text-xs"
                    >
                      İptal
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
