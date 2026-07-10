/**
 * Admin analitik API'si — dashboard istatistikleri ve analitik rapor uçları.
 */
import type { AdminStats, AnalyticsResponse } from '../../types';
import { request, staffKind } from './core';

export const adminAnalyticsApi = {
  async adminStats() {
    return request<{ stats: AdminStats }>('/admin/stats', { kind: staffKind() });
  },

  async adminAnalytics() {
    return request<AnalyticsResponse>('/admin/analytics', { kind: staffKind() });
  },
};
