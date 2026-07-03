/**
 * Kalite kapıları paneli — 6 yönetişim ajanının kapı sonuçları.
 * Admin modunda her kapının durumu güncellenebilir (Code Review / CI yerine).
 */
import type { GateKey, GateStatus, QualityGate } from '../../types';

interface Props {
  gates: QualityGate[];
  /** Verilirse admin modu — kapı sonucu güncellenebilir. */
  onSetResult?: (gateKey: GateKey, status: GateStatus) => void;
  busy?: boolean;
}

function statusBadge(status: GateStatus) {
  switch (status) {
    case 'passed':
      return { label: 'Geçti', cls: 'bg-kt-green-100 text-kt-green-800 border-kt-green-300' };
    case 'failed':
      return { label: 'Kaldı', cls: 'bg-red-100 text-red-800 border-red-300' };
    case 'pending':
      return { label: 'Bekliyor', cls: 'bg-kt-gray-100 text-kt-gray-600 border-kt-gray-300' };
  }
}

export function QualityGatesPanel({ gates, onSetResult, busy }: Props) {
  if (gates.length === 0) {
    return (
      <div className="text-sm text-kt-gray-400 italic">
        Kalite kapıları proje geliştirme aşamasına geçince oluşturulur.
      </div>
    );
  }

  const passed = gates.filter((g) => g.status === 'passed').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500">
          Kalite Kapıları
        </div>
        <div className="text-xs text-kt-gray-500">
          {passed}/{gates.length} yeşil
        </div>
      </div>
      <ul className="space-y-1.5">
        {gates.map((g) => {
          const badge = statusBadge(g.status);
          return (
            <li
              key={g.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-kt-gray-200"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-kt-green-900">{g.label}</div>
                <div className="text-[11px] text-kt-gray-500">
                  {g.agent}
                  {g.threshold != null && (
                    <span>
                      {' '}· eşik {g.threshold}
                      {g.thresholdUnit ?? ''}
                    </span>
                  )}
                  {g.score != null && (
                    <span className="ml-1 font-semibold text-kt-gray-700">
                      → {g.score}
                      {g.thresholdUnit ?? ''}
                    </span>
                  )}
                </div>
                {g.detail && (
                  <div className="text-[11px] text-kt-gray-500 mt-0.5">{g.detail}</div>
                )}
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${badge.cls}`}
              >
                {badge.label}
              </span>
              {onSetResult && (
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={busy || g.status === 'passed'}
                    onClick={() => onSetResult(g.gateKey, 'passed')}
                    className="text-[10px] font-bold px-1.5 py-1 rounded bg-kt-green-50 text-kt-green-700 hover:bg-kt-green-100 disabled:opacity-40 transition-colors"
                    title="Geçti olarak işaretle"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    disabled={busy || g.status === 'failed'}
                    onClick={() => onSetResult(g.gateKey, 'failed')}
                    className="text-[10px] font-bold px-1.5 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40 transition-colors"
                    title="Kaldı olarak işaretle"
                  >
                    ✕
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
