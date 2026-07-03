/**
 * Kütüphane (book) servisi — envanter CRUD + ödünç onay akışı + süre uzatma + overdue.
 *
 * Akış: borrow → 'pending' (kopya rezerve) → admin approve → 'active' (süre başlar)
 *       / admin reject → 'rejected' (kopya geri). return → 'returned'. Uzatma talebi
 *       → admin approve (due_at uzar) / reject.
 */
import './setup-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { initSchema, closeDb, dbRun } from '../src/db/schema';
import {
  createBook,
  updateBook,
  deleteBook,
  getBookByIdAdmin,
  listAvailableBooks,
  listMyLoans,
  borrowBook,
  returnBook,
  requestExtension,
  approveLoan,
  rejectLoan,
  approveExtension,
  rejectExtension,
  markOverdueLoans,
  listAllLoans,
} from '../src/services/book.service';

const ADMIN = nanoid();
const USER1 = nanoid();
const USER2 = nanoid();

async function makeUser(id: string): Promise<void> {
  const hash = await argon2.hash('Demo1234!Pass', { type: argon2.argon2id });
  await dbRun(
    `INSERT OR IGNORE INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)`,
    [id, `book-${nanoid(6)}@test.local`, hash, 'Book Tester']
  );
}

beforeAll(async () => {
  await initSchema();
  await makeUser(USER1);
  await makeUser(USER2);
});

afterAll(async () => {
  await closeDb();
});

describe('book.service — envanter', () => {
  it('createBook: available = total ve aktif', async () => {
    const book = await createBook(ADMIN, { title: 'TS Elkitabı', author: 'A. Yazar', totalCopies: 3 });
    expect(book.availableCopies).toBe(3);
    expect(book.totalCopies).toBe(3);
    expect(book.isActive).toBe(true);
  });

  it('listAvailableBooks: pasif kitabı göstermez', async () => {
    const passive = await createBook(ADMIN, { title: 'Pasif Kitap', author: 'X', totalCopies: 1 });
    await updateBook(ADMIN, passive.id, { isActive: false });
    const books = await listAvailableBooks(USER1);
    expect(books.find((b) => b.id === passive.id)).toBeUndefined();
  });

  it('updateBook: totalCopies artışı available_copies\'i delta kadar kaydırır', async () => {
    const book = await createBook(ADMIN, { title: 'Genişleyen', author: 'Y', totalCopies: 2 });
    const updated = await updateBook(ADMIN, book.id, { totalCopies: 5 });
    expect(updated.totalCopies).toBe(5);
    expect(updated.availableCopies).toBe(5);
  });
});

