/**
 * Profil API'si — kullanıcı profili görüntüleme/güncelleme, profil fotoğrafı
 * ve public profil uçları.
 */
import type { ProfileUpdatePayload, PublicProfile, UserProfile } from '../../types';
import { request } from './core';

export const profileApi = {
  async getProfile() {
    return request<{ profile: UserProfile }>('/user/profile', { kind: 'user' });
  },

  async updateProfile(payload: ProfileUpdatePayload) {
    return request<{ profile: UserProfile }>('/user/profile', {
      method: 'PUT',
      body: payload,
      kind: 'user',
    });
  },

  /* ============ PROFİL FOTOĞRAFI ============ */

  async setMyPhoto(dataUrl: string) {
    return request<{ ok: boolean }>('/user/me/photo', {
      method: 'PUT',
      body: { dataUrl },
      kind: 'user',
    });
  },

  async clearMyPhoto() {
    return request<{ ok: boolean }>('/user/me/photo', {
      method: 'DELETE',
      kind: 'user',
    });
  },

  /* ============ PUBLIC PROFİL ============ */

  async getPublicProfile(userId: string) {
    return request<{ profile: PublicProfile }>(
      `/public/users/${encodeURIComponent(userId)}`,
      { kind: 'user', auth: false, noAuth: true }
    );
  },
};
