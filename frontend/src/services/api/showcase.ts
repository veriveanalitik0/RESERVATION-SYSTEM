/**
 * Vitrin & liderlik tablosu API'si — showcase feed, beğeni/yorum ve
 * leaderboard metotları.
 */
import type {
  Leaderboard,
  LikeStatus,
  ShowcaseComment,
  ShowcaseEngagement,
  ShowcaseItem,
  SubjectKind,
} from '../../types';
import { request } from './core';

export const showcaseApi = {
  /* ============ SHOWCASE LIKES & COMMENTS ============ */

  // Okuma — rol-bağımsız (/api/showcase). Aktif oturumun kind'ı geçilir; admin
  // dahil her rol beğeni/yorum GÖREBİLİR (envanterde "giriş yap" sorunu çözümü).
  async getLikeStatus(bookingId: string, kind: SubjectKind = 'user') {
    return request<LikeStatus>(`/showcase/${encodeURIComponent(bookingId)}/likes`, {
      kind,
    });
  },

  async toggleLike(bookingId: string) {
    return request<LikeStatus>(`/user/showcase/${encodeURIComponent(bookingId)}/like`, {
      method: 'POST',
      kind: 'user',
    });
  },

  async listComments(bookingId: string, kind: SubjectKind = 'user') {
    return request<{ comments: ShowcaseComment[] }>(
      `/showcase/${encodeURIComponent(bookingId)}/comments`,
      { kind }
    );
  },

  async postComment(bookingId: string, body: string) {
    return request<{ comment: ShowcaseComment }>(
      `/user/showcase/${encodeURIComponent(bookingId)}/comments`,
      { method: 'POST', body: { body }, kind: 'user' }
    );
  },

  async deleteComment(commentId: string) {
    return request<{ deleted: boolean }>(
      `/user/showcase/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE', kind: 'user' }
    );
  },

  /* ============ LEADERBOARD ============ */

  /** Sıralama: kullanıcı (oda kullanımı + etkileşim) + proje (beğeni/yorum). */
  async leaderboard() {
    return request<Leaderboard>('/user/leaderboard', { kind: 'user' });
  },

  /* ============ PUBLIC ============ */

  /**
   * Showcase FEED — tek çağrıda items + technologies + engagement (#3).
   * Eski 3 ayrı isteğin (showcase/technologies/engagement) yerini almıştı;
   * o üç metot ölü kod olarak kaldırıldı (backend uçları public olarak duruyor).
   */
  async showcaseFeed() {
    return request<{
      items: ShowcaseItem[];
      total: number;
      technologies: Array<{ technology: string; count: number }>;
      engagement: ShowcaseEngagement;
      generatedAt: string;
    }>('/public/showcase/feed', { kind: 'user', auth: false, noAuth: true });
  },
};
