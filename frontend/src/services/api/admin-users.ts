/**
 * Admin kullanıcı yönetimi API'si — kullanıcı arama/güncelleme/silme/geri
 * yükleme ve departman meta ucu.
 */
import type {
  AdminUserSearchFilters,
  AdminUserUpdatePayload,
  UserGovernanceRole,
  UserListItem,
  UserProfile,
} from '../../types';
import { request, staffKind } from './core';

export const adminUsersApi = {
  async adminListUsers(filters: AdminUserSearchFilters = {}) {
    const qs = new URLSearchParams();
    if (filters.q) qs.set('q', filters.q);
    if (filters.status) qs.set('status', filters.status);
    if (filters.department) qs.set('department', filters.department);
    if (filters.hasBookings) qs.set('hasBookings', filters.hasBookings);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ users: UserListItem[] }>(`/admin/users${query}`, { kind: staffKind() });
  },

  async adminListDepartments() {
    return request<{ departments: string[] }>('/admin/users/meta/departments', {
      kind: staffKind(),
    });
  },

  async adminUpdateUser(id: string, payload: AdminUserUpdatePayload) {
    return request<{ user: UserProfile }>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
      kind: staffKind(),
    });
  },

  /** Yönetişim rolü ata/kaldır (null = normal kullanıcı). Kullanıcının oturumları düşer. */
  async adminSetGovernanceRole(id: string, governanceRole: UserGovernanceRole | null) {
    return request<{ user: UserProfile }>(
      `/admin/users/${encodeURIComponent(id)}/governance-role`,
      { method: 'PUT', body: { governanceRole }, kind: staffKind() }
    );
  },

  async adminDeleteUser(id: string) {
    return request<{ deleted: boolean }>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      kind: staffKind(),
    });
  },

  async adminRestoreUser(id: string) {
    return request<{ user: UserProfile }>(
      `/admin/users/${encodeURIComponent(id)}/restore`,
      { method: 'POST', kind: staffKind() }
    );
  },
};
