/**
 * MD Standartları kartı — kılavuz §4.1 "Değiştirilemez Referanslar".
 * Ajanlar tüm kararlarını bu standartlara göre verir.
 */
import { MD_STANDARDS } from '../../constants/governance';

export function MdStandardsCard() {
  return (
    <div className="card p-5">
      <h3 className="font-bold text-kt-green-900 mb-1">MD Standartları</h3>
      <p className="text-xs text-kt-gray-500 mb-3">
        Yönetişim ajanları tüm kapı kararlarını bu değiştirilemez referans
        dosyalarına göre verir (Yönetişim Kılavuzu §4.1).
      </p>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {MD_STANDARDS.map((md) => (
          <li
            key={md.code}
            className="rounded-lg border border-kt-gray-200 bg-kt-gray-50/60 p-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-kt-green-100 text-kt-green-800 font-mono">
                {md.code}
              </span>
              <span className="text-sm font-bold text-kt-green-900">{md.title}</span>
            </div>
            <p className="text-xs text-kt-gray-600 leading-relaxed">{md.scope}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
