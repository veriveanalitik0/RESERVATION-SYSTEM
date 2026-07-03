/**
 * Güvenlik kuralları kartı — kılavuz §5 "Değiştirilemez Kurallar".
 * Başvuru ekranında bilgilendirme amaçlı gösterilir.
 */
import { SECURITY_RULES } from '../../constants/governance';

export function SecurityRulesCard() {
  return (
    <div className="rounded-xl border border-kt-gold-200 bg-kt-gold-50/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🛡️</span>
        <h3 className="font-bold text-kt-green-900 text-sm">
          Değiştirilemez Güvenlik Kuralları
        </h3>
      </div>
      <p className="text-xs text-kt-gray-600 mb-3">
        Bu kurallar her proje türü için geçerlidir ve hiçbir koşulda esnetilemez
        (Yönetişim Kılavuzu §5).
      </p>
      <ul className="space-y-1.5">
        {SECURITY_RULES.map((r) => (
          <li key={r.rule} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 mt-0.5">
              {r.severity === 'critical' ? '🔴' : '🟡'}
            </span>
            <div>
              <span className="font-semibold text-kt-green-900">{r.rule}</span>
              <span className="text-kt-gray-600"> — {r.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
