/**
 * Kütüphane — kullanıcı sayfası (/kutuphane).
 *
 * İki bölüm:
 *   1. "Kitaplar"   — aktif kitap kart grid'i + ödünç alma (süre seçici 7/14/30).
 *   2. "Kitaplarım" — kullanıcının aktif/gecikmiş ödünçleri (iade) + iade geçmişi.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { api } from '../services/api';
import { CATEGORY_ORDER, OTHER_CATEGORY } from '../constants/library';
import type { Book, BookLoan } from '../types';

type BorrowPeriod = 7 | 14 | 30;
const BORROW_PERIODS: BorrowPeriod[] = [7, 14, 30];

type ExtensionDays = 7 | 14 | 30;
const EXTENSION_DAYS: ExtensionDays[] = [7, 14, 30];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Kalan gün (negatif → gecikme gün sayısı). */
function daysUntil(iso: string): number {
  const due = new Date(iso).getTime();
  const now = Date.now();
  return Math.ceil((due - now) / 86_400_000);
}

/** Ödünç durum rozeti — BookLoanStatus için (StatusBadge yalnız BookingStatus alır). */
function LoanStatusBadge({ status }: { status: BookLoan['status'] }) {
  const cfg: Record<BookLoan['status'], { label: string; cls: string }> = {
    pending: { label: 'Onay bekliyor', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    active: { label: 'Aktif', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    overdue: { label: 'Gecikmiş', cls: 'bg-rose-100 text-rose-800 border-rose-300' },
    returned: { label: 'İade Edildi', cls: 'bg-kt-gray-100 text-kt-gray-600 border-kt-gray-200' },
    rejected: { label: 'Reddedildi', cls: 'bg-rose-100 text-rose-700 border-rose-300' },
  };
  const c = cfg[status];
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${c.cls}`}>
      {c.label}
    </span>
  );
}

/** Kapaksız kitaplar için yer tutucu kitap ikonu. */
function BookPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-kt-green-700 to-kt-green-900 ${className ?? ''}`}
      aria-hidden="true"
    >
      <svg className="w-10 h-10 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    </div>
  );
}

