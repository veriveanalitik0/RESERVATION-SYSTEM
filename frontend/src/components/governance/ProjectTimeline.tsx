/**
 * Proje yaşam döngüsü zaman çizelgesi — aşama geçiş geçmişi (audit).
 */
import type { StageEvent } from '../../types';
import { STAGE_META } from '../../constants/governance';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stageLabel(stage: string): string {
  return STAGE_META[stage as keyof typeof STAGE_META]?.label ?? stage;
}

export function ProjectTimeline({ events }: { events: StageEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-sm text-kt-gray-400 italic">
        Henüz yaşam döngüsü olayı yok.
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-2">
        Zaman Çizelgesi
      </div>
      <ol className="relative border-l-2 border-kt-gray-200 ml-2 space-y-3">
        {events.map((e) => (
          <li key={e.id} className="ml-4">
            <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-kt-green-500 ring-2 ring-white" />
            <div className="text-sm font-semibold text-kt-green-900">
              {e.fromStage && e.fromStage !== e.toStage
                ? `${stageLabel(e.fromStage)} → ${stageLabel(e.toStage)}`
                : stageLabel(e.toStage)}
            </div>
            {e.note && (
              <div className="text-xs text-kt-gray-600 leading-relaxed">{e.note}</div>
            )}
            <div className="text-[10px] text-kt-gray-400 mt-0.5">
              {fmt(e.createdAt)}
              {e.actorName && <span> · {e.actorName}</span>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
