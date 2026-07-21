/**
 * "Yaklaşan ziyaret" kartı — kullanıcının bir sonraki lab gününü öne çıkarır.
 *
 * Öncelik sırası (NEDEN: kesinleşmişlik derecesi azalan sırada):
 *  1) Gelecekteki (veya şu an süren) en yakın 'scheduled' randevu — saati belli, kesin.
 *  2) En yakın GELECEK onaylı booking başlangıcı — günü kesin, saati yok.
 *
 * Bekleyen (pending) talepler BİLİNÇLİ olarak kapsam dışı: iş kuralı gereği
 * tarihler ancak onaylanınca takvime düşer; kart da yalnız kesinleşmiş
 * ziyaretleri gösterir (kullanıcı kararı, 2026-07-21).
 *
 * computeNextVisit ayrı export edilir ki UserDashboard gibi başka sayfalar
 * kart görselini almadan aynı öncelik kuralını paylaşabilsin (tek kaynak).
 */
import { daysUntilYmd, ymdLocal } from '../lib/utils';
import type { Appointment, Booking } from '../types';

export type NextVisit = {
  /** 'appointment' saatli kesin ziyaret; 'approved' onaylı booking başlangıcı. */
  kind: 'appointment' | 'approved';
  /** Ziyaret günü — YYYY-MM-DD (yerel). */
  date: string;
  roomCode: string;
  roomName: string;
  /** Yalnız kind='appointment' için: "14:00 – 16:30" gibi saat aralığı. */
  timeLabel?: string;
  title?: string;
};

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function computeNextVisit(
  appointments: Appointment[],
  bookings: Booking[]
): NextVisit | null {
  const now = Date.now();
  // (1) Süren veya gelecekteki en yakın randevu — endAt bazlı ki şu an devam
  // eden ziyaret de "Bugün" olarak öne çıksın (dashboard'daki kuralla aynı).
  const appt = [...appointments]
    .filter((a) => a.status === 'scheduled' && new Date(a.endAt).getTime() >= now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
  if (appt) {
    return {
      kind: 'appointment',
      date: ymdLocal(new Date(appt.startAt)),
      roomCode: appt.roomCode,
      roomName: appt.roomName,
      timeLabel: `${fmtClock(appt.startAt)} – ${fmtClock(appt.endAt)}`,
      title: appt.title,
    };
  }

  const today = ymdLocal();
  const nearestStart = (list: Booking[]) =>
    [...list]
      .filter((b) => b.startDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  // (2) Gelecekte başlayacak en yakın onaylı dönem.
  const approved = nearestStart(bookings.filter((b) => b.status === 'approved'));
  if (approved) {
    return {
      kind: 'approved',
      date: approved.startDate,
      roomCode: approved.roomCode,
      roomName: approved.roomName,
    };
  }
  return null;
}

/** 0 → "Bugün", 1 → "Yarın", n → "n gün sonra". */
export function daysAwayLabel(days: number): string {
  if (days <= 0) return 'Bugün';
  if (days === 1) return 'Yarın';
  return `${days} gün sonra`;
}

export function UpcomingVisitCard({
  visit,
  onShowDate,
}: {
  visit: NextVisit;
  /** Verilirse "Takvimde gör" aksiyonu gösterilir (UserCalendar günü odaklar). */
  onShowDate?: (date: string) => void;
}) {
  const days = daysUntilYmd(visit.date);
  const d = new Date(`${visit.date}T00:00:00`);
  const dateLabel = d.toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  // Renk dili sayfanın geri kalanıyla aynı: randevu=cyan, onaylı dönem=yeşil.
  const accent =
    visit.kind === 'appointment'
      ? { box: 'bg-cyan-50 border-cyan-200 text-cyan-800', chip: 'bg-cyan-100 text-cyan-800' }
      : { box: 'bg-kt-green-50 border-kt-green-200 text-kt-green-800', chip: 'bg-kt-green-100 text-kt-green-800' };

  return (
    <section className="card p-4 mb-4 border border-kt-gray-100" aria-label="Yaklaşan ziyaret">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Gün bloğu — dashboard'daki mini tarih kutusunun büyük hali */}
        <div className={`w-16 shrink-0 text-center rounded-xl border py-2 ${accent.box}`}>
          <div className="text-[10px] uppercase font-bold leading-none">
            {d.toLocaleDateString('tr-TR', { weekday: 'short' })}
          </div>
          <div className="text-2xl font-extrabold leading-tight">{d.getDate()}</div>
          <div className="text-[10px] font-semibold leading-none">
            {d.toLocaleDateString('tr-TR', { month: 'short' })}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-kt-gray-500">
              Yaklaşan ziyaret
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${accent.chip}`}>
              {daysAwayLabel(days)}
            </span>
          </div>
          <p className="text-base font-bold text-kt-green-900 truncate">
            {dateLabel}
            {visit.timeLabel && (
              <span className="text-cyan-800 font-semibold"> · {visit.timeLabel}</span>
            )}
          </p>
          <p className="text-sm text-kt-gray-600 truncate">
            <span className="font-mono font-semibold">{visit.roomCode}</span> · {visit.roomName}
            {visit.kind === 'appointment' && visit.title && <> · {visit.title}</>}
            {visit.kind === 'approved' && <> · onaylı dönem başlangıcı</>}
          </p>
        </div>

        {onShowDate && (
          <button
            type="button"
            onClick={() => onShowDate(visit.date)}
            className="btn-secondary text-sm shrink-0"
          >
            Takvimde gör
          </button>
        )}
      </div>
    </section>
  );
}
