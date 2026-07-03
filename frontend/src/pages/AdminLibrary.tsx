/**
 * Kütüphane — admin sayfası (/admin/kutuphane).
 *
 * İki sekme:
 *   - "Kitaplar"  — kitap CRUD tablosu (ekle/düzenle modal, sil ConfirmDialog).
 *   - "Ödünçler"  — tüm ödünç kayıtları + durum filtresi (tümü/aktif/iade/gecikmiş).
 *
 * Mutasyonlar yalnız admin'e açık (canEdit = viewerKind === 'admin'); danışman /
 * Ar-Ge / izleyici salt-okunur görüntüler — ekle/düzenle/sil butonları gizlenir.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppShell } from '../components/AppShell';
import { useViewerKind } from '../hooks/useViewerKind';
import { useToast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api } from '../services/api';
import { categoryRank, OTHER_CATEGORY } from '../constants/library';
import type { Book, BookLoan } from '../types';

type Tab = 'books' | 'loans';
type LoanFilter = 'all' | 'pending' | 'active' | 'overdue' | 'returned' | 'rejected';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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

/** Kitap form durumu — ekle (book=null) ve düzenle (book) ortak. */
interface BookForm {
  title: string;
  author: string;
  isbn: string;
  category: string;
  description: string;
  coverImageUrl: string;
  totalCopies: string; // input string → submit'te number'a çevrilir
  isActive: boolean;
}

const EMPTY_FORM: BookForm = {
  title: '',
  author: '',
  isbn: '',
  category: '',
  description: '',
  coverImageUrl: '',
  totalCopies: '1',
  isActive: true,
};

const LOAN_FILTERS: Array<{ key: LoanFilter; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'pending', label: 'Onay Bekleyen' },
  { key: 'active', label: 'Aktif' },
  { key: 'overdue', label: 'Gecikmiş' },
  { key: 'returned', label: 'İade Edildi' },
  { key: 'rejected', label: 'Reddedildi' },
];

