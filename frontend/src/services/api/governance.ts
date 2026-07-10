/**
 * Yönetişim API'si — danışman/ar-ge rolleri ve admin yaşam döngüsü
 * (lifecycle, gate, approval) metotları.
 */
import type {
  ApprovalType,
  Booking,
  GateKey,
  GateStatus,
  GovernanceAdmin,
  GovernanceBundle,
  GovernanceDashboard,
  HumanApproval,
  LicenseRequest,
  LicenseRequestWithUser,
  QualityGate,
} from '../../types';
import { request, staffKind } from './core';

export const governanceApi = {
  /* ============ YÖNETIŞIM — DANIŞMAN ============ */

  async danismanInbox() {
    return request<{
      licenseRequests: LicenseRequestWithUser[];
      bookings: Booking[];
      counts: { licenseRequestsPending: number; bookingsPending: number };
    }>('/governance/danisman/inbox', { kind: 'danisman' });
  },

  async danismanReviewLicense(
    licenseId: string,
    payload: { action: 'approve' | 'reject' | 'request_feedback' | 'swat'; feedback?: string }
  ) {
    return request<{ request: LicenseRequest }>(
      `/governance/danisman/license-requests/${encodeURIComponent(licenseId)}/review`,
      { method: 'POST', body: payload, kind: 'danisman' }
    );
  },

  /* ============ YÖNETIŞIM — AR-GE ============ */

  async argeProjects() {
    return request<{
      projects: Booking[];
      counts: {
        total: number;
        withAdvanceRequest: number;
        inStage: number;
        inProduction: number;
      };
    }>('/governance/arge/projects', { kind: 'arge' });
  },

  async argeAdvanceStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/governance/arge/bookings/${encodeURIComponent(bookingId)}/advance-stage`,
      { method: 'POST', kind: 'arge' }
    );
  },

  async argeRegressStage(bookingId: string) {
    return request<{ booking: Booking }>(
      `/governance/arge/bookings/${encodeURIComponent(bookingId)}/regress-stage`,
      { method: 'POST', kind: 'arge' }
    );
  },

  async argeRejectAdvanceRequest(bookingId: string) {
    return request<{ booking: Booking }>(
      `/governance/arge/bookings/${encodeURIComponent(bookingId)}/advance-request`,
      { method: 'DELETE', kind: 'arge' }
    );
  },

  /* ============ YÖNETİŞİM ============ */

  async adminLicenseRequestDetail(requestId: string) {
    return request<GovernanceBundle>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}`,
      { kind: staffKind() }
    );
  },

  async adminGovernanceDashboard() {
    return request<GovernanceDashboard>('/admin/licenses/governance/dashboard', {
      kind: staffKind(),
    });
  },

  async adminGovernanceAdmins() {
    return request<{ admins: GovernanceAdmin[] }>('/admin/governance/admins', {
      kind: staffKind(),
    });
  },

  async adminAdvanceLifecycle(requestId: string, note?: string | null) {
    return request<{ request: LicenseRequestWithUser; transition: { fromStage: string; toStage: string } }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/advance`,
      { method: 'POST', body: { note: note ?? null }, kind: staffKind() }
    );
  },

  async adminAssignEngineer(requestId: string, engineerId: string) {
    return request<{ request: LicenseRequestWithUser }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/assign-engineer`,
      { method: 'POST', body: { engineerId }, kind: staffKind() }
    );
  },

  async adminUpgradeProjectType(requestId: string) {
    return request<{ request: LicenseRequestWithUser }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/upgrade-type`,
      { method: 'POST', kind: staffKind() }
    );
  },

  async adminSetGateResult(
    requestId: string,
    payload: {
      gateKey: GateKey;
      status: GateStatus;
      score?: number | null;
      detail?: string | null;
    }
  ) {
    return request<{ gate: QualityGate }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/gates`,
      { method: 'PUT', body: payload, kind: staffKind() }
    );
  },

  async adminDecideApproval(
    requestId: string,
    payload: {
      approvalType: ApprovalType;
      decision: 'approved' | 'rejected';
      releaseNote?: string | null;
      riskAssessment?: string | null;
    }
  ) {
    return request<{ request: LicenseRequestWithUser; approval: HumanApproval }>(
      `/admin/licenses/requests/${encodeURIComponent(requestId)}/approval`,
      { method: 'POST', body: payload, kind: staffKind() }
    );
  },
};
