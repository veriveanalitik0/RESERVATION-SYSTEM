/**
 * Kütüphane API'si — kitap listeleme/ödünç alma, süre uzatma ve admin
 * kitap/ödünç yönetimi metotları.
 */
import type { Book, BookLoan } from '../../types';
import { request, staffKind } from './core';

export const libraryApi = {
  // Kullanıcı
  async listBooks() {
    return request<{ books: Book[] }>('/user/books', { kind: 'user' });
  },
  async borrowBook(bookId: string, periodDays?: 7 | 14 | 30) {
    return request<{ loan: BookLoan }>(
      `/user/books/${encodeURIComponent(bookId)}/borrow`,
      { method: 'POST', body: periodDays ? { periodDays } : {}, kind: 'user' }
    );
  },
  async listMyLoans() {
    return request<{ loans: BookLoan[] }>('/user/loans', { kind: 'user' });
  },
  async returnLoan(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/user/loans/${encodeURIComponent(loanId)}/return`,
      { method: 'POST', kind: 'user' }
    );
  },

  // Admin (GET'ler staff-okunur, mutasyonlar admin)
  async adminListBooks() {
    return request<{ books: Book[] }>('/admin/books', { kind: staffKind() });
  },
  async adminCreateBook(payload: {
    title: string;
    author: string;
    isbn?: string;
    category?: string;
    description?: string;
    coverImageUrl?: string;
    totalCopies: number;
  }) {
    return request<{ book: Book }>('/admin/books', {
      method: 'POST',
      body: payload,
      kind: 'admin',
    });
  },
  async adminUpdateBook(
    id: string,
    payload: Partial<{
      title: string;
      author: string;
      isbn: string;
      category: string;
      description: string;
      coverImageUrl: string;
      totalCopies: number;
      isActive: boolean;
    }>
  ) {
    return request<{ book: Book }>(`/admin/books/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
      kind: 'admin',
    });
  },
  async adminDeleteBook(id: string) {
    return request<{ deleted: boolean }>(`/admin/books/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: 'admin',
    });
  },
  async adminListLoans(statusFilter?: 'pending' | 'active' | 'returned' | 'overdue' | 'rejected') {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return request<{ loans: BookLoan[] }>(`/admin/loans${qs}`, { kind: staffKind() });
  },

  // Kullanıcı: aktif/gecikmiş ödünç için süre uzatma talebi.
  async requestExtension(loanId: string, days: 7 | 14 | 30) {
    return request<{ loan: BookLoan }>(
      `/user/loans/${encodeURIComponent(loanId)}/extend`,
      { method: 'POST', body: { days }, kind: 'user' }
    );
  },

  // Admin: bekleyen ödünç onay/red + süre-uzatma onay/red.
  async adminApproveLoan(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/admin/loans/${encodeURIComponent(loanId)}/approve`,
      { method: 'POST', kind: 'admin' }
    );
  },
  async adminRejectLoan(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/admin/loans/${encodeURIComponent(loanId)}/reject`,
      { method: 'POST', kind: 'admin' }
    );
  },
  async adminApproveExtension(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/admin/loans/${encodeURIComponent(loanId)}/extend/approve`,
      { method: 'POST', kind: 'admin' }
    );
  },
  async adminRejectExtension(loanId: string) {
    return request<{ loan: BookLoan }>(
      `/admin/loans/${encodeURIComponent(loanId)}/extend/reject`,
      { method: 'POST', kind: 'admin' }
    );
  },
};
