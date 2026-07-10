/**
 * Bekleme listesi API'si — kullanıcı waitlist katılım/çıkış ve admin
 * sıralama metotları.
 */
import type { JoinWaitlistPayload, WaitlistEntry } from '../../types';
import { request, staffKind } from './core';

export const waitlistApi = {
  async listUserWaitlist() {
    return request<{ entries: WaitlistEntry[] }>('/user/waitlist', { kind: 'user' });
  },

  async joinWaitlist(payload: JoinWaitlistPayload) {
    return request<{ entry: WaitlistEntry }>('/user/waitlist', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async removeWaitlistEntry(id: string) {
    return request<{ removed: boolean }>(`/user/waitlist/${encodeURIComponent(id)}/remove`, {
      method: 'DELETE',
      kind: 'user',
    });
  },

  async cancelWaitlist(id: string) {
    return request<{ cancelled: boolean }>(`/user/waitlist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: 'user',
    });
  },

  async adminListWaitlist() {
    return request<{ entries: WaitlistEntry[] }>('/admin/waitlist', { kind: staffKind() });
  },

  /** Admin: waitlist sırası değiştirme (öncelik verme). */
  async adminMoveWaitlist(id: string, move: 'up' | 'down' | 'top') {
    return request<{ entries: WaitlistEntry[] }>(
      `/admin/waitlist/${encodeURIComponent(id)}/move`,
      { method: 'POST', body: { move }, kind: staffKind() }
    );
  },
};
