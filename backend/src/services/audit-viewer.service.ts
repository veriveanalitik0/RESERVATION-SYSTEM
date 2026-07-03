/**
 * Audit log viewer — admin UI için filtered list + CSV export.
 *
 * Güvenlik:
 *  - Sadece admin endpoint'ten erişilebilir (authz middleware ile).
 *  - SQL parameterized — string concat YOK (app_security §3).
 *  - details kolonu zaten scrubbed (audit.service sanitizeDetails).
 */
import { dbAll, dbOne } from '../db/schema';

export interface AuditLogEntry {
  id: string;
  eventType: string;
  subjectId: string | null;
  subjectType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogFilters {
  eventType?: string;
  subjectType?: 'user' | 'admin' | 'anonymous';
  subjectId?: string;
  success?: boolean;
  ipAddress?: string;
  /** ISO date — bu tarihten ITİBAREN */
  since?: string;
  /** ISO date — bu tarihe KADAR */
  until?: string;
  q?: string; // event_type LIKE
  limit?: number;
  offset?: number;
}

interface AuditRow {
  id: string;
  event_type: string;
  subject_id: string | null;
  subject_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  success: number;
  details: string | null;
  created_at: string;
}

function rowToEntry(r: AuditRow): AuditLogEntry {
  let details: Record<string, unknown> | null = null;
  if (r.details) {
    try {
      details = JSON.parse(r.details) as Record<string, unknown>;
    } catch {
      details = { _raw: r.details };
    }
  }
  return {
    id: r.id,
    eventType: r.event_type,
    subjectId: r.subject_id,
    subjectType: r.subject_type,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    success: r.success === 1,
    details,
    createdAt: r.created_at,
  };
}

export async function listAuditLog(filters: AuditLogFilters = {}): Promise<{
  entries: AuditLogEntry[];
  total: number;
}> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.eventType) {
    conditions.push('event_type = ?');
    params.push(filters.eventType);
  }
  if (filters.subjectType) {
    conditions.push('subject_type = ?');
    params.push(filters.subjectType);
  }
  if (filters.subjectId) {
    conditions.push('subject_id = ?');
    params.push(filters.subjectId);
  }
  if (filters.success !== undefined) {
    conditions.push('success = ?');
    params.push(filters.success ? 1 : 0);
  }
  if (filters.ipAddress) {
    conditions.push('ip_address = ?');
    params.push(filters.ipAddress);
  }
  if (filters.since) {
    conditions.push('created_at >= ?');
    params.push(filters.since);
  }
  if (filters.until) {
    conditions.push('created_at <= ?');
    params.push(filters.until);
  }
  if (filters.q) {
    conditions.push('event_type LIKE ?');
    params.push(`%${filters.q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const totalRow = await dbOne(`SELECT COUNT(*) AS c FROM audit_logs ${where}`, [...params]) as { c: number };

  const rows = await dbAll(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]) as AuditRow[];

  return {
    entries: rows.map(rowToEntry),
    total: totalRow.c,
  };
}

/**
 * CSV export — admin "indir" butonuyla.
 * Sıklıkla SOC ekibine paylaşılır → kolon adları sabit.
 */
export async function exportAuditCsv(filters: AuditLogFilters = {}): Promise<string> {
  const { entries } = await listAuditLog({ ...filters, limit: 5000, offset: 0 });
  const header = 'created_at,event_type,subject_type,subject_id,ip_address,success,details';
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'string' ? v : JSON.stringify(v);
    // CSV formül enjeksiyonu (OWASP): Excel/Sheets '=', '+', '-', '@', TAB ile
    // başlayan hücreyi formül olarak çalıştırır. ip_address trust proxy nedeniyle
    // saldırgan kontrollü olabilir — tek tırnakla nötralize et.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    // RFC 4180 CSV escape (+ lone \r satır yapısını bozmasın)
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = entries.map((e) =>
    [
      e.createdAt,
      e.eventType,
      e.subjectType ?? '',
      e.subjectId ?? '',
      e.ipAddress ?? '',
      e.success ? '1' : '0',
      e.details ? JSON.stringify(e.details) : '',
    ]
      .map(escape)
      .join(',')
  );
  return [header, ...lines].join('\n');
}

export async function distinctEventTypes(): Promise<string[]> {
  return (
    await dbAll('SELECT DISTINCT event_type FROM audit_logs ORDER BY event_type ASC', []) as Array<{ event_type: string }>
  ).map((r) => r.event_type);
}
