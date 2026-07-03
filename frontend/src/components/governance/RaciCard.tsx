/**
 * RACI matrisi kartı — kılavuz §7 sorumluluk dağılımı.
 */
import { RACI_LEGEND, RACI_MATRIX, RACI_ROLES } from '../../constants/governance';
import type { RaciValue } from '../../constants/governance';

function cellClass(v: RaciValue): string {
  if (v === 'R/A' || v === 'R' || v === 'A')
    return 'bg-kt-green-100 text-kt-green-800 font-bold';
  if (v === 'C') return 'bg-kt-gold-50 text-kt-gold-800';
  if (v === 'I') return 'bg-kt-gray-50 text-kt-gray-500';
  return 'text-kt-gray-300';
}

export function RaciCard() {
  return (
    <div className="card p-5">
      <h3 className="font-bold text-kt-green-900 mb-1">RACI — Sorumluluk Dağılımı</h3>
      <p className="text-xs text-kt-gray-500 mb-3">
        Her aktivitede kimin sorumlu, hesap veren, danışılan ve bilgilendirilen
        olduğu (Yönetişim Kılavuzu §7).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 text-kt-gray-500 font-bold">Aktivite</th>
              {RACI_ROLES.map((role) => (
                <th
                  key={role}
                  className="px-2 py-1.5 text-kt-gray-500 font-bold text-center whitespace-nowrap"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RACI_MATRIX.map((row) => (
              <tr key={row.activity} className="border-t border-kt-gray-100">
                <td className="px-2 py-1.5 font-semibold text-kt-green-900 whitespace-nowrap">
                  {row.activity}
                </td>
                {row.values.map((v, i) => (
                  <td key={i} className="px-1 py-1.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded ${cellClass(v)}`}>
                      {v}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-kt-gray-500">
        {Object.entries(RACI_LEGEND).map(([k, label]) => (
          <span key={k}>
            <strong>{k}</strong> — {label}
          </span>
        ))}
      </div>
    </div>
  );
}
