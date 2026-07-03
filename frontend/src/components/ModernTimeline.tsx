/**
 * ModernTimeline — proje yaşam döngüsü geçişleri (audit trail) için zarif vertical timeline.
 *
 * Tasarım: 21st.dev "Modern Timeline" referansı + Kuveyt Türk cyan/navy paleti.
 * Mevcut ProjectTimeline.tsx'in (governance/) modernize hâli — daha zengin görsel
 * hierarchy, status renkleri (advance=cyan, regress=amber, terminal=emerald),
 * hover effect ve daha okunaklı tarih formatı.
 *
 * Kullanım:
 *   <ModernTimeline events={stageEvents} />
 *
 * `events` boşsa "Henüz olay yok" empty state gösterir.
 */
import type { StageEvent, LifecycleStage } from '../types';
import {
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Clock,
} from 'lucide-react';

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

function fmtFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 0) return '';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} gün önce`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} hf önce`;
  const months = Math.floor(days / 30);
  return `${months} ay önce`;
}

function transitionKind(e: StageEvent): 'advance' | 'regress' | 'initial' | 'terminal' {
  if (!e.fromStage || e.fromStage === e.toStage) return 'initial';
  if (e.toStage === 'live') return 'terminal';
  const fromIdx = STAGE_ORDER.indexOf(e.fromStage as LifecycleStage);
  const toIdx = STAGE_ORDER.indexOf(e.toStage as LifecycleStage);
  return toIdx > fromIdx ? 'advance' : 'regress';
}

const KIND_META: Record<
  'advance' | 'regress' | 'initial' | 'terminal',
  { dotBg: string; iconBg: string; iconColor: string; lineCls: string; icon: typeof CheckCircle2 }
> = {
  initial: {
    dotBg: 'bg-kt-gold-400',
    iconBg: 'bg-kt-gold-100',
    iconColor: 'text-kt-gold-700',
    lineCls: 'bg-kt-gold-200',
    icon: Sparkles,
  },
  advance: {
    dotBg: 'bg-cyan-500',
    iconBg: 'bg-cyan-50',
    iconColor: 'text-cyan-700',
    lineCls: 'bg-cyan-200',
    icon: ArrowRight,
  },
  regress: {
    dotBg: 'bg-amber-500',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-700',
    lineCls: 'bg-amber-200',
    icon: ArrowLeft,
  },
  terminal: {
    dotBg: 'bg-emerald-500',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-700',
    lineCls: 'bg-emerald-200',
    icon: CheckCircle2,
  },
};

export interface ModernTimelineProps {
  events: StageEvent[];
  /** Compact mod — daha az dikey alan kullanır. */
  compact?: boolean;
  className?: string;
}

export function ModernTimeline({ events, compact = false, className = '' }: ModernTimelineProps) {
  if (events.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center text-center py-8 ${className}`}>
        <div className="w-12 h-12 rounded-full bg-kt-gray-100 flex items-center justify-center mb-3">
          <Clock className="w-5 h-5 text-kt-gray-400" />
        </div>
        <p className="text-sm font-semibold text-kt-gray-600">Henüz yaşam döngüsü olayı yok</p>
        <p className="text-xs text-kt-gray-400 mt-1 max-w-xs">
          Proje aşama değiştirdikçe kim ne zaman karar verdi burada listelenecek.
        </p>
      </div>
    );
  }

  const stageLabel = (s: string) => STAGE_LABEL[s as LifecycleStage] ?? s;

  return (
    <ol className={`relative ${className}`}>
      {/* Vertical line — sol kenarda */}
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-kt-gray-200" aria-hidden />

      {events.map((e, idx) => {
        const kind = transitionKind(e);
        const meta = KIND_META[kind];
        const Icon = meta.icon;
        const isLast = idx === events.length - 1;
        return (
          <li key={e.id} className={`relative pl-12 ${compact ? 'pb-4' : 'pb-6'} ${isLast ? 'pb-0' : ''}`}>
            {/* Icon tile — circle aligned with vertical line */}
            <div
              className={`absolute left-0 top-0 w-8 h-8 rounded-full flex items-center justify-center ring-4 ring-white shadow-sm ${meta.iconBg}`}
            >
              <Icon size={14} className={meta.iconColor} />
            </div>

            {/* Card content */}
            <div className="group rounded-xl border border-kt-gray-100 bg-white px-4 py-3 hover:border-kt-gold-200 hover:shadow-kt-soft transition">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-kt-green-900">
                  {e.fromStage && e.fromStage !== e.toStage ? (
                    <>
                      <span className="text-kt-gray-500">{stageLabel(e.fromStage)}</span>
                      <ArrowRight size={12} className="text-kt-gray-400" />
                      <span>{stageLabel(e.toStage)}</span>
                    </>
                  ) : (
                    <span>{stageLabel(e.toStage)}</span>
                  )}
                </div>
                <time
                  className="text-[11px] text-kt-gray-500 font-medium"
                  title={fmtFull(e.createdAt)}
                  dateTime={e.createdAt}
                >
                  {fmtRelative(e.createdAt)}
                </time>
              </div>
              {e.note && (
                <p className="text-xs text-kt-gray-600 leading-relaxed mb-1">{e.note}</p>
              )}
              <div className="text-[10px] text-kt-gray-400 flex items-center gap-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${meta.dotBg}`} />
                <span>{e.actorName ?? 'Sistem'}</span>
                <span>·</span>
                <span>{e.actorType === 'admin' ? 'Admin' : e.actorType === 'user' ? 'Kullanıcı' : 'Sistem'}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