describe('book.service — ödünç onay akışı', () => {
  it('borrowBook: pending oluşur, kopya rezerve edilir, borrowedByMe set olur', async () => {
    const book = await createBook(ADMIN, { title: 'Ödünç Kitap', author: 'Z', totalCopies: 2 });
    const loan = await borrowBook(USER1, book.id, 14);
    expect(loan.status).toBe('pending');
    expect(loan.periodDays).toBe(14);

    const after = await getBookByIdAdmin(book.id);
    expect(after?.availableCopies).toBe(1); // rezerve

    const visible = await listAvailableBooks(USER1);
    expect(visible.find((b) => b.id === book.id)?.borrowedByMe).toBe(true);

    const mine = await listMyLoans(USER1);
    expect(mine.find((l) => l.id === loan.id)?.status).toBe('pending');
  });

  it('borrowBook: aynı kullanıcı aynı kitaba ikinci kez talep açamaz', async () => {
    const book = await createBook(ADMIN, { title: 'Tek Talep', author: 'Z', totalCopies: 2 });
    await borrowBook(USER1, book.id, 14);
    await expect(borrowBook(USER1, book.id, 14)).rejects.toMatchObject({ code: 'ALREADY_BORROWED' });
  });

  it('borrowBook: pending rezervasyon son kopyayı tutar → diğer kullanıcı alamaz', async () => {
    const book = await createBook(ADMIN, { title: 'Son Kopya', author: 'Z', totalCopies: 1 });
    await borrowBook(USER1, book.id, 14); // available 1 -> 0 (rezerve)
    await expect(borrowBook(USER2, book.id, 14)).rejects.toMatchObject({ code: 'BOOK_UNAVAILABLE' });
  });

  it('approveLoan: pending → active, süre onay anında başlar', async () => {
    const book = await createBook(ADMIN, { title: 'Onay Kitap', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    const approved = await approveLoan(ADMIN, loan.id);
    expect(approved.status).toBe('active');
    expect(approved.reviewedBy).toBe(ADMIN);
    expect(new Date(approved.dueAt).getTime()).toBeGreaterThan(new Date(approved.borrowedAt).getTime());
    expect((await getBookByIdAdmin(book.id))?.availableCopies).toBe(0);
  });

  it('approveLoan: pending olmayan kayıt onaylanamaz', async () => {
    const book = await createBook(ADMIN, { title: 'İki Onay', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    await approveLoan(ADMIN, loan.id);
    await expect(approveLoan(ADMIN, loan.id)).rejects.toMatchObject({ code: 'LOAN_NOT_PENDING' });
  });

  it('rejectLoan: pending → rejected, rezerve kopya geri verilir', async () => {
    const book = await createBook(ADMIN, { title: 'Red Kitap', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    expect((await getBookByIdAdmin(book.id))?.availableCopies).toBe(0);
    const rejected = await rejectLoan(ADMIN, loan.id);
    expect(rejected.status).toBe('rejected');
    expect((await getBookByIdAdmin(book.id))?.availableCopies).toBe(1);
  });

  it('returnBook: onaylı ödünç iade edilir, kopya geri kazanılır', async () => {
    const book = await createBook(ADMIN, { title: 'İade Kitap', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    await approveLoan(ADMIN, loan.id);
    const returned = await returnBook(USER1, loan.id);
    expect(returned.status).toBe('returned');
    expect(returned.returnedAt).not.toBeNull();
    expect((await getBookByIdAdmin(book.id))?.availableCopies).toBe(1);
  });

  it('returnBook: başkasının ödüncü iade edilemez (IDOR)', async () => {
    const book = await createBook(ADMIN, { title: 'IDOR Kitap', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    await approveLoan(ADMIN, loan.id);
    await expect(returnBook(USER2, loan.id)).rejects.toMatchObject({ code: 'LOAN_NOT_FOUND' });
  });

  it('returnBook: çift iade reddedilir', async () => {
    const book = await createBook(ADMIN, { title: 'Çift İade', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    await approveLoan(ADMIN, loan.id);
    await returnBook(USER1, loan.id);
    await expect(returnBook(USER1, loan.id)).rejects.toMatchObject({ code: 'ALREADY_RETURNED' });
  });
});

describe('book.service — süre uzatma', () => {
  it('requestExtension + approveExtension: due_at uzar, talep temizlenir', async () => {
    const book = await createBook(ADMIN, { title: 'Uzatma Kitap', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    const active = await approveLoan(ADMIN, loan.id);
    const dueBefore = new Date(active.dueAt).getTime();

    const requested = await requestExtension(USER1, loan.id, 7);
    expect(requested.extensionRequestedDays).toBe(7);
    expect(requested.extensionRequestedAt).not.toBeNull();

    const extended = await approveExtension(ADMIN, loan.id);
    expect(extended.extensionRequestedDays).toBeNull();
    expect(new Date(extended.dueAt).getTime()).toBeGreaterThan(dueBefore);
  });

  it('requestExtension: pending ödünçte istenemez', async () => {
    const book = await createBook(ADMIN, { title: 'Pending Uzatma', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    await expect(requestExtension(USER1, loan.id, 7)).rejects.toMatchObject({ code: 'NOT_EXTENDABLE' });
  });

  it('rejectExtension: talep temizlenir, due_at değişmez', async () => {
    const book = await createBook(ADMIN, { title: 'Uzatma Red', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    const active = await approveLoan(ADMIN, loan.id);
    const dueBefore = active.dueAt;
    await requestExtension(USER1, loan.id, 14);
    const rejected = await rejectExtension(ADMIN, loan.id);
    expect(rejected.extensionRequestedDays).toBeNull();
    expect(rejected.dueAt).toBe(dueBefore);
  });
});

describe('book.service — bakım & silme', () => {
  it('markOverdueLoans: süresi geçmiş aktif loan overdue olur', async () => {
    const book = await createBook(ADMIN, { title: 'Gecikmiş', author: 'Z', totalCopies: 1 });
    const loan = await borrowBook(USER1, book.id, 7);
    await approveLoan(ADMIN, loan.id);
    await dbRun(`UPDATE book_loans SET due_at = ? WHERE id = ?`, [
      new Date(Date.now() - 86400000).toISOString(),
      loan.id,
    ]);
    const n = await markOverdueLoans();
    expect(n).toBeGreaterThanOrEqual(1);
    const mine = await listMyLoans(USER1);
    expect(mine.find((l) => l.id === loan.id)?.status).toBe('overdue');
  });

  it('deleteBook: bekleyen/aktif ödüncü olan kitap silinemez', async () => {
    const book = await createBook(ADMIN, { title: 'Silinemez', author: 'Z', totalCopies: 1 });
    await borrowBook(USER1, book.id, 7); // pending
    await expect(deleteBook(ADMIN, book.id)).rejects.toMatchObject({ code: 'BOOK_HAS_ACTIVE_LOANS' });
  });

  it('deleteBook: ödüncü olmayan kitap silinir', async () => {
    const book = await createBook(ADMIN, { title: 'Silinebilir', author: 'Z', totalCopies: 1 });
    await deleteBook(ADMIN, book.id);
    expect(await getBookByIdAdmin(book.id)).toBeUndefined();
  });

  it('listAllLoans: pending filtresi yalnız bekleyenleri döner', async () => {
    const pendingLoans = await listAllLoans({ status: 'pending' });
    expect(Array.isArray(pendingLoans)).toBe(true);
    expect(pendingLoans.every((l) => l.status === 'pending')).toBe(true);
  });
});
