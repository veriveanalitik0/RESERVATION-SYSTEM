import type { BookingStatus } from '../types';

interface StatusBadgeProps {
  status: BookingStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config: Record<BookingStatus, { label: string; className: string }> = {
    pending: { label: '⏳ Beklemede', className: 'badge-pending' },
    approved: { label: '✓ Onaylandı', className: 'badge-approved' },
    rejected: { label: '✕ Reddedildi', className: 'badge-rejected' },
    feedback_requested: { label: '💬 Düzeltme İstendi', className: 'badge-feedback' },
    cancelled: { label: '⊘ İptal Edildi', className: 'badge-rejected' },
  };
  const c = config[status];
  return <span className={c.className}>{c.label}</span>;
}
