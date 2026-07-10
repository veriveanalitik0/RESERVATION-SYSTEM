/**
 * Donanım & destek API'si — kullanıcı donanım/destek talepleri ve admin
 * inceleme/çözümleme metotları.
 */
import type {
  CreateHardwareRequestPayload,
  HardwareRequest,
  HardwareRequestStatus,
  HardwareRequestWithUser,
  SubjectKind,
  SupportRequest,
  SupportRequestStatus,
  SupportRequestWithUser,
} from '../../types';
import { request, staffKind } from './core';

export const hardwareSupportApi = {
  /* ============ DONANIM TALEPLERİ ============ */

  async listMyHardwareRequests() {
    return request<{ items: HardwareRequest[] }>('/user/hardware/requests', {
      kind: 'user',
    });
  },

  async createHardwareRequest(payload: CreateHardwareRequestPayload) {
    return request<{ request: HardwareRequest }>('/user/hardware/requests', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async updateHardwareRequest(id: string, payload: CreateHardwareRequestPayload) {
    return request<{ request: HardwareRequest }>(
      `/user/hardware/requests/${encodeURIComponent(id)}`,
      { method: 'PUT', body: payload, kind: 'user' }
    );
  },

  async adminListHardwareRequests(statusFilter?: HardwareRequestStatus) {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return request<{ items: HardwareRequestWithUser[] }>(
      `/admin/hardware/requests${qs}`,
      { kind: staffKind() }
    );
  },

  async adminReviewHardwareRequest(
    id: string,
    payload: {
      action: 'approve' | 'reject' | 'request_feedback';
      adminFeedback?: string | null;
    }
  ) {
    return request<{ request: HardwareRequestWithUser }>(
      `/admin/hardware/requests/${encodeURIComponent(id)}/review`,
      { method: 'POST', body: payload, kind: staffKind() }
    );
  },

  /* ============ DESTEK TALEPLERİ ============ */

  async createSupportRequest(description: string, kind: SubjectKind = 'user') {
    const path =
      kind === 'danisman' || kind === 'arge'
        ? `/governance/${kind}/support/requests`
        : '/user/support/requests';
    return request<{ request: SupportRequest }>(path, {
      method: 'POST',
      body: { description },
      kind,
    });
  },

  async adminListSupportRequests(statusFilter?: SupportRequestStatus) {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return request<{ items: SupportRequestWithUser[] }>(
      `/admin/support/requests${qs}`,
      { kind: staffKind() }
    );
  },

  async adminResolveSupportRequest(id: string) {
    return request<{ request: SupportRequestWithUser }>(
      `/admin/support/requests/${encodeURIComponent(id)}/resolve`,
      { method: 'POST', kind: staffKind() }
    );
  },
};
