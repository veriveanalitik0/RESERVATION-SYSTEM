/**
 * Saf SVG ile basit grafikler — recharts/chart.js bağımlılığı YOK.
 *
 * Sebep: bundle size küçük tutmak, prod'da CSP'de inline script gerektirmemek.
 */
import { useMemo } from 'react';
import type {
  DailyBookingPoint,
  RoomUsage,
  StatusBreakdown,
  TechnologyCount,
} from '../types';

/* ============================================================
 * LineChart — günlük bookings (created/approved/rejected)
 * ============================================================ */
export function DailyBookingsChart({ data }: { data: DailyBookingPoint[] }) {
  const W = 720;
  const H = 220;
  const PAD = 32;

  const maxY = Math.max(
    5,
    ...data.flatMap((d) => [d.created, d.approved, d.rejected])
  );
  const stepX = (W - PAD * 2) / Math.max(1, data.length - 1);

  const toXY = (i: number, y: number) => ({
    x: PAD + i * stepX,
    y: H - PAD - (y / maxY) * (H - PAD * 2),
  });

  const buildPath = (key: 'created' | 'approved' | 'rejected') => {
    if (data.length === 0) return '';
    return data
      .map((p, i) => {
        const { x, y } = toXY(i, p[key]);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const yTicks = [0, Math.ceil(maxY / 2), maxY];
  const lastDate = data[data.length - 1]?.date;
  const firstDate = data[0]?.date;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-kt-green-900">Son 30 gün — günlük talepler</h4>
        <div className="flex gap-3 text-[11px] font-semibold">
          <span className="flex items-center gap-1.5 text-kt-gray-600">
            <span className="w-2 h-2 rounded-full bg-kt-green-700" /> Oluşturulan
          </span>
          <span className="flex items-center gap-1.5 text-kt-gray-600">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Onaylanan
          </span>
          <span className="flex items-center gap-1.5 text-kt-gray-600">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Reddedilen
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Günlük booking grafiği"
        className="w-full h-auto"
      >
        {yTicks.map((t) => {
          const y = H - PAD - (t / maxY) * (H - PAD * 2);
          return (
            <g key={t}>
              <line
                x1={PAD}
                x2={W - PAD}
                y1={y}
                y2={y}
                stroke="#E5E7EB"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={PAD - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#9CA3AF"
              >
                {t}
              </text>
            </g>
          );
        })}
        {firstDate && (
          <text x={PAD} y={H - 8} fontSize="10" fill="#9CA3AF">
            {firstDate}
          </text>
        )}
        {lastDate && (
          <text x={W - PAD} y={H - 8} fontSize="10" fill="#9CA3AF" textAnchor="end">
            {lastDate}
          </text>
        )}
        <path
          d={buildPath('created')}
          fill="none"
          stroke="#0D5C3F"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d={buildPath('approved')}
          fill="none"
          stroke="#6FB02C"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d={buildPath('rejected')}
          fill="none"
          stroke="#F43F5E"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/* ============================================================
 * BarChart — oda kullanım (utilization days)
 * ============================================================ */
export function RoomUsageChart({ data }: { data: RoomUsage[] }) {
  const filtered = data.slice(0, 12);
  const maxV = Math.max(1, ...filtered.map((r) => r.utilizationDays));
  return (
    <div>
      <h4 className="text-sm font-bold text-kt-green-900 mb-3">
        Oda kullanım (onaylı toplam gün)
      </h4>
      <div className="space-y-1.5">
        {filtered.length === 0 ? (
          <p className="text-sm text-kt-gray-500 italic">Henüz veri yok.</p>
        ) : (
          filtered.map((r) => {
            const pct = Math.round((r.utilizationDays / maxV) * 100);
            return (
              <div key={r.roomId} className="flex items-center gap-3">
                <span className="w-24 text-[11px] font-bold text-kt-green-800 truncate">
                  {r.roomCode}
                </span>
                <div className="flex-1 h-6 bg-kt-gray-100 rounded-md overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-kt-green-600 to-kt-gold-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 text-xs font-semibold text-kt-gray-700 text-right tabular-nums">
                  {r.utilizationDays}g
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * Top technologies — etiket bulutu
 * ============================================================ */
export function TopTechnologies({ data }: { data: TechnologyCount[] }) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count).slice(0, 16), [data]);
  return (
    <div>
      <h4 className="text-sm font-bold text-kt-green-900 mb-3">Popüler teknolojiler</h4>
      {sorted.length === 0 ? (
        <p className="text-sm text-kt-gray-500 italic">Henüz teknoloji etiketi yok.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((t) => (
            <span
              key={t.technology}
              className="px-2.5 py-1 rounded-md bg-kt-green-50 text-kt-green-800 text-xs font-semibold border border-kt-green-100"
            >
              {t.technology}
              <span className="ml-1.5 text-kt-gold-700 font-bold">{t.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * Status donut (saf SVG)
 * ============================================================ */
export function StatusDonut({ data }: { data: StatusBreakdown[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0) || 1;
  const order: Array<{ key: string; color: string; label: string }> = [
    { key: 'approved', color: '#6FB02C', label: 'Onaylı' },
    { key: 'pending', color: '#F59E0B', label: 'Bekleyen' },
    { key: 'feedback_requested', color: '#3B82F6', label: 'Düzeltme' },
    { key: 'rejected', color: '#F43F5E', label: 'Reddedilen' },
  ];
  const segments = order.map((cat) => {
    const found = data.find((d) => d.status === cat.key);
    return { ...cat, count: found?.count ?? 0 };
  });

  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 200 200" className="w-44 h-44">
        <circle cx="100" cy="100" r={R} fill="none" stroke="#F3F4F6" strokeWidth="22" />
        {segments.map((s) => {
          const frac = s.count / total;
          const length = C * frac;
          const el = (
            <circle
              key={s.key}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="22"
              strokeDasharray={`${length} ${C - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
              strokeLinecap="butt"
            />
          );
          offset += length;
          return el;
        })}
        <text
          x="100"
          y="100"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="28"
          fontWeight="800"
          fill="#0D5C3F"
        >
          {total}
        </text>
        <text
          x="100"
          y="124"
          textAnchor="middle"
          fontSize="10"
          fontWeight="600"
          fill="#9CA3AF"
          letterSpacing="2"
        >
          TOPLAM
        </text>
      </svg>
      <div className="space-y-1.5 flex-1">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-2.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="flex-1 font-semibold text-kt-gray-700">{s.label}</span>
            <span className="font-bold text-kt-green-900 tabular-nums">{s.count}</span>
            <span className="text-kt-gray-500 w-9 text-right text-[11px]">
              {((s.count / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
