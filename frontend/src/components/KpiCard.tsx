/**
 * KpiCard — KPI gösterim kartı + opsiyonel sparkline.
 *
 * Sade ve profesyonel — ethereal-beams-hero referansındaki gibi monokrom hissiyat.
 * Holografik border / neon glow / shimmer kaldırıldı; yerine düz beyaz kart +
 * ince gri border + hover'da hafif shadow. Renk sadece sol kenardaki ince accent
 * şeridi ve ikon kutusunun yumuşak tinted background'ı ile semantik bir ipucu
 * olarak kullanılıyor.
 *
 * Kullanım:
 *   <KpiCard
 *     icon={Inbox}
 *     label="Bekleyen Talepler"
 *     value={12}
 *     tone="cyan"
 *     trend={{ change: -3, direction: 'down', label: 'son 7 gün' }}
 *     sparkline={[5, 8, 6, 10, 12, 9, 12]}
 *   />
 */
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

type Tone = 'cyan' | 'violet' | 'gold' | 'rose' | 'emerald';

interface Trend {
  change: number;
  direction: 'up' | 'down' | 'neutral';
  label?: string;
  goodDirection?: 'up' | 'down';
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  unit?: string;
  tone?: Tone;
  trend?: Trend;
  sparkline?: number[];
  compact?: boolean;
  className?: string;
}

/** Tone başına: ikon kutusu tinted bg + sol kenar accent şeridi rengi. */
const TONE_CONFIG: Record<
  Tone,
  { iconBg: string; iconColor: string; accentBar: string; accentDot: string }
> = {
  cyan: {
    iconBg: 'bg-cyan-50',
    iconColor: 'text-cyan-700',
    accentBar: 'bg-cyan-500',
    accentDot: 'bg-cyan-500',
  },
  violet: {
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-700',
    accentBar: 'bg-violet-500',
    accentDot: 'bg-violet-500',
  },
  gold: {
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-700',
    accentBar: 'bg-amber-500',
    accentDot: 'bg-amber-500',
  },
  rose: {
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-700',
    accentBar: 'bg-rose-500',
    accentDot: 'bg-rose-500',
  },
  emerald: {
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-700',
    accentBar: 'bg-emerald-500',
    accentDot: 'bg-emerald-500',
  },
};

const TONE_SPARK: Record<Tone, { stroke: string; fill: string }> = {
  cyan:    { stroke: '#6FB02C', fill: 'rgba(111, 176, 44, 0.12)' },
  violet:  { stroke: '#F97316', fill: 'rgba(249, 115, 22, 0.12)' },
  gold:    { stroke: '#F59E0B', fill: 'rgba(245, 158, 11, 0.12)' },
  rose:    { stroke: '#F43F5E', fill: 'rgba(244, 63, 94, 0.12)' },
  emerald: { stroke: '#6FB02C', fill: 'rgba(111, 176, 44, 0.12)' },
};

export function KpiCard({
  icon: Icon,
  label,
  value,
  unit,
  tone = 'cyan',
  trend,
  sparkline,
  compact = false,
  className = '',
}: KpiCardProps) {
  const cfg = TONE_CONFIG[tone];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-white border border-kt-gray-100 transition-shadow duration-200 hover:shadow-sm ${className}`}
    >
      {/* Sol kenar ince accent şeridi — tek renk semantik ipucu */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full ${cfg.accentBar}`}
      />

      <div className="relative p-5">
        {/* Header — ikon + label + (opsiyonel) trend badge */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cfg.iconBg} ${cfg.iconColor}`}
            >
              <Icon size={18} strokeWidth={2.25} />
            </div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-kt-gray-500 truncate">
              {label}
            </h3>
          </div>
          {trend && <TrendBadge trend={trend} />}
        </div>

        {/* Big value */}
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="text-[2.25rem] leading-none font-extrabold tabular-nums tracking-tight text-kt-green-900">
            {value}
          </span>
          {unit && (
            <span className="text-sm font-semibold text-kt-gray-400">{unit}</span>
          )}
        </div>

        {trend?.label && (
          <p className="text-xs text-kt-gray-500">{trend.label}</p>
        )}

        {/* Sparkline (compact mod'da gizli) */}
        {!compact && sparkline && sparkline.length >= 2 && (
          <div className="mt-3 -mx-1">
            <Sparkline values={sparkline} stroke={TONE_SPARK[tone].stroke} fill={TONE_SPARK[tone].fill} />
          </div>
        )}
      </div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: Trend }) {
  const good = trend.goodDirection ?? 'up';
  const isPositive =
    (trend.direction === 'up' && good === 'up') ||
    (trend.direction === 'down' && good === 'down');
  const isNeutral = trend.direction === 'neutral';
  const colorCls = isNeutral
    ? 'bg-kt-gray-100 text-kt-gray-600 border-kt-gray-200'
    : isPositive
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-rose-50 text-rose-700 border-rose-200';
  const Icon =
    trend.direction === 'up' ? TrendingUp : trend.direction === 'down' ? TrendingDown : Minus;
  const sign = trend.direction === 'down' ? '−' : trend.direction === 'up' ? '+' : '';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${colorCls}`}
    >
      <Icon size={11} />
      {sign}{Math.abs(trend.change)}%
    </span>
  );
}

/** Pure SVG area sparkline. AnalyticsCharts.tsx pattern'i. */
function Sparkline({
  values,
  stroke,
  fill,
}: {
  values: number[];
  stroke: string;
  fill: string;
}) {
  const W = 240;
  const H = 48;
  const PAD = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (W - PAD * 2) / Math.max(1, values.length - 1);

  const pts = values.map((v, i) => ({
    x: PAD + i * stepX,
    y: H - PAD - ((v - min) / range) * (H - PAD * 2),
  }));

  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H - PAD} L ${pts[0].x.toFixed(1)} ${H - PAD} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none" aria-hidden="true">
      <path d={areaPath} fill={fill} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="2.5" fill={stroke} />
    </svg>
  );
}
