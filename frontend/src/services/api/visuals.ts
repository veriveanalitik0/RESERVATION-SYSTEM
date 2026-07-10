/**
 * Görsel üretimi API'si — kullanıcı görsel oluşturma/yenileme/silme ve
 * vitrin/profil/sohbet arkaplanı atama metotları.
 */
import type { CreateVisualPayload, Visual } from '../../types';
import { request } from './core';

export const visualsApi = {
  async createVisual(payload: CreateVisualPayload) {
    return request<{ visual: Visual }>('/user/visuals', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async listMyVisuals() {
    return request<{ visuals: Visual[] }>('/user/visuals', { kind: 'user' });
  },

  async regenerateVisual(id: string) {
    return request<{ visual: Visual }>(`/user/visuals/${id}/regenerate`, {
      method: 'POST',
      kind: 'user',
    });
  },

  async deleteVisual(id: string) {
    return request<{ deleted: true }>(`/user/visuals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: 'user',
    });
  },

  async setShowcaseImage(bookingId: string, visualId: string | null) {
    return request<{ showcaseImageUrl: string | null }>(
      `/user/bookings/${bookingId}/showcase-image`,
      { method: 'PUT', body: { visualId }, kind: 'user' }
    );
  },

  async setProfileBackground(visualId: string | null) {
    return request<{ profileBackgroundUrl: string | null }>(
      '/user/profile/background',
      { method: 'PUT', body: { visualId }, kind: 'user' }
    );
  },

  async setChatBackground(visualId: string | null) {
    return request<{ chatBackgroundUrl: string | null }>(
      '/user/chat/background',
      { method: 'PUT', body: { visualId }, kind: 'user' }
    );
  },
};
