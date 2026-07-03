/**
 * Proje yaşam döngüsü çubuğu — 4 aşamalı pipeline görseli.
 * application → development → stage → production → live
 */
import type { LifecycleStage } from '../../types';
import { STAGE_META, STAGE_ORDER, stageIndex } from '../../constants/governance';

interface Props {
  stage: LifecycleStage;
  /** 'application' aşamasını da göster (varsayılan: göster). */
  compact?: boolean;
}

export function ProjectLifecycleBar({ stage, compact = false }: Props) {
  const currentIdx = stageIndex(stage);

  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {STAGE_ORDER.map((s, idx) => {
        const meta = STAGE_META[s];
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={s} className="flex items-center flex-1 min-w-0">
            <div
              className={`flex-1 min-w-0 rounded-lg border px-2 py-1.5 text-center transition-colors ${
                active
                  ? 'bg-kt-green-900 border-kt-green-900 text-white'
                  : done
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-kt-gray-50 border-kt-gray-200 text-kt-gray-400'
              }`}
              title={meta.description}
            >
              <div className={`${compact ? 'text-sm' : 'text-base'} leading-none`}>
                {done ? '✓' : meta.icon}
              </div>
              {!compact && (
                <div className="text-[10px] font-bold uppercase tracking-wide mt-1 truncate">
                  {meta.label}
                </div>
              )}
            </div>
            {idx < STAGE_ORDER.length - 1 && (
              <div
                className={`w-2 h-0.5 shrink-0 ${
                  idx < currentIdx ? 'bg-emerald-300' : 'bg-kt-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
