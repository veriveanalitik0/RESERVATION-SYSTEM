/**
 * Geliştirme ortamı hızlı-giriş paneli.
 *
 * YALNIZ `import.meta.env.DEV` iken render edilir — prod build'de Vite bu
 * bloğu tamamen ağaç-budar, demo parolalar bundle'a girmez. Hesaplar
 * backend/src/db/seed-demo.ts (SEED_DEMO=1) ile yüklenir; seed
 * çalıştırılmadıysa butonlar "kullanıcı bulunamadı" hatası verir.
 */

export interface QuickAccount {
  email: string;
  password: string;
  /** Buton üstündeki kısa etiket. */
  label: string;
  /** Etiketin altındaki rol açıklaması. */
  hint: string;
}

/** Her yönetişim panelinden bir temsilci — seed-demo.ts ile birebir eşleşir. */
export const QUICK_ACCOUNTS: QuickAccount[] = [
  { email: 'admin@klab.test', password: 'Admin1234!Pass', label: 'Admin', hint: 'Yönetim paneli' },
  { email: 'user@klab.test', password: 'Demo1234!Pass', label: 'Kullanıcı', hint: 'Standart hesap' },
  { email: 'ayse.yilmaz@klab.test', password: 'Ayse1234!Pass', label: 'Danışman', hint: 'Analitik danışman' },
  { email: 'burak.sahin@klab.test', password: 'Burak1234!Pass', label: 'Ar-Ge', hint: 'YZ / Ar-Ge' },
  { email: 'izleyici@klab.test', password: 'Izleyici1234!', label: 'İzleyici', hint: 'Salt-okunur' },
];

interface Props {
  /** Hesabı seçince çağrılır — tek tıkta doldur + gönder. */
  onPick: (account: QuickAccount) => void;
  disabled?: boolean;
}

export function DevQuickLogin({ onPick, disabled }: Props) {
  if (!import.meta.env.DEV) return null;

  return (
    <div className="mt-5 rounded-2xl border border-kt-gold-400/25 bg-black/35 backdrop-blur-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-kt-gold-300">
          Hızlı giriş
        </span>
        <span className="text-[10px] text-white/40">yalnız geliştirme ortamı</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {QUICK_ACCOUNTS.map((acc) => (
          <button
            key={acc.email}
            type="button"
            disabled={disabled}
            onClick={() => onPick(acc)}
            title={acc.email}
            className="px-2.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10
              hover:border-kt-gold-400/40 text-left transition-all
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="text-xs font-semibold text-white leading-tight">{acc.label}</div>
            <div className="text-[10px] text-white/50 leading-tight mt-0.5">{acc.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
