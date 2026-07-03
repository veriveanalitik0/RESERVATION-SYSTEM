/**
 * Audit log servisi.
 * app_security.md §8: Auth denemeleri, yetki hataları, kritik işlemler loglanır.
 */
import { nanoid } from 'nanoid';
import { dbRun } from '../db/schema';
import { logger } from '../utils/logger';

export type AuditEventType =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.locked'
  | 'auth.refresh.success'
  | 'auth.refresh.failure'
  | 'auth.refresh.reuse_detected'
  | 'auth.logout'
  | 'auth.mfa.enroll'
  | 'auth.mfa.verify.success'
  | 'auth.mfa.verify.failure'
  | 'auth.mfa.disabled'
  | 'authz.denied'
  | 'validation.failure'
  | 'booking.created'
  | 'booking.updated'
  | 'booking.withdrawn'
  | 'booking.reviewed'
  | 'waitlist.joined'
  | 'waitlist.left'
  | 'waitlist.promoted'
  | 'waitlist.reordered'
  | 'booking.reassigned'
  | 'booking.user_reassigned'
  | 'booking.admin_deleted'
  | 'appointment.created'
  | 'appointment.cancelled'
  | 'admin.password_reset'
  | 'admin.password_changed'
  | 'user.update'
  | 'user.data_export'
  | 'user.delete'
  | 'user.restore'
  | 'user.photo_uploaded'
  | 'message.sent'
  | 'showcase.liked'
  | 'showcase.commented'
  | 'license_request.created'
  | 'license_request.updated'
  | 'license_request.reviewed'
  | 'hardware_request.created'
  | 'hardware_request.reviewed'
  | 'support_request.created'
  | 'support_request.resolved'
  | 'book.created'
  | 'book.updated'
  | 'book.deleted'
  | 'book.borrowed'
  | 'book.returned'
  | 'book.loan_approved'
  | 'book.loan_rejected'
  | 'book.extension_requested'
  | 'book.extension_approved'
  | 'book.extension_rejected'
  | 'book.loan_cancelled'
  | 'password_reset.requested'
  | 'password_reset.completed'
  | 'rate_limit.exceeded'
  | 'csrf.failure';

export type SubjectType = 'user' | 'admin' | 'danisman' | 'arge' | 'izleyici' | 'anonymous';

export interface AuditEvent {
  eventType: AuditEventType;
  subjectId?: string | null;
  subjectType?: SubjectType;
  ipAddress?: string | null;
  userAgent?: string | null;
  success: boolean;
  details?: Record<string, unknown>;
}

const SENSITIVE_DETAIL_KEYS = ['password', 'token', 'secret', 'authorization'];

function sanitizeDetails(details?: Record<string, unknown>): string | null {
  if (!details) return null;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_DETAIL_KEYS.some((s) => lower.includes(s))) {
      cleaned[key] = '[REDACTED]';
    } else {
      cleaned[key] = value;
    }
  }
  return JSON.stringify(cleaned);
}

// Yüksek hacimli denial event'leri için in-memory dedup: aynı (eventType +
// subject + ip) için 60sn'de tek kayıt. Tek bir oturumun retry fırtınası
// 380k özdeş 'authz.denied' üretip DB'yi şişirmesin; gerçek sinyal (kim/nerede/
// ne zaman) korunur, sadece tekrarlar elenir.
const DEDUP_EVENT_TYPES = new Set<string>(['authz.denied']);
const DEDUP_WINDOW_MS = 60_000;
const recentAuditKeys = new Map<string, number>();

function isThrottledAudit(event: AuditEvent): boolean {
  if (!DEDUP_EVENT_TYPES.has(event.eventType)) return false;
  const now = Date.now();
  const key = `${event.eventType}|${event.subjectId ?? ''}|${event.ipAddress ?? ''}`;
  if (now - (recentAuditKeys.get(key) ?? 0) < DEDUP_WINDOW_MS) return true;
  recentAuditKeys.set(key, now);
  if (recentAuditKeys.size > 5000) {
    for (const [k, t] of recentAuditKeys) {
      if (now - t > DEDUP_WINDOW_MS) recentAuditKeys.delete(k);
    }
  }
  return false;
}

/**
 * Audit kaydı — BİLİNÇLİ fire-and-forget: istek yanıtını bloklamaz, hatasını
 * içeride yutar (yalnız loglar). Bu yüzden `void` döner; çağıranların await
 * etmesi gerekmez (no-floating-promises bu sözleşmeyi görür).
 * Yazımın tamamlanmasını beklemek gereken testler için recordAuditAsync kullanın.
 */
export function recordAudit(event: AuditEvent): void {
  void recordAuditAsync(event);
}

export async function recordAuditAsync(event: AuditEvent): Promise<void> {
  if (isThrottledAudit(event)) return;
  try {
    await dbRun(`INSERT INTO audit_logs (id, event_type, subject_id, subject_type, ip_address, user_agent, success, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [nanoid(),
      event.eventType,
      event.subjectId ?? null,
      event.subjectType ?? 'anonymous',
      event.ipAddress ?? null,
      event.userAgent ?? null,
      event.success ? 1 : 0,
      sanitizeDetails(event.details)]);

    logger.info('audit', {
      event_type: event.eventType,
      subject_type: event.subjectType,
      success: event.success,
    });
  } catch (err) {
    logger.error('audit_write_failed', { err: (err as Error).message });
  }
}
