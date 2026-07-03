/**
 * Admin yönetişim paneli — bir projenin yaşam döngüsü kontrolü.
 *
 * Lab Mühendisi / YZ-Ar-Ge aksiyonları:
 *  - Sonraki aşamaya ilerletme (kapı kontrolüyle)
 *  - Lab Mühendisi atama
 *  - Proje türü yükseltme (PoC → Kuruma Entegre)
 *  - Kalite kapısı sonuçlarını güncelleme
 *  - Stage / Production insan onayı kararı
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useToast } from '../Toast';
import type {
  ApprovalType,
  GateKey,
  GateStatus,
  GovernanceAdmin,
  GovernanceBundle,
  LicenseRequestWithUser,
} from '../../types';
import { STAGE_META } from '../../constants/governance';
import { ProjectLifecycleBar } from './ProjectLifecycleBar';
import { QualityGatesPanel } from './QualityGatesPanel';
import { ApprovalsPanel } from './ApprovalsPanel';
import { ProjectTimeline } from './ProjectTimeline';

interface Props {
  requestId: string;
  admins: GovernanceAdmin[];
  currentAdminId: string | undefined;
  /** Liste rozetlerinin tazelenmesi için. */
  onChanged: () => void;
  /** Read-only görüntüleyen (danışman / Ar-Ge) için tüm yönetişim aksiyonlarını gizler. */
  readOnly?: boolean;
}

export function AdminGovernancePanel({
  requestId,
  admins,
  currentAdminId,
  onChanged,
  readOnly = false,
}: Props) {
  const toast = useToast();
  const [bundle, setBundle] = useState<GovernanceBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [engineerPick, setEngineerPick] = useState('');

  const refresh = useCallback(async () => {
    try {
      const b = await api.adminLicenseRequestDetail(requestId);
      setBundle(b);
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requestId, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentAdmin = admins.find((a) => a.id === currentAdminId);
  const canDecideApprovals =
    currentAdmin?.role === 'super_admin' || currentAdmin?.governanceRole === 'yz_arge';

  async function run(fn: () => Promise<unknown>, successMsg: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.push('success', successMsg);
      await refresh();
      onChanged();
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleAdvance() {
    void run(() => api.adminAdvanceLifecycle(requestId), 'Proje bir sonraki aşamaya ilerletildi.');
  }
  function handleAssign() {
    if (!engineerPick) return;
    void run(
      () => api.adminAssignEngineer(requestId, engineerPick),
      'Lab Mühendisi atandı.'
    );
  }
  function handleUpgrade() {
    void run(
      () => api.adminUpgradeProjectType(requestId),
      'Proje "Kuruma Entegre" olarak yükseltildi.'
    );
  }
  function handleGate(gateKey: GateKey, status: GateStatus) {
    void run(
      () => api.adminSetGateResult(requestId, { gateKey, status }),
      'Kalite kapısı güncellendi.'
    );
  }
  function handleApproval(
    approvalType: ApprovalType,
    input: { decision: 'approved' | 'rejected'; releaseNote: string; riskAssessment: string }
  ) {
    void run(
      () =>
        api.adminDecideApproval(requestId, {
          approvalType,
          decision: input.decision,
          releaseNote: input.releaseNote || null,
          riskAssessment: input.riskAssessment || null,
        }),
      'Onay kararı kaydedildi.'
    );
  }

  if (loading || !bundle) {
    return <div className="text-sm text-kt-gray-400 py-4">Yönetişim verisi yükleniyor…</div>;
  }

  const req = bundle.request as LicenseRequestWithUser;
  const stage = req.lifecycleStage;
  const canAdvance = stage !== 'application' && stage !== 'live';
  const nextLabel =
    stage === 'development'
      ? STAGE_META.stage.label
      : stage === 'stage'
        ? STAGE_META.production.label
        : stage === 'production'
          ? STAGE_META.live.label
          : '';

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Yaşam döngüsü çubuğu */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-2">
          Yaşam Döngüsü
        </div>
        <ProjectLifecycleBar stage={stage} />
      </div>

      {/* Aşama aksiyonları */}
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && canAdvance && (
          <button
            type="button"
            disabled={busy}
            onClick={handleAdvance}
            className="btn-primary text-sm"
          >
            {nextLabel} aşamasına ilerlet →
          </button>
        )}
        {!readOnly && req.projectType === 'poc' && (
          <button
            type="button"
            disabled={busy}
            onClick={handleUpgrade}
            className="btn-secondary text-sm"
          >
            Kuruma Entegre’ye yükselt
          </button>
        )}
        <span className="text-[11px] text-kt-gray-500">
          Yönetişim seviyesi:{' '}
          <strong>{req.governanceLevel === 'full' ? 'Tam' : 'Temel'}</strong>
        </span>
      </div>

      {/* Lab Mühendisi atama */}
      <div className="rounded-lg bg-kt-gray-50 border border-kt-gray-200 p-3">
        <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-1.5">
          Lab Mühendisi
        </div>
        {req.assignedEngineerName ? (
          <div className="text-sm text-kt-green-900 mb-2">
            Atanmış: <strong>{req.assignedEngineerName}</strong>
          </div>
        ) : (
          <div className="text-sm text-kt-gray-500 mb-2">Henüz atanmadı.</div>
        )}
        {!readOnly && (
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              className="input flex-1 text-sm"
              value={engineerPick}
              onChange={(e) => setEngineerPick(e.target.value)}
              disabled={busy}
              aria-label="Lab Mühendisi seç"
            >
              <option value="">— Mühendis seç —</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                  {a.governanceRole === 'lab_muhendisi' ? ' (Lab Mühendisi)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !engineerPick}
              onClick={handleAssign}
              className="btn-secondary text-sm whitespace-nowrap"
            >
              Ata
            </button>
          </div>
        )}
      </div>

      {/* Kalite kapıları — düzenlenebilir (read-only modunda sadece görüntülenir) */}
      <QualityGatesPanel
        gates={bundle.gates}
        onSetResult={readOnly ? undefined : handleGate}
        busy={busy}
      />

      {/* İnsan onayları */}
      {bundle.approvals.length > 0 && (
        <ApprovalsPanel
          approvals={bundle.approvals}
          onDecide={readOnly || !canDecideApprovals ? undefined : handleApproval}
          busy={busy}
        />
      )}
      {!canDecideApprovals && bundle.approvals.some((a) => a.decision === 'pending') && (
        <p className="text-[11px] text-kt-gray-500 italic">
          İnsan onayı kararı yalnızca YZ / Ar-Ge Mühendisi rolüyle verilebilir.
        </p>
      )}

      {/* Zaman çizelgesi */}
      <ProjectTimeline events={bundle.stageEvents} />
    </div>
  );
}
