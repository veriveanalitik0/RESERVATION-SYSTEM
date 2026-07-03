/**
 * Yönetişim dashboard görünümü — proje yaşam döngüsü metrikleri.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useToast } from '../Toast';
import type { GovernanceDashboard } from '../../types';
import { STAGE_META } from '../../constants/governance';
import { MdStandardsCard } from './MdStandardsCard';
import { RaciCard } from './RaciCard';

function StatCard({
  value,
  label,
  hint,
  tone,
}: {
  value: number | string;
  label: string;
  hint?: string;
  tone: 'green' | 'gold' | 'violet' | 'red';
}) {
  const toneCls = {
    green: 'text-kt-green-800',
    gold: 'text-kt-gold-700',
    violet: 'text-kt-violet-600',
    red: 'text-red-600',
  }[tone];
  return (
    <div className="card p-5">
      <div className={`text-3xl font-extrabold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-kt-gray-500 font-semibold mt-1">
        {label}
      </div>
      {hint && <div className="text-xs text-kt-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

export function GovernanceDashboardView() {
  const toast = useToast();
  const [data, setData] = useState<GovernanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.adminGovernanceDashboard());
    } catch (err) {
      toast.push('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-6 animate-pulse h-28" />
        ))}
      </div>
    );
  }

  const totalGates =
    data.gateStats.passed + data.gateStats.failed + data.gateStats.pending;
  const maxStageCount = Math.max(1, ...data.stageDistribution.map((s) => s.count));

  return (
    <div className="space-y-4">
      {/* Üst istatistikler */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          value={data.activeProjects}
          label="Aktif Proje"
          hint="Geliştirme + Stage + Production"
          tone="green"
        />
        <StatCard value={data.liveProjects} label="Canlı Proje" tone="violet" />
        <StatCard
          value={data.swatQueueCount}
          label="SWAT Kuyruğu"
          hint="Multidisipliner inceleme bekliyor"
          tone="gold"
        />
        <StatCard
          value={data.slaBreaches}
          label="SLA İhlali"
          hint={data.slaBreaches > 0 ? 'Süresi aşılmış' : 'Tümü zamanında'}
          tone={data.slaBreaches > 0 ? 'red' : 'green'}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Aşama dağılımı */}
        <div className="card p-5">
          <h3 className="font-bold text-kt-green-900 mb-3">Yaşam Döngüsü Dağılımı</h3>
          <ul className="space-y-2.5">
            {data.stageDistribution.map((s) => (
              <li key={s.stage}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-kt-green-900">
                    {STAGE_META[s.stage].icon} {STAGE_META[s.stage].label}
                  </span>
                  <span className="tabular-nums text-kt-gray-600">{s.count} proje</span>
                </div>
                <div className="h-2 rounded-full bg-kt-gray-100 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-kt-green-500 to-kt-green-700"
                    style={{ width: `${Math.round((s.count / maxStageCount) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Kalite kapısı + onay durumu */}
        <div className="card p-5">
          <h3 className="font-bold text-kt-green-900 mb-3">Kalite Kapıları & Onaylar</h3>
          {totalGates === 0 ? (
            <p className="text-sm text-kt-gray-400 italic">Henüz kalite kapısı yok.</p>
          ) : (
            <div className="flex gap-2 mb-4">
              <div className="flex-1 text-center rounded-lg bg-kt-green-50 border border-kt-green-200 py-3">
                <div className="text-2xl font-extrabold text-kt-green-700">
                  {data.gateStats.passed}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-kt-gray-500 font-bold">
                  Geçti
                </div>
              </div>
              <div className="flex-1 text-center rounded-lg bg-red-50 border border-red-200 py-3">
                <div className="text-2xl font-extrabold text-red-600">
                  {data.gateStats.failed}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-kt-gray-500 font-bold">
                  Kaldı
                </div>
              </div>
              <div className="flex-1 text-center rounded-lg bg-kt-gray-50 border border-kt-gray-200 py-3">
                <div className="text-2xl font-extrabold text-kt-gray-600">
                  {data.gateStats.pending}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-kt-gray-500 font-bold">
                  Bekliyor
                </div>
              </div>
            </div>
          )}
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900">
            <strong>{data.pendingApprovals}</strong> bekleyen insan onayı (Stage / Production).
          </div>
        </div>
      </div>

      <RaciCard />
      <MdStandardsCard />

      <div className="text-xs text-kt-gray-400 text-right">
        Son güncelleme: {new Date(data.generatedAt).toLocaleString('tr-TR')}
      </div>
    </div>
  );
}
