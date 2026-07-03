/**
 * Kalite kapısı sihirbazı — "Projeme hangi kapılar uygulanır?".
 * Başvuru formundaki proje türü + dış API seçimine canlı tepki verir.
 */
import type { ProjectType } from '../../types';
import { gatePlan } from '../../constants/governance';

interface Props {
  projectType: ProjectType | '';
  usesExternalApi: boolean;
}

export function GateWizard({ projectType, usesExternalApi }: Props) {
  if (!projectType) {
    return (
      <div className="rounded-xl border border-kt-gray-200 bg-kt-gray-50 p-4 text-sm text-kt-gray-500">
        Proje türünü seç — projene uygulanacak kalite kapılarını burada göreceksin.
      </div>
    );
  }

  const plan = gatePlan(projectType, usesExternalApi);

  return (
    <div className="rounded-xl border border-kt-green-200 bg-kt-green-50/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🚦</span>
        <h3 className="font-bold text-kt-green-900 text-sm">
          Projene Uygulanacak Kalite Kapıları
        </h3>
        <span
          className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-md border ${
            plan.governanceLevel === 'full'
              ? 'bg-kt-violet-100 text-kt-violet-700 border-kt-violet-300'
              : 'bg-kt-gold-100 text-kt-gold-800 border-kt-gold-300'
          }`}
        >
          {plan.governanceLevel === 'full' ? 'Tam Yönetişim' : 'Temel Yönetişim'}
        </span>
      </div>
      <ul className="space-y-1 mb-3">
        {plan.gates.map((g) => (
          <li key={g.label} className="flex items-center gap-2 text-xs">
            <span>{g.applies ? '✅' : '⚪'}</span>
            <span
              className={
                g.applies ? 'text-kt-green-900 font-semibold' : 'text-kt-gray-400 line-through'
              }
            >
              {g.label}
            </span>
            <span className="text-kt-gray-400">· {g.agent}</span>
          </li>
        ))}
      </ul>
      {plan.notes.map((n) => (
        <p key={n} className="text-[11px] text-kt-gray-600 leading-relaxed">
          {n}
        </p>
      ))}
    </div>
  );
}