export default function UserLibrary() {
  const toast = useToast();
  const [books, setBooks] = useState<Book[]>([]);
  const [loans, setLoans] = useState<BookLoan[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [search, setSearch] = useState('');
  // Kategori filtresi (null = tümü). Çipe tekrar tıklamak seçimi kaldırır.
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  // Kart bazlı süre seçimi (varsayılan 14 gün). bookId → süre.
  const [periods, setPeriods] = useState<Record<string, BorrowPeriod>>({});
  // Loan bazlı süre-uzatma seçimi (varsayılan 7 gün). loanId → gün.
  const [extDays, setExtDays] = useState<Record<string, ExtensionDays>>({});
  // O an ödünç alınan / iade edilen kayıt id'si (buton spinner + disable).
  const [busyBook, setBusyBook] = useState<string | null>(null);
  const [busyLoan, setBusyLoan] = useState<string | null>(null);

  const loadBooks = useCallback(async () => {
    setLoadingBooks(true);
    try {
      const res = await api.listBooks();
      setBooks(res.books);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Kitaplar yüklenemedi.');
    } finally {
      setLoadingBooks(false);
    }
  }, [toast]);

  const loadLoans = useCallback(async () => {
    setLoadingLoans(true);
    try {
      const res = await api.listMyLoans();
      setLoans(res.loans);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Ödünç kayıtları yüklenemedi.');
    } finally {
      setLoadingLoans(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadBooks();
    void loadLoans();
  }, [loadBooks, loadLoans]);

  const filteredBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Yalnızca aktif kitaplar listelenir.
    const active = books.filter((b) => b.isActive);
    if (!q) return active;
    return active.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.category?.toLowerCase().includes(q) ?? false)
    );
  }, [books, search]);

  // Aktif kitaplardan kategori çipleri — sabit sıra + bilinmeyenler sona (tr alfabetik).
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of books) {
      if (!b.isActive) continue;
      const cat = b.category?.trim() || OTHER_CATEGORY;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const known = CATEGORY_ORDER.filter((c) => counts.has(c));
    const extra = [...counts.keys()]
      .filter((c) => !CATEGORY_ORDER.includes(c) && c !== OTHER_CATEGORY)
      .sort((a, b) => a.localeCompare(b, 'tr'));
    const ordered = [...known, ...extra, ...(counts.has(OTHER_CATEGORY) ? [OTHER_CATEGORY] : [])];
    return ordered.map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }, [books]);

  // Arama + kategori filtresi uygulanmış kitaplar, kategori bölümlerine gruplanır.
  const groupedBooks = useMemo(() => {
    const groups = new Map<string, Book[]>();
    for (const b of filteredBooks) {
      const cat = b.category?.trim() || OTHER_CATEGORY;
      if (selectedCat && cat !== selectedCat) continue;
      const arr = groups.get(cat);
      if (arr) arr.push(b);
      else groups.set(cat, [b]);
    }
    return categories
      .filter((c) => groups.has(c.name))
      .map((c) => ({ name: c.name, books: groups.get(c.name) ?? [] }));
  }, [filteredBooks, selectedCat, categories]);

  // Onay bekleyen talepler (en üstte), aktif/gecikmiş ödünçler (ortada),
  // iade edilmiş / reddedilmiş geçmiş (altta).
  const pendingLoans = useMemo(
    () => loans.filter((l) => l.status === 'pending'),
    [loans]
  );
  const activeLoans = useMemo(
    () => loans.filter((l) => l.status === 'active' || l.status === 'overdue'),
    [loans]
  );
  const pastLoans = useMemo(
    () => loans.filter((l) => l.status === 'returned' || l.status === 'rejected'),
    [loans]
  );

  async function handleBorrow(book: Book) {
    if (busyBook) return;
    setBusyBook(book.id);
    try {
      const period = periods[book.id] ?? 14;
      await api.borrowBook(book.id, period);
      toast.push('success', 'Talebiniz alındı — admin onayına gönderildi.');
      await Promise.all([loadBooks(), loadLoans()]);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Ödünç talebi gönderilemedi.');
    } finally {
      setBusyBook(null);
    }
  }

  async function handleReturn(loan: BookLoan) {
    if (busyLoan) return;
    setBusyLoan(loan.id);
    try {
      await api.returnLoan(loan.id);
      toast.push('success', `"${loan.bookTitle}" iade edildi.`);
      await Promise.all([loadBooks(), loadLoans()]);
    } catch (err) {
      toast.push('error', (err as Error).message || 'İade işlemi başarısız.');
    } finally {
      setBusyLoan(null);
    }
  }

  async function handleRequestExtension(loan: BookLoan, days: ExtensionDays) {
    if (busyLoan) return;
    setBusyLoan(loan.id);
    try {
      await api.requestExtension(loan.id, days);
      toast.push('success', `"${loan.bookTitle}" için ${days} günlük süre uzatma talebi gönderildi.`);
      await loadLoans();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Süre uzatma talebi gönderilemedi.');
    } finally {
      setBusyLoan(null);
    }
  }

  /** Tek kitap kartı — kategori bölümlerinde yeniden kullanılır. */
  function renderBookCard(book: Book) {
    const soldOut = book.availableCopies <= 0;
    const mine = book.borrowedByMe === true;
    const period = periods[book.id] ?? 14;
    const borrowing = busyBook === book.id;
    return (
      <article key={book.id} className="card overflow-hidden flex flex-col">
        <div className="relative h-44 bg-kt-gray-100">
          {book.coverImageUrl ? (
            <img
              src={book.coverImageUrl}
              alt={`${book.title} kitap kapağı`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <BookPlaceholder className="w-full h-full" />
          )}
          {mine && (
            <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-md border bg-kt-violet-100 text-kt-violet-800 border-kt-violet-300">
              Sizde / Talebiniz var
            </span>
          )}
        </div>

        <div className="p-4 flex flex-col flex-1">
          <h3 className="text-base font-bold text-kt-green-900 leading-tight line-clamp-2">
            {book.title}
          </h3>
          <p className="text-sm text-kt-gray-600 mt-0.5 truncate">{book.author}</p>

          {book.category && (
            <div className="mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-kt-violet-100 text-kt-violet-800 text-[11px] font-semibold border border-kt-violet-300">
                {book.category}
              </span>
            </div>
          )}

          {book.description && (
            <p className="text-xs text-kt-gray-500 line-clamp-2 mt-2">
              {book.description}
            </p>
          )}

          <div className="flex items-center justify-between text-xs mt-3 mb-3">
            <span
              className={`font-semibold ${soldOut ? 'text-rose-600' : 'text-kt-green-700'}`}
            >
              Müsait: {book.availableCopies}/{book.totalCopies}
            </span>
          </div>

          <div className="mt-auto">
            {!mine && !soldOut && (
              <div className="flex items-center gap-2 mb-2">
                <label
                  htmlFor={`period-${book.id}`}
                  className="text-xs font-semibold text-kt-gray-600 shrink-0"
                >
                  Süre:
                </label>
                <select
                  id={`period-${book.id}`}
                  value={period}
                  onChange={(e) =>
                    setPeriods((p) => ({
                      ...p,
                      [book.id]: Number(e.target.value) as BorrowPeriod,
                    }))
                  }
                  disabled={borrowing}
                  className="input py-1.5 text-sm flex-1"
                  aria-label={`${book.title} için ödünç süresi`}
                >
                  {BORROW_PERIODS.map((d) => (
                    <option key={d} value={d}>
                      {d} gün
                    </option>
                  ))}
                </select>
              </div>
            )}

            {mine ? (
              <button
                type="button"
                disabled
                className="btn-secondary w-full text-sm opacity-60 cursor-not-allowed"
                aria-label={`${book.title} için talebiniz var veya sizde`}
              >
                Talebiniz var
              </button>
            ) : soldOut ? (
              <button
                type="button"
                disabled
                className="btn-secondary w-full text-sm opacity-60 cursor-not-allowed"
                aria-label={`${book.title} tükendi`}
              >
                Tükendi
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleBorrow(book)}
                disabled={borrowing}
                className="btn-primary w-full text-sm"
                aria-label={`${book.title} kitabını ${period} günlüğüne ödünç talep et`}
              >
                {borrowing ? 'İşleniyor…' : 'Ödünç Talep Et'}
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <AppShell kind="user">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Kütüphane</h1>
        <p className="text-kt-gray-500">
          AI Lab kitaplığından kitap ödünç talep edin (admin onayıyla), ödünçlerinizi takip edin, süre uzatın ve iade edin.
        </p>
      </div>

      {/* ============ BÖLÜM 1: KİTAPLAR ============ */}
      <section aria-labelledby="lib-books-heading" className="mb-12">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
          <h2 id="lib-books-heading" className="text-xl font-bold text-kt-green-800">
            Kitaplar
          </h2>
          <div className="relative sm:max-w-xs w-full">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-kt-gray-400"
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              className="input pl-10"
              placeholder="Başlık, yazar veya kategori ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={60}
              aria-label="Kitaplarda ara"
            />
          </div>
        </div>

        {/* Kategori çipleri — kitaplar konuya göre bölümlere ayrılır, çip hızlı filtredir. */}
        {!loadingBooks && categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label="Kategori filtresi">
            <button
              type="button"
              onClick={() => setSelectedCat(null)}
              aria-pressed={selectedCat === null}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                selectedCat === null
                  ? 'bg-kt-green-700 text-white border-kt-green-700'
                  : 'bg-white border-kt-gray-200 text-kt-gray-600 hover:border-kt-green-400'
              }`}
            >
              Tümü ({categories.reduce((sum, c) => sum + c.count, 0)})
            </button>
            {categories.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setSelectedCat(selectedCat === c.name ? null : c.name)}
                aria-pressed={selectedCat === c.name}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  selectedCat === c.name
                    ? 'bg-kt-green-700 text-white border-kt-green-700'
                    : 'bg-white border-kt-gray-200 text-kt-gray-600 hover:border-kt-green-400'
                }`}
              >
                {c.name} ({c.count})
              </button>
            ))}
          </div>
        )}

        {loadingBooks ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-5 animate-pulse h-64" />
            ))}
          </div>
        ) : groupedBooks.length === 0 ? (
          <EmptyState
            icon="search"
            tone="cyan"
            title={search || selectedCat ? 'Eşleşen kitap yok' : 'Henüz kitap eklenmemiş'}
            description={
              search || selectedCat
                ? 'Arama veya kategori filtresini değiştirip tekrar deneyin.'
                : 'Kütüphaneye kitap eklendiğinde burada listelenecek.'
            }
          />
        ) : (
          <div className="space-y-10">
            {groupedBooks.map((group) => (
              <div key={group.name}>
                <div className="flex items-baseline gap-2 mb-4 pb-2 border-b border-kt-gray-200">
                  <h3 className="text-lg font-bold text-kt-green-900">{group.name}</h3>
                  <span className="text-xs font-semibold text-kt-gray-500">
                    {group.books.length} kitap
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.books.map(renderBookCard)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ BÖLÜM 2: KİTAPLARIM ============ */}
      <section aria-labelledby="lib-myloans-heading">
        <h2 id="lib-myloans-heading" className="text-xl font-bold text-kt-green-800 mb-5">
          Kitaplarım
        </h2>

        {loadingLoans ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse h-20" />
            ))}
          </div>
        ) : (
          <>
            {/* Onay bekleyen talepler — aksiyon yok, yalnız bilgi. */}
            {pendingLoans.length > 0 && (
              <div className="mb-8">
                <h3 className="text-sm font-bold text-kt-gray-600 uppercase tracking-wide mb-3">
                  Onay Bekleyen Talepler ({pendingLoans.length})
                </h3>
                <ul className="space-y-3">
                  {pendingLoans.map((loan) => (
                    <li
                      key={loan.id}
                      className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-amber-200 bg-amber-50/40"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-kt-green-900 truncate">
                            {loan.bookTitle}
                          </span>
                          <LoanStatusBadge status={loan.status} />
                        </div>
                        <div className="text-xs text-kt-gray-500 mt-0.5 truncate">
                          {loan.bookAuthor}
                        </div>
                        <div className="text-xs mt-1 font-medium text-amber-700">
                          {loan.periodDays} günlük ödünç talebi · admin onayı bekleniyor
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Aktif / gecikmiş ödünçler */}
            <div className="mb-8">
              <h3 className="text-sm font-bold text-kt-gray-600 uppercase tracking-wide mb-3">
                Aktif Ödünçler ({activeLoans.length})
              </h3>
              {activeLoans.length === 0 ? (
                <EmptyState
                  icon="bookings"
                  tone="cyan"
                  title="Aktif ödüncünüz yok"
                  description="Yukarıdan bir kitap ödünç alarak başlayabilirsiniz."
                />
              ) : (
                <ul className="space-y-3">
                  {activeLoans.map((loan) => {
                    const overdue = loan.status === 'overdue';
                    const remaining = daysUntil(loan.dueAt);
                    const busy = busyLoan === loan.id;
                    const extPending = loan.extensionRequestedDays != null;
                    const extSel = extDays[loan.id] ?? 7;
                    return (
                      <li
                        key={loan.id}
                        className={`card p-4 flex flex-col gap-3 ${
                          overdue ? 'border-rose-300 bg-rose-50/40' : ''
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-kt-green-900 truncate">
                                {loan.bookTitle}
                              </span>
                              <LoanStatusBadge status={loan.status} />
                              {extPending && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-amber-100 text-amber-800 border-amber-300">
                                  Uzatma talebi: {loan.extensionRequestedDays} gün — onay bekliyor
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-kt-gray-500 mt-0.5 truncate">
                              {loan.bookAuthor}
                            </div>
                            <div
                              className={`text-xs mt-1 font-medium ${
                                overdue ? 'text-rose-700' : 'text-kt-gray-600'
                              }`}
                            >
                              Termin: {fmtDate(loan.dueAt)}
                              {overdue
                                ? ` · ${Math.abs(remaining)} gün gecikti`
                                : remaining >= 0
                                  ? ` · ${remaining} gün kaldı`
                                  : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleReturn(loan)}
                            disabled={busy}
                            className="btn-secondary text-sm shrink-0 self-start sm:self-auto"
                            aria-label={`${loan.bookTitle} kitabını iade et`}
                          >
                            {busy ? 'İşleniyor…' : 'İade Et'}
                          </button>
                        </div>

                        {/* Süre uzatma — bekleyen talep yoksa göster. */}
                        {!extPending && (
                          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-kt-gray-100">
                            <label
                              htmlFor={`ext-${loan.id}`}
                              className="text-xs font-semibold text-kt-gray-600 shrink-0"
                            >
                              Süre uzat:
                            </label>
                            <select
                              id={`ext-${loan.id}`}
                              value={extSel}
                              onChange={(e) =>
                                setExtDays((m) => ({
                                  ...m,
                                  [loan.id]: Number(e.target.value) as ExtensionDays,
                                }))
                              }
                              disabled={busy}
                              className="input py-1.5 text-sm w-28"
                              aria-label={`${loan.bookTitle} için uzatma süresi`}
                            >
                              {EXTENSION_DAYS.map((d) => (
                                <option key={d} value={d}>
                                  {d} gün
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleRequestExtension(loan, extSel)}
                              disabled={busy}
                              className="btn-ghost text-sm shrink-0"
                              aria-label={`${loan.bookTitle} için ${extSel} günlük süre uzatma talep et`}
                            >
                              {busy ? 'İşleniyor…' : 'Süre Uzat'}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Geçmiş — iade edilen / reddedilen */}
            <div>
              <h3 className="text-sm font-bold text-kt-gray-600 uppercase tracking-wide mb-3">
                Geçmiş ({pastLoans.length})
              </h3>
              {pastLoans.length === 0 ? (
                <p className="text-sm text-kt-gray-400 italic py-2">
                  Henüz iade edilmiş veya reddedilmiş kaydınız yok.
                </p>
              ) : (
                <ul className="space-y-2">
                  {pastLoans.map((loan) => (
                    <li
                      key={loan.id}
                      className="px-4 py-3 rounded-xl bg-kt-gray-50 border border-kt-gray-200 flex flex-col sm:flex-row sm:items-center gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-kt-green-900 truncate">
                            {loan.bookTitle}
                          </span>
                          <LoanStatusBadge status={loan.status} />
                        </div>
                        <div className="text-xs text-kt-gray-500 mt-0.5 truncate">
                          {loan.bookAuthor}
                        </div>
                      </div>
                      <div className="text-xs text-kt-gray-500 shrink-0">
                        {loan.status === 'rejected'
                          ? loan.reviewedAt
                            ? `Reddedildi: ${fmtDate(loan.reviewedAt)}`
                            : 'Reddedildi'
                          : loan.returnedAt
                            ? `İade: ${fmtDate(loan.returnedAt)}`
                            : '—'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
