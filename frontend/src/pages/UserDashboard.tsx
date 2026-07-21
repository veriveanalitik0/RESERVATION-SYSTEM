/**
 * Kullanıcı dashboard'u — giriş sonrası ana sayfa; düzenli kart grid'i.
 *
 *  - AKTİF ÇALIŞMA: onaylı ve süresi devam eden booking (oda, süre etiketi,
 *    kalan süre + geçen/kalan gün ilerleme çubuğu, yaşam döngüsü aşaması)
 *  - Kullanıcının kendisinin düzenleyebildiği ilerleme notu (proje kartında)
 *  - YAKLAŞAN ZİYARETLER: bugünden ileri 'scheduled' randevular
 *  - ÖDÜNÇ KİTAPLARIM: aktif ödünçler + son teslim tarihine kalan gün
 *  - RANDEVU TALEPLERİM: son 5 talep, durum rozetiyle
 *  - HIZLI ERİŞİM: sohbet / danışman / takvim / yeni randevu kısayolları
 *
 * Her kart kendi verisini paralel yükler ve kendi iskeletini gösterir; bir
 * kartın yükleme hatası sayfayı kırmaz (kart sessiz boş-durumda kalır).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { StatusBadge } from '../components/StatusBadge';
import { ProjectLifecycleBar } from '../components/governance/ProjectLifecycleBar';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import { computeNextVisit, daysAwayLabel } from '../components/UpcomingVisitCard';
import { bookingPeriodLabel, daysUntilYmd, ymdLocal } from '../lib/utils';
import type { Appointment, BookLoan, Booking } from '../types';

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** Tam ISO datetime → "Çar, 08 Tem" gibi kısa gün etiketi. */
function fmtDayShort(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

/** Tam ISO datetime → "14:30". */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** Onaylı ve bugünü kapsayan (veya gelecekte başlayacak) booking'ler aktiftir. */
function findActiveBookings(bookings: Booking[]): Booking[] {
  const today = ymdLocal();
  return bookings.filter((b) => b.status === 'approved' && b.endDate >= today);
}

/** Kart başlığı — küçük etiket + opsiyonel "tümü →" linki. */
function CardHeader({ title, to, toLabel }: { title: string; to?: string; toLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-xs uppercase tracking-widest text-kt-gold-700 font-bold">{title}</h3>
      {to && (
        <Link
          to={to}
          className="text-xs font-semibold text-kt-green-700 hover:text-kt-gold-600 transition-colors"
        >
          {toLabel ?? 'Tümü →'}
        </Link>
      )}
    </div>
  );
}

/** Aktif booking için geçen/kalan gün ilerleme çubuğu + kalan süre rozeti. */
function RemainingProgress({ booking }: { booking: Booking }) {
  const remaining = daysUntilYmd(booking.endDate); // 0 = bugün son gün
  const untilStart = daysUntilYmd(booking.startDate); // >0 = henüz başlamadı
  const totalDays = remaining - untilStart + 1; // start..end dahil toplam gün
  const elapsedDays = Math.min(Math.max(-untilStart + 1, 0), Math.max(totalDays, 1));
  const pct =
    totalDays > 0 ? Math.round((elapsedDays / totalDays) * 100) : remaining >= 0 ? 0 : 100;

  const label =
    untilStart > 0
      ? `${untilStart} gün sonra başlıyor`
      : remaining === 0
        ? 'Bugün son gün'
        : `${remaining} gün kaldı`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-kt-gray-500">
          {untilStart > 0 ? 'Başlamadı' : `Geçen: ${elapsedDays} gün`} · Toplam:{' '}
          {Math.max(totalDays, 1)} gün
        </span>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
            remaining <= 3 && untilStart <= 0
              ? 'bg-kt-gold-100 text-kt-gold-800'
              : 'bg-kt-green-50 text-kt-green-800'
          }`}
        >
          {label}
        </span>
      </div>
      <div className="h-2 rounded-full bg-kt-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-kt-green-500 to-kt-gold-400 transition-all"
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function UserDashboard() {
  const auth = useAuth();
  const toast = useToast();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loans, setLoans] = useState<BookLoan[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [loadingLoans, setLoadingLoans] = useState(true);

  const [note, setNote] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  // Her kart kendi verisini yükler — hata durumunda kart sessiz boş-durumda kalır.
  const loadBookings = useCallback(async () => {
    try {
      const res = await api.listUserBookings();
      setBookings(res.bookings);
    } catch {
      // sessiz boş-durum
    } finally {
      setLoadingBookings(false);
    }
  }, []);

  const loadAppointments = useCallback(async () => {
    try {
      const res = await api.listUserAppointments({ from: ymdLocal() });
      setAppointments(res.appointments);
    } catch {
      // sessiz boş-durum
    } finally {
      setLoadingAppointments(false);
    }
  }, []);

  const loadLoans = useCallback(async () => {
    try {
      const res = await api.listMyLoans();
      setLoans(res.loans);
    } catch {
      // sessiz boş-durum
    } finally {
      setLoadingLoans(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadBookings(), loadAppointments(), loadLoans()]);
  }, [loadBookings, loadAppointments, loadLoans]);

  // Real-time: booking/randevu değişikliklerinde ilgili kartı tazele.
  useRealtimeEvents('user', (type) => {
    if (
      type === 'booking.created' ||
      type === 'booking.updated' ||
      type === 'booking.reviewed' ||
      type === 'booking.withdrawn' ||
      type === 'waitlist.changed'
    ) {
      void loadBookings();
    }
    if (type === 'appointment.changed') void loadAppointments();
  });

  const active = useMemo(() => findActiveBookings(bookings), [bookings]);

  // Değerlendirilmekte olan (onay bekleyen / revizyon istenen) talepler —
  // aktif randevusu olmayan kullanıcıya boş-durum kartında ipucu olarak gösterilir.
  const waiting = useMemo(
    () => bookings.filter((b) => b.status === 'pending' || b.status === 'feedback_requested'),
    [bookings]
  );

  // Son 5 talep (en yenisi üstte) — durum rozetiyle.
  const recentRequests = useMemo(
    () =>
      [...bookings]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 5),
    [bookings]
  );

  // Bugünden ileri, planlanmış ziyaretlerin ilk 4'ü.
  const upcomingAppointments = useMemo(() => {
    const now = Date.now();
    return appointments
      .filter((a) => a.status === 'scheduled' && new Date(a.endAt).getTime() >= now)
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
      .slice(0, 4);
  }, [appointments]);

  // Randevu yoksa "Yaklaşan Ziyaretler" kartında en yakın ONAYLI dönem
  // başlangıcı gösterilir — takvimle aynı öncelik kuralı (computeNextVisit).
  // Bekleyen talepler bilinçli olarak gösterilmez: tarihler onaylanınca
  // takvime/karta düşer (kullanıcı kararı, 2026-07-21).
  const nextBookingStart = useMemo(() => {
    if (upcomingAppointments.length > 0) return null;
    const v = computeNextVisit(appointments, bookings);
    return v && v.kind === 'approved' ? v : null;
  }, [upcomingAppointments, appointments, bookings]);

  // Aktif (ve gecikmiş) ödünçler — teslim tarihi en yakın olan üstte.
  const activeLoans = useMemo(
    () =>
      loans
        .filter((l) => l.status === 'active' || l.status === 'overdue')
        .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1)),
    [loans]
  );

  function startEditNote(b: Booking) {
    setEditingNoteId(b.id);
    setNote(b.progressNote ?? '');
  }

  async function saveNote(bookingId: string) {
    setSavingNote(true);
    try {
      const res = await api.updateBookingProgress(bookingId, note.trim());
      setBookings((prev) => prev.map((b) => (b.id === bookingId ? res.booking : b)));
      setEditingNoteId(null);
      toast.push('success', 'İlerleme notunuz kaydedildi.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Not kaydedilemedi.');
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <AppShell kind="user">
      <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">
            Hoş geldiniz{auth.user ? `, ${auth.user.fullName.split(' ')[0]}` : ''}
          </h1>
          <p className="text-kt-gray-500">
            {loadingBookings
              ? 'Panonuz yükleniyor…'
              : active.length > 0
                ? 'Aktif çalışmanızın özeti ve ilerleme durumunuz.'
                : 'Çalışmanıza başlamak için bir randevu oluşturun.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/rooms" className="btn-secondary">Odalara Göz At</Link>
          <Link to="/bookings" className="btn-secondary">Tüm Taleplerim →</Link>
        </div>
      </div>

      <div className="space-y-6">
        {/* ============ AKTİF ÇALIŞMA + PROJE KARTI ============ */}
        {loadingBookings ? (
          <div className="card p-6 animate-pulse h-64" />
        ) : active.length === 0 ? (
          <div className="card p-8 md:p-10 text-center">
            <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-kt-green-50 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-kt-green-600"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-extrabold text-kt-green-900 mb-2">
              Henüz aktif bir çalışmanız yok
            </h2>
            <p className="text-kt-gray-500 mb-6 max-w-md mx-auto">
              AI Lab çalışma istasyonlarını inceleyip projeniz için uygun bir odaya
              randevu oluşturun. Randevunuz onaylandığında çalışmanızın özeti ve
              ilerleme takibi burada görünecek.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/rooms" className="btn-pill-primary btn-pill-md">
                Randevu Al
              </Link>
              <Link to="/bookings" className="btn-secondary">
                Taleplerimi Gör
              </Link>
            </div>

            {waiting.length > 0 && (
              <div className="mt-6 rounded-xl bg-kt-gold-50 border border-kt-gold-200 p-4 text-left max-w-xl mx-auto">
                <p className="text-sm text-kt-green-900">
                  <strong>{waiting.length}</strong> talebiniz değerlendiriliyor —
                  onaylandığında çalışmanız burada görünecek.{' '}
                  <Link
                    to="/bookings"
                    className="font-semibold text-kt-gold-700 hover:text-kt-gold-800 underline"
                  >
                    Taleplerimi gör →
                  </Link>
                </p>
              </div>
            )}
          </div>
        ) : (
          active.map((b) => (
            <section key={b.id} className="card p-6">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase tracking-widest text-kt-gold-700 font-bold mb-1">
                    Aktif Çalışma · {b.roomCode}
                  </div>
                  <h2 className="text-2xl font-extrabold text-kt-green-900">{b.projectName}</h2>
                  <p className="text-sm text-kt-gray-500 mt-1">
                    {b.roomName} · {fmtDate(b.startDate)} — {fmtDate(b.endDate)} ·{' '}
                    {bookingPeriodLabel(b.period, b.periodMonths)}
                    {b.weekdays.length < 7 && (
                      <> · {b.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(', ')}</>
                    )}
                  </p>
                </div>
              </div>

              {/* Kalan süre + geçen/kalan gün ilerleme çubuğu */}
              <div className="mt-4">
                <RemainingProgress booking={b} />
              </div>

              <div className="my-5">
                <ProjectLifecycleBar stage={b.lifecycleStage} />
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div className="rounded-xl bg-kt-gray-50 border border-kt-gray-100 p-4">
                  <h3 className="text-sm font-bold text-kt-green-900 mb-2">Proje Özeti</h3>
                  <p className="text-sm text-kt-gray-600 whitespace-pre-wrap line-clamp-6">
                    {b.projectDescription}
                  </p>
                </div>

                {/* Kullanıcının kendisinin düzenlediği ilerleme alanı */}
                <div className="rounded-xl bg-white border border-kt-gray-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-kt-green-900">
                      Ne Üzerinde Çalışıyorum? / İlerleme
                    </h3>
                    {editingNoteId !== b.id && (
                      <button
                        type="button"
                        onClick={() => startEditNote(b)}
                        className="text-xs font-semibold text-kt-violet-600 hover:text-kt-violet-800 transition-colors"
                      >
                        Düzenle
                      </button>
                    )}
                  </div>

                  {editingNoteId === b.id ? (
                    <div>
                      <textarea
                        className="textarea w-full"
                        rows={5}
                        maxLength={2000}
                        value={note}
                        autoFocus
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Bu hafta neler yaptınız, hangi aşamadasınız, planınız ne?"
                      />
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-kt-gray-400">{note.length} / 2000</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingNoteId(null)}
                            disabled={savingNote}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-kt-gray-100 text-kt-green-800 hover:bg-kt-gray-200"
                          >
                            Vazgeç
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveNote(b.id)}
                            disabled={savingNote}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-kt-green-700 text-white hover:bg-kt-green-800 disabled:opacity-50"
                          >
                            {savingNote ? 'Kaydediliyor…' : 'Kaydet'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : b.progressNote ? (
                    <div>
                      <p className="text-sm text-kt-gray-700 whitespace-pre-wrap">{b.progressNote}</p>
                      {b.progressUpdatedAt && (
                        <p className="text-[11px] text-kt-gray-400 mt-2">
                          Son güncelleme: {b.progressUpdatedAt}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-kt-gray-400 italic">
                      Henüz ilerleme notu eklemediniz. "Düzenle" ile çalışmanızı paylaşın —
                      lab ekibi durumunuzu buradan takip eder.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/bookings" className="btn-secondary text-sm">
                  Randevu &amp; Aşama Detayları
                </Link>
                <Link to="/takvim" className="btn-secondary text-sm">
                  Takvimim
                </Link>
              </div>
            </section>
          ))
        )}

        {/* ============ ORTA SIRA: ZİYARETLER / KİTAPLAR / TALEPLER ============ */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Yaklaşan ziyaret randevuları */}
          {loadingAppointments ? (
            <div className="card p-6 animate-pulse h-56" />
          ) : (
            <section className="card p-6">
              <CardHeader title="Yaklaşan Ziyaretler" to="/takvim" toLabel="Takvim →" />
              {upcomingAppointments.length === 0 ? (
                <div className="py-6">
                  {/* Randevu yoksa en yakın ONAYLI dönem başlangıcını göster. */}
                  {nextBookingStart && !loadingBookings ? (
                    <div className="flex items-center gap-3 rounded-xl border px-3 py-2.5 mb-3 bg-kt-green-50 border-kt-green-200">
                      <div className="w-12 shrink-0 text-center rounded-lg bg-white border border-kt-gray-200 py-1.5">
                        <div className="text-[10px] uppercase font-bold text-kt-gold-700 leading-none">
                          {new Date(`${nextBookingStart.date}T00:00:00`).toLocaleDateString(
                            'tr-TR',
                            { weekday: 'short' }
                          )}
                        </div>
                        <div className="text-sm font-extrabold text-kt-green-900 leading-tight">
                          {new Date(`${nextBookingStart.date}T00:00:00`).getDate()}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-kt-green-900 truncate">
                          {nextBookingStart.roomCode} · {nextBookingStart.roomName}
                        </p>
                        <p className="text-xs text-kt-gray-500">
                          Dönem başlangıcı · {daysAwayLabel(daysUntilYmd(nextBookingStart.date))}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-kt-gray-400 mb-3 text-center">
                      Yaklaşan ziyaret randevunuz yok.
                    </p>
                  )}
                  <div className="text-center">
                    <Link
                      to="/takvim"
                      className="text-sm font-semibold text-kt-green-700 hover:text-kt-gold-600"
                    >
                      Takvimden randevu planla →
                    </Link>
                  </div>
                </div>
              ) : (
                <ul className="space-y-3">
                  {upcomingAppointments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-xl bg-kt-gray-50 border border-kt-gray-100 px-3 py-2.5"
                    >
                      <div className="w-12 shrink-0 text-center rounded-lg bg-white border border-kt-gray-200 py-1.5">
                        <div className="text-[10px] uppercase font-bold text-kt-gold-700 leading-none">
                          {fmtDayShort(a.startAt).split(' ')[0]}
                        </div>
                        <div className="text-sm font-extrabold text-kt-green-900 leading-tight">
                          {new Date(a.startAt).getDate()}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-kt-green-900 truncate">
                          {a.roomCode} · {a.roomName}
                        </p>
                        <p className="text-xs text-kt-gray-500">
                          {fmtDayShort(a.startAt)} · {fmtTime(a.startAt)}–{fmtTime(a.endAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Ödünç kitaplarım */}
          {loadingLoans ? (
            <div className="card p-6 animate-pulse h-56" />
          ) : (
            <section className="card p-6">
              <CardHeader title="Ödünç Kitaplarım" to="/kutuphane" toLabel="Kütüphane →" />
              {activeLoans.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-kt-gray-400 mb-3">
                    Şu an ödünç aldığınız kitap yok.
                  </p>
                  <Link
                    to="/kutuphane"
                    className="text-sm font-semibold text-kt-green-700 hover:text-kt-gold-600"
                  >
                    Kütüphaneye göz at →
                  </Link>
                </div>
              ) : (
                <ul className="space-y-3">
                  {activeLoans.map((loan) => {
                    const remaining = daysUntilYmd(loan.dueAt.slice(0, 10));
                    return (
                      <li
                        key={loan.id}
                        className="rounded-xl bg-kt-gray-50 border border-kt-gray-100 px-3 py-2.5"
                      >
                        <p className="text-sm font-semibold text-kt-green-900 truncate">
                          {loan.bookTitle}
                        </p>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-xs text-kt-gray-500">
                            Teslim: {fmtDayShort(loan.dueAt)}
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              remaining < 0
                                ? 'text-rose-600'
                                : remaining <= 2
                                  ? 'text-kt-gold-700'
                                  : 'text-kt-green-700'
                            }`}
                          >
                            {remaining < 0
                              ? `${Math.abs(remaining)} gün gecikti`
                              : remaining === 0
                                ? 'Bugün son gün'
                                : `${remaining} gün kaldı`}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* Randevu taleplerim — son 5, durum rozetiyle */}
          {loadingBookings ? (
            <div className="card p-6 animate-pulse h-56" />
          ) : (
            <section className="card p-6">
              <CardHeader title="Randevu Taleplerim" to="/bookings" />
              {recentRequests.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-kt-gray-400 mb-3">
                    Henüz randevu talebi oluşturmadınız.
                  </p>
                  <Link
                    to="/rooms"
                    className="text-sm font-semibold text-kt-green-700 hover:text-kt-gold-600"
                  >
                    Odalara göz at →
                  </Link>
                </div>
              ) : (
                <ul className="space-y-3">
                  {recentRequests.map((b) => (
                    <li key={b.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-kt-green-900 truncate">
                          {b.projectName}
                        </p>
                        <p className="text-xs text-kt-gray-500">
                          {b.roomCode} · {fmtDate(b.startDate)}
                        </p>
                      </div>
                      <StatusBadge status={b.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* ============ HIZLI ERİŞİM / YARDIM ============ */}
        <section className="card p-6">
          <CardHeader title="Hızlı Erişim" />
          <div className="flex flex-wrap gap-3">
            <Link to="/rooms" className="btn-pill-primary btn-pill-sm">
              Yeni Randevu
            </Link>
            <Link to="/takvim" className="btn-secondary text-sm">
              Takvimim
            </Link>
            <Link to="/sohbet" className="btn-secondary text-sm">
              Sohbet
            </Link>
            <Link to="/sohbet" className="btn-secondary text-sm">
              Analitik Danışmana Yaz
            </Link>
          </div>
          <p className="text-xs text-kt-gray-400 mt-3">
            Sorularınız için sohbet üzerinden lab ekibine veya Analitik Danışman'a
            yazabilirsiniz — sağ alttaki Destek butonu da her sayfada açıktır.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
