/**
 * Admin route modülleri arası paylaşılan yardımcılar: admin-only GET guard'ı
 * (requireAdminSubject) ve ?limit/?offset sayfalama parser'ı (readPage).
 */
import type { Request, Response, NextFunction } from 'express';
import { recordAudit } from '../../services/audit.service';
import { HttpError } from '../../middleware/error.middleware';

/**
 * Hassas GET'ler için ek katman: blanket requireStaff governance rollerini
 * (danışman/arge) içeri alır; güvenlik audit logları, KVKK veri ihracı ve
 * yedek listesi gibi uçlar EN AZ YETKİ gereği yalnız admin'e açık kalmalı.
 */
export function requireAdminSubject(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.subjectType !== 'admin') {
    recordAudit({
      eventType: 'authz.denied',
      subjectId: req.auth?.subjectId,
      subjectType: req.auth?.subjectType,
      ipAddress: req.ip,
      success: false,
      details: { path: req.path, reason: 'admin_only_resource' },
    });
    next(new HttpError(403, 'Bu kaynağa yalnız admin erişebilir.', 'FORBIDDEN'));
    return;
  }
  next();
}

/** ?limit & ?offset parse — route katmanında clamp + servislerde de sınır. */
export function readPage(req: Request): { limit?: number; offset?: number } {
  const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
  const rawOffset = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : undefined;
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit as number, 1), 200) : undefined,
    offset: Number.isFinite(rawOffset) ? Math.max(rawOffset as number, 0) : undefined,
  };
}
