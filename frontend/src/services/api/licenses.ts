/**
 * Lisans API'si — kullanıcı lisans katalogu/talepleri ve admin lisans
 * raporları/talep incelemesi metotları.
 */
import type {
  GovernanceBundle,
  LicenseBudgetReport,
  LicenseReport,
  LicenseRequest,
  LicenseRequestStatus,
  LicenseRequestWithUser,
} from '../../types';
import { request, staffKind } from './core';

/**
 * createLicenseRequest / updateLicenseRequest ortak gövdesi.
 * Sadeleştirilmiş form yalnızca çekirdek alanları (ad/amaç/araç/süre) gönderir;
 * geri kalanlar opsiyoneldir (backend null/varsayılan yazar).
 */
export interface LicenseRequestPayload {
  requestTitle: string;
  reason: string;
  items: Array<{
    licenseKey: string;
    licenseName: string;
    vendor?: string | null;
    category?: string | null;
  }>;
  durationMonths: 1 | 3 | 6 | 12;
  expectedBenefit?: string;
  successCriteria?: string;
  projectType?: 'poc' | 'integration';
  estimatedDurationDays?: number | null;
  dataToUse?: string;
  technicalStack?: string | null;
  usesExternalApi?: boolean;
  involvesRealData?: boolean;
}

export const licensesApi = {
  async licenseCatalog() {
    return request<{
      items: Array<{
        key: string;
        name: string;
        vendor: string;
        category: string;
        tier: 'paid' | 'free' | 'enterprise';
        monthlyUsd: number;
      }>;
    }>('/user/licenses/catalog', { kind: 'user' });
  },

  async listMyLicenseRequests() {
    return request<{ items: LicenseRequest[] }>('/user/licenses/requests', { kind: 'user' });
  },

  async createLicenseRequest(payload: LicenseRequestPayload) {
    return request<{ request: LicenseRequest }>('/user/licenses/requests', {
      method: 'POST',
      body: payload,
      kind: 'user',
    });
  },

  async updateLicenseRequest(requestId: string, payload: LicenseRequestPayload) {
    return request<{ request: LicenseRequest }>(
      `/user/licenses/requests/${encodeURIComponent(requestId)}`,
      { method: 'PUT', body: payload, kind: 'user' }
    );
  },

  /** Kullanıcının kendi başvuru/proje detayı — yönetişim demeti dahil. */
  async userLicenseRequestDetail(requestId: string) {
    return request<GovernanceBundle>(
      `/user/licenses/requests/${encodeURIComponent(requestId)}`,
      { kind: 'user' }
    );
  },

  async adminLicenses() {
    return request<LicenseReport>('/admin/licenses', { kind: staffKind() });
  },

  async adminLicenseBudget() {
    return request<LicenseBudgetReport>('/admin/licenses/budget', { kind: staffKind() });
  },

  async adminListLicenseRequests(statusFilter?: LicenseRequestStatus) {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return request<{ items: LicenseRequestWithUser[] }>(
      `/admin/licenses/requests${qs}`,
      { kind: staffKind() }
    );
  },

  async adminReviewLicenseRequest(
    requestId: string,
    payload: {
      action: 'approve' | 'reject' | 'request_feedback' | 'swat';
      adminFeedback?: string | null;
    }
  ) {
    return request<{ request: LicenseRequestWithUser }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/review`,
      { method: 'POST', body: payload, kind: staffKind() }
    );
  },
};
