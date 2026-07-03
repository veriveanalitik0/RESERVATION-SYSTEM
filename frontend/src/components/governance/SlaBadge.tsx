/**
 * SLA rozeti — başvuru/proje için aktif kontrol noktası geri sayımı.
 */
import type { SlaInfo } from '../../types';

function remainingText(sla: SlaInfo): string {
  const h = sla.remainingHours;
  if (h < 0) {
    const over = Math.abs(h);
    return over >= 24
      ? `${Math.floor(over / 24)} gün gecikme`
      : `${Math.ceil(over)} sa gecikme`;
  }
  return h >= 24 ? `${Math.floor(h / 24)} gün kaldı` : `${Math.ceil(h)} sa kaldı`;
}

export function SlaBadge({ sla }: { sla: SlaInfo | null }) {
  if (!sla) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${
        sla.overdue
          ? 'bg-red-100 text-red-800 border-red-300'
          : sla.remainingHours < sla.slaHours * 0.25
            ? 'bg-kt-gold-100 text-kt-gold-800 border-kt-gold-300'
            : 'bg-kt-green-50 text-kt-green-700 border-kt-green-200'
      }`}
      title={`${sla.checkpoint} · SLA ${sla.slaHours} saat`}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      SLA · {remainingText(sla)}
    </span>
  );
}