export default function AdminLibrary() {
  const toast = useToast();
  const viewerKind = useViewerKind();
  const canEdit = viewerKind === 'admin';

  const [tab, setTab] = useState<Tab>('books');

  // --- Kitaplar ---
  const [books, setBooks] = useState<Book[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  // Kitaplar sekmesi: kategori filtresi ('all' = tümü) + metin araması.
  const [bookCat, setBookCat] = useState<string>('all');
  const [bookSearch, setBookSearch] = useState('');

  // Ekle / düzenle modalı. editing === null && modalOpen → yeni kitap.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const [form, setForm] = useState<BookForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Silme onayı.
  const [delTarget, setDelTarget] = useState<Book | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Ödünçler ---
  const [loans, setLoans] = useState<BookLoan[]>([]);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [loanFilter, setLoanFilter] = useState<LoanFilter>('all');
  // O an onay/red/uzatma işlemi yürüyen ödünç kaydı (buton disable).
  const [busyLoan, setBusyLoan] = useState<string | null>(null);
  // Bekleyen ödünç talebi sayısı (sekme rozeti) — filtreden bağımsız tutulur.
  const [pendingCount, setPendingCount] = useState(0);

  const loadBooks = useCallback(async () => {
    setLoadingBooks(true);
    try {
      const res = await api.adminListBooks();
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
      const res = await api.adminListLoans(loanFilter === 'all' ? undefined : loanFilter);
      setLoans(res.loans);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Ödünç kayıtları yüklenemedi.');
    } finally {
      setLoadingLoans(false);
    }
  }, [toast, loanFilter]);

  // Bekleyen talep sayısı — sekme rozeti için filtreden bağımsız çekilir.
  const loadPendingCount = useCallback(async () => {
    try {
      const res = await api.adminListLoans('pending');
      setPendingCount(res.loans.length);
    } catch {
      // Rozet bilgilendiricidir; hatada sessizce geç.
    }
  }, []);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    void loadLoans();
  }, [loadLoans]);

  useEffect(() => {
    void loadPendingCount();
  }, [loadPendingCount]);

  // Onay/red/uzatma işleminden sonra liste + rozeti birlikte tazele.
  const refreshLoans = useCallback(async () => {
    await Promise.all([loadLoans(), loadPendingCount()]);
  }, [loadLoans, loadPendingCount]);

  async function handleApproveLoan(loan: BookLoan) {
    if (busyLoan) return;
    setBusyLoan(loan.id);
    try {
      await api.adminApproveLoan(loan.id);
      toast.push('success', `"${loan.bookTitle}" ödünç talebi onaylandı.`);
      await refreshLoans();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Ödünç talebi onaylanamadı.');
    } finally {
      setBusyLoan(null);
    }
  }

  async function handleRejectLoan(loan: BookLoan) {
    if (busyLoan) return;
    setBusyLoan(loan.id);
    try {
      await api.adminRejectLoan(loan.id);
      toast.push('success', `"${loan.bookTitle}" ödünç talebi reddedildi.`);
      await refreshLoans();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Ödünç talebi reddedilemedi.');
    } finally {
      setBusyLoan(null);
    }
  }

  async function handleApproveExtension(loan: BookLoan) {
    if (busyLoan) return;
    setBusyLoan(loan.id);
    try {
      await api.adminApproveExtension(loan.id);
      toast.push('success', `"${loan.bookTitle}" süre uzatma talebi onaylandı.`);
      await refreshLoans();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Süre uzatma onaylanamadı.');
    } finally {
      setBusyLoan(null);
    }
  }

  async function handleRejectExtension(loan: BookLoan) {
    if (busyLoan) return;
    setBusyLoan(loan.id);
    try {
      await api.adminRejectExtension(loan.id);
      toast.push('success', `"${loan.bookTitle}" süre uzatma talebi reddedildi.`);
      await refreshLoans();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Süre uzatma reddedilemedi.');
    } finally {
      setBusyLoan(null);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(book: Book) {
    setEditing(book);
    setForm({
      title: book.title,
      author: book.author,
      isbn: book.isbn ?? '',
      category: book.category ?? '',
      description: book.description ?? '',
      coverImageUrl: book.coverImageUrl ?? '',
      totalCopies: String(book.totalCopies),
      isActive: book.isActive,
    });
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
  }

  async function submitBook() {
    if (saving) return;
    const title = form.title.trim();
    const author = form.author.trim();
    const totalCopies = Number(form.totalCopies);
    if (!title || !author) {
      toast.push('error', 'Başlık ve yazar zorunludur.');
      return;
    }
    if (!Number.isFinite(totalCopies) || totalCopies < 1) {
      toast.push('error', 'Toplam kopya en az 1 olmalıdır.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await api.adminUpdateBook(editing.id, {
          title,
          author,
          isbn: form.isbn.trim(),
          category: form.category.trim(),
          description: form.description.trim(),
          coverImageUrl: form.coverImageUrl.trim(),
          totalCopies,
          isActive: form.isActive,
        });
        toast.push('success', 'Kitap güncellendi.');
      } else {
        await api.adminCreateBook({
          title,
          author,
          isbn: form.isbn.trim() || undefined,
          category: form.category.trim() || undefined,
          description: form.description.trim() || undefined,
          coverImageUrl: form.coverImageUrl.trim() || undefined,
          totalCopies,
        });
        toast.push('success', 'Kitap eklendi.');
      }
      setModalOpen(false);
      setEditing(null);
      await loadBooks();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Kitap kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!delTarget || deleting) return;
    setDeleting(true);
    try {
      await api.adminDeleteBook(delTarget.id);
      toast.push('success', 'Kitap silindi.');
      setDelTarget(null);
      await loadBooks();
    } catch (err) {
      // Aktif ödünç varsa backend 409 döner → hatayı toast'la göster.
      toast.push('error', (err as Error).message || 'Kitap silinemedi.');
    } finally {
      setDeleting(false);
    }
  }

  const totals = useMemo(
    () => ({
      books: books.length,
      active: books.filter((b) => b.isActive).length,
      onLoan: books.reduce((s, b) => s + (b.activeLoanCount ?? 0), 0),
    }),
    [books]
  );

  // Kategori seçenekleri — kitaplardan türetilir, sabit pedagojik sıra + bilinmeyenler sona.
  const bookCategories = useMemo(() => {
    const set = new Set<string>();
    for (const b of books) set.add(b.category?.trim() || OTHER_CATEGORY);
    return [...set].sort(
      (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'tr')
    );
  }, [books]);

  // Filtre + arama uygulanmış, kategoriye göre (sonra başlığa göre) sıralı tablo satırları.
  const visibleBooks = useMemo(() => {
    const q = bookSearch.trim().toLowerCase();
    return books
      .filter((b) => {
        const cat = b.category?.trim() || OTHER_CATEGORY;
        if (bookCat !== 'all' && cat !== bookCat) return false;
        if (!q) return true;
        return (
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          cat.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ca = a.category?.trim() || OTHER_CATEGORY;
        const cb = b.category?.trim() || OTHER_CATEGORY;
        return (
          categoryRank(ca) - categoryRank(cb) ||
          ca.localeCompare(cb, 'tr') ||
          a.title.localeCompare(b.title, 'tr')
        );
      });
  }, [books, bookCat, bookSearch]);

  return (
    <AppShell kind={viewerKind}>
      {!canEdit && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Görüntüleme modu — bu sayfada değişiklik yapamazsınız.
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Kütüphane</h1>
        <p className="text-kt-gray-500 text-sm">
          Kitap envanterini yönetin ve ödünç kayıtlarını izleyin.
        </p>
      </div>

      {/* Sekmeler */}
      <div className="flex gap-2 mb-5" role="tablist" aria-label="Kütüphane bölümleri">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'books'}
          onClick={() => setTab('books')}
          className={`px-4 py-2 rounded-xl font-semibold text-sm transition-all ${
            tab === 'books'
              ? 'bg-kt-green-800 text-white'
              : 'bg-white border border-kt-gray-200 text-kt-green-700 hover:border-kt-green-300'
          }`}
        >
          Kitaplar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'loans'}
          onClick={() => setTab('loans')}
          className={`px-4 py-2 rounded-xl font-semibold text-sm transition-all inline-flex items-center gap-2 ${
            tab === 'loans'
              ? 'bg-kt-green-800 text-white'
              : 'bg-white border border-kt-gray-200 text-kt-green-700 hover:border-kt-green-300'
          }`}
        >
          Ödünçler
          {pendingCount > 0 && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center ${
                tab === 'loans' ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}
              aria-label={`${pendingCount} bekleyen talep`}
            >
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* ============ SEKME: KİTAPLAR ============ */}
      {tab === 'books' && (
        <div>
          <div className="card p-4 md:p-5 mb-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
            <div className="flex gap-2 flex-wrap text-sm items-center">
              <span className="px-3 py-1.5 rounded-lg bg-kt-green-50 text-kt-green-800 font-semibold">
                {totals.books} kitap
              </span>
              <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 font-semibold">
                {totals.active} aktif
              </span>
              <span className="px-3 py-1.5 rounded-lg bg-kt-violet-100 text-kt-violet-700 font-semibold">
                {totals.onLoan} ödünçte
              </span>
              <select
                value={bookCat}
                onChange={(e) => setBookCat(e.target.value)}
                className="input py-1.5 text-sm w-auto"
                aria-label="Kategori filtresi"
              >
                <option value="all">Tüm kategoriler</option>
                {bookCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="search"
                className="input py-1.5 text-sm w-44"
                placeholder="Başlık / yazar ara..."
                value={bookSearch}
                onChange={(e) => setBookSearch(e.target.value)}
                maxLength={60}
                aria-label="Kitaplarda ara"
              />
            </div>
            {canEdit && (
              <button type="button" onClick={openCreate} className="btn-primary text-sm shrink-0">
                + Kitap Ekle
              </button>
            )}
          </div>

          {loadingBooks ? (
            <div className="card p-6 animate-pulse h-64" />
          ) : visibleBooks.length === 0 ? (
            <EmptyState
              icon="licenses"
              tone="cyan"
              title={books.length === 0 ? 'Henüz kitap yok' : 'Eşleşen kitap yok'}
              description={
                books.length === 0
                  ? canEdit
                    ? 'İlk kitabı eklemek için "Kitap Ekle"ye tıklayın.'
                    : 'Kütüphaneye kitap eklendiğinde burada listelenecek.'
                  : 'Kategori veya arama filtresini değiştirip tekrar deneyin.'
              }
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-kt-gray-200 text-left text-xs text-kt-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 font-semibold">Kitap</th>
                    <th className="px-4 py-3 font-semibold">Kategori</th>
                    <th className="px-4 py-3 font-semibold text-center">Müsait/Toplam</th>
                    <th className="px-4 py-3 font-semibold text-center">Ödünçte</th>
                    <th className="px-4 py-3 font-semibold text-center">Durum</th>
                    {canEdit && <th className="px-4 py-3 font-semibold text-right">İşlemler</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-kt-gray-100">
                  {visibleBooks.map((book) => (
                    <tr key={book.id} className="hover:bg-kt-gray-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-12 rounded-md overflow-hidden bg-kt-gray-100 shrink-0">
                            {book.coverImageUrl ? (
                              <img
                                src={book.coverImageUrl}
                                alt={`${book.title} kapağı`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-kt-green-700 to-kt-green-900" aria-hidden="true">
                                <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-kt-green-900 truncate">{book.title}</div>
                            <div className="text-xs text-kt-gray-500 truncate">{book.author}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {book.category ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-kt-violet-100 text-kt-violet-800 text-[11px] font-semibold border border-kt-violet-300">
                            {book.category}
                          </span>
                        ) : (
                          <span className="text-kt-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-kt-green-700">
                        {book.availableCopies}/{book.totalCopies}
                      </td>
                      <td className="px-4 py-3 text-center text-kt-gray-600">
                        {book.activeLoanCount ?? 0}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            book.isActive
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : 'bg-kt-gray-100 text-kt-gray-500 border-kt-gray-200'
                          }`}
                        >
                          {book.isActive ? 'Aktif' : 'Pasif'}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(book)}
                              className="text-[11px] font-semibold px-2 py-1 rounded-md text-kt-green-700 hover:bg-kt-green-50 transition"
                              aria-label={`${book.title} düzenle`}
                            >
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={() => setDelTarget(book)}
                              className="text-[11px] font-semibold px-2 py-1 rounded-md text-rose-700 hover:bg-rose-50 transition"
                              aria-label={`${book.title} sil`}
                            >
                              Sil
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============ SEKME: ÖDÜNÇLER ============ */}
      {tab === 'loans' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Ödünç durum filtresi">
            {LOAN_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setLoanFilter(f.key)}
                aria-pressed={loanFilter === f.key}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  loanFilter === f.key
                    ? 'bg-kt-violet-700 text-white border-kt-violet-700'
                    : 'bg-white border-kt-gray-200 text-kt-gray-600 hover:border-kt-violet-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loadingLoans ? (
            <div className="card p-6 animate-pulse h-64" />
          ) : loans.length === 0 ? (
            <EmptyState
              icon="bookings"
              tone="cyan"
              title="Ödünç kaydı yok"
              description="Seçili filtreye uyan ödünç kaydı bulunamadı."
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-kt-gray-200 text-left text-xs text-kt-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 font-semibold">Kullanıcı</th>
                    <th className="px-4 py-3 font-semibold">Kitap</th>
                    <th className="px-4 py-3 font-semibold">Ödünç</th>
                    <th className="px-4 py-3 font-semibold">Termin</th>
                    <th className="px-4 py-3 font-semibold">İade</th>
                    <th className="px-4 py-3 font-semibold text-center">Durum</th>
                    {canEdit && <th className="px-4 py-3 font-semibold text-right">İşlemler</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-kt-gray-100">
                  {loans.map((loan) => {
                    const overdue = loan.status === 'overdue';
                    const isPending = loan.status === 'pending';
                    const extPending = loan.extensionRequestedDays != null;
                    const busy = busyLoan === loan.id;
                    const hasActions = canEdit && (isPending || extPending);
                    return (
                      <tr
                        key={loan.id}
                        className={`transition-colors ${
                          overdue
                            ? 'bg-rose-50/50 hover:bg-rose-50'
                            : isPending
                              ? 'bg-amber-50/50 hover:bg-amber-50'
                              : 'hover:bg-kt-gray-50/60'
                        }`}
                      >
                        <td className="px-4 py-3 min-w-0">
                          <div className="font-semibold text-kt-green-900 truncate">
                            {loan.userFullName ?? '—'}
                          </div>
                          {loan.userEmail && (
                            <div className="text-xs text-kt-gray-500 truncate">{loan.userEmail}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 min-w-0">
                          <div className="font-medium text-kt-green-900 truncate">{loan.bookTitle}</div>
                          <div className="text-xs text-kt-gray-500 truncate">{loan.bookAuthor}</div>
                        </td>
                        <td className="px-4 py-3 text-kt-gray-600 whitespace-nowrap">
                          {fmtDate(loan.borrowedAt)}
                        </td>
                        <td
                          className={`px-4 py-3 whitespace-nowrap font-medium ${
                            overdue ? 'text-rose-700' : 'text-kt-gray-600'
                          }`}
                        >
                          {fmtDate(loan.dueAt)}
                        </td>
                        <td className="px-4 py-3 text-kt-gray-600 whitespace-nowrap">
                          {loan.returnedAt ? fmtDate(loan.returnedAt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <LoanStatusBadge status={loan.status} />
                            {extPending && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-amber-100 text-amber-800 border-amber-300 whitespace-nowrap">
                                Uzatma talebi: {loan.extensionRequestedDays} gün
                              </span>
                            )}
                          </div>
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3">
                            {hasActions ? (
                              <div className="flex flex-col items-end gap-1.5">
                                {isPending && (
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleApproveLoan(loan)}
                                      disabled={busy}
                                      className="text-[11px] font-semibold px-2 py-1 rounded-md text-emerald-700 hover:bg-emerald-50 transition disabled:opacity-50"
                                      aria-label={`${loan.bookTitle} ödünç talebini onayla`}
                                    >
                                      {busy ? '…' : 'Onayla'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRejectLoan(loan)}
                                      disabled={busy}
                                      className="text-[11px] font-semibold px-2 py-1 rounded-md text-rose-700 hover:bg-rose-50 transition disabled:opacity-50"
                                      aria-label={`${loan.bookTitle} ödünç talebini reddet`}
                                    >
                                      {busy ? '…' : 'Reddet'}
                                    </button>
                                  </div>
                                )}
                                {extPending && (
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleApproveExtension(loan)}
                                      disabled={busy}
                                      className="text-[11px] font-semibold px-2 py-1 rounded-md text-emerald-700 hover:bg-emerald-50 transition disabled:opacity-50"
                                      aria-label={`${loan.bookTitle} süre uzatma talebini onayla`}
                                    >
                                      {busy ? '…' : 'Uzatmayı Onayla'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRejectExtension(loan)}
                                      disabled={busy}
                                      className="text-[11px] font-semibold px-2 py-1 rounded-md text-rose-700 hover:bg-rose-50 transition disabled:opacity-50"
                                      aria-label={`${loan.bookTitle} süre uzatma talebini reddet`}
                                    >
                                      {busy ? '…' : 'Uzatmayı Reddet'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-right text-kt-gray-400">—</div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============ EKLE / DÜZENLE MODALI ============ */}
      {modalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-label={editing ? 'Kitap düzenle' : 'Kitap ekle'}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-slide-up flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-kt-green-900 mb-4 shrink-0">
              {editing ? 'Kitap Düzenle' : 'Kitap Ekle'}
            </h3>

            <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-3">
              <div>
                <label htmlFor="bf-title" className="label">Başlık *</label>
                <input
                  id="bf-title"
                  type="text"
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  disabled={saving}
                  maxLength={200}
                  required
                />
              </div>

              <div>
                <label htmlFor="bf-author" className="label">Yazar *</label>
                <input
                  id="bf-author"
                  type="text"
                  className="input"
                  value={form.author}
                  onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
                  disabled={saving}
                  maxLength={200}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="bf-isbn" className="label">ISBN</label>
                  <input
                    id="bf-isbn"
                    type="text"
                    className="input"
                    value={form.isbn}
                    onChange={(e) => setForm((f) => ({ ...f, isbn: e.target.value }))}
                    disabled={saving}
                    maxLength={32}
                  />
                </div>
                <div>
                  <label htmlFor="bf-category" className="label">Kategori</label>
                  <input
                    id="bf-category"
                    type="text"
                    className="input"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    disabled={saving}
                    maxLength={80}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="bf-cover" className="label">Kapak Görseli URL</label>
                <input
                  id="bf-cover"
                  type="url"
                  className="input"
                  placeholder="https://…"
                  value={form.coverImageUrl}
                  onChange={(e) => setForm((f) => ({ ...f, coverImageUrl: e.target.value }))}
                  disabled={saving}
                  maxLength={500}
                />
              </div>

              <div>
                <label htmlFor="bf-desc" className="label">Açıklama</label>
                <textarea
                  id="bf-desc"
                  className="input min-h-[80px] resize-y"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  disabled={saving}
                  maxLength={1000}
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="bf-copies" className="label">Toplam Kopya *</label>
                <input
                  id="bf-copies"
                  type="number"
                  min={1}
                  className="input"
                  value={form.totalCopies}
                  onChange={(e) => setForm((f) => ({ ...f, totalCopies: e.target.value }))}
                  disabled={saving}
                  required
                />
              </div>

              {/* isActive yalnız düzenlemede gösterilir (yeni kitap her zaman aktif). */}
              {editing && (
                <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    disabled={saving}
                    className="w-4 h-4 rounded border-kt-gray-300 text-kt-green-700 focus:ring-kt-green-500"
                  />
                  <span className="text-sm font-medium text-kt-green-800">
                    Aktif (kullanıcılara görünür)
                  </span>
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4 shrink-0">
              <button type="button" onClick={closeModal} disabled={saving} className="btn-ghost">
                İptal
              </button>
              <button type="button" onClick={submitBook} disabled={saving} className="btn-primary">
                {saving ? 'Kaydediliyor…' : editing ? 'Kaydet' : 'Ekle'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ============ SİLME ONAYI ============ */}
      <ConfirmDialog
        open={!!delTarget}
        title="Kitabı Sil"
        message={
          delTarget
            ? `"${delTarget.title}" kalıcı olarak silinecek. Aktif ödüncü olan kitaplar silinemez.`
            : ''
        }
        confirmLabel="Evet, Sil"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDelTarget(null)}
      />
    </AppShell>
  );
}
