/**
 * Authentication & authorization middleware.
 *
 * Güvenlik:
 * - app_security.md §5: Her endpoint için server-side yetki kontrolü.
 * - User ve Admin token'ları AYRI (farklı RSA key, farklı audience).
 * - Subject type uyuşmuyorsa 401 (auth confusion engellenir).
 */
import type { Request, Response, NextFunction } from 'express';
import { HttpError } from './error.middleware';
import { findSubjectById } from '../services/auth.service';
import { verifyAccessToken } from '../services/token.service';
import { recordAudit } from '../services/audit.service';
import type { SubjectKind } from '../types/auth.types';

function extractBearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

function buildAuthMiddleware(expectedKind: SubjectKind) {
  return async function authGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = extractBearer(req);
    if (!token) {
      next(new HttpError(401, 'Kimlik doğrulaması gerekli.', 'AUTH_REQUIRED'));
      return;
    }

    try {
      const decoded = verifyAccessToken(expectedKind, token);
      // MFA tamamlanmamış ara token hiçbir korumalı endpoint'e giremez.
      if (decoded.mfa === 'pending') {
        next(new HttpError(401, 'MFA doğrulaması gerekli.', 'MFA_REQUIRED'));
        return;
      }
      const subject = await findSubjectById(expectedKind, decoded.sub);
      if (!subject) {
        next(new HttpError(401, 'Oturum geçersiz.', 'SUBJECT_NOT_FOUND'));
        return;
      }

      req.auth = {
        subjectId: subject.id,
        subjectType: expectedKind,
        email: subject.email,
        role: subject.role,
        ...(expectedKind !== 'admin'
          ? {
              governanceRole:
                (subject as { governance_role?: 'analitik_danisman' | 'yz_arge' | 'izleyici' | null })
                  .governance_role ?? null,
            }
          : {}),
      };
      next();
    } catch (err) {
      recordAudit({
        eventType: 'authz.denied',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: false,
        details: {
          path: req.path,
          expected: expectedKind,
          reason: (err as Error).message,
        },
      });
      next(new HttpError(401, 'Kimlik doğrulaması başarısız.', 'AUTH_INVALID'));
    }
  };
}

export const requireUser = buildAuthMiddleware('user');
export const requireAdmin = buildAuthMiddleware('admin');
/** Sadece Analitik Danışman kind'lı token kabul eder. */
export const requireDanisman = buildAuthMiddleware('danisman');
/** Sadece YZ / Ar-Ge kind'lı token kabul eder. */
export const requireArge = buildAuthMiddleware('arge');
/** Sadece İzleyici (salt-okunur görüntüleyici) kind'lı token kabul eder. */
export const requireIzleyici = buildAuthMiddleware('izleyici');

/**
 * Herhangi bir kimliği kabul eden guard — user / admin / danisman / arge.
 * Rol-bağımsız endpoint'ler için (örn. genel sohbet: her rol katılabilir).
 * Token hangi audience'a aitse o kind çözülür ve req.auth ona göre kurulur.
 */
export async function requireAnySubject(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    next(new HttpError(401, 'Kimlik doğrulaması gerekli.', 'AUTH_REQUIRED'));
    return;
  }

  const KINDS: SubjectKind[] = ['user', 'admin', 'danisman', 'arge', 'izleyici'];
  for (const kind of KINDS) {
    try {
      const decoded = verifyAccessToken(kind, token);
      if (decoded.mfa === 'pending') continue; // MFA ara token'ı hiçbir guard'da geçerli değil
      const subject = await findSubjectById(kind, decoded.sub);
      if (!subject) continue;
      req.auth = {
        subjectId: subject.id,
        subjectType: kind,
        email: subject.email,
        role: subject.role,
        ...(kind !== 'admin'
          ? {
              governanceRole:
                (subject as { governance_role?: 'analitik_danisman' | 'yz_arge' | 'izleyici' | null })
                  .governance_role ?? null,
            }
          : {}),
      };
      next();
      return;
    } catch {
      /* sıradaki kind'ı dene */
    }
  }

  recordAudit({
    eventType: 'authz.denied',
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? null,
    success: false,
    details: { path: req.path, expected: 'any', reason: 'no kind matched' },
  });
  next(new HttpError(401, 'Kimlik doğrulaması başarısız.', 'AUTH_INVALID'));
}

/**
 * Personel guard'ı — admin / danışman / arge kabul eder, sıradan kullanıcıyı
 * REDDEDER. Admin panel sayfalarının read-only (GET) erişimini governance
 * rollerine açmak için: GET → requireStaff, mutasyonlar → requireAdmin.
 */
export async function requireStaff(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    next(new HttpError(401, 'Kimlik doğrulaması gerekli.', 'AUTH_REQUIRED'));
    return;
  }

  // izleyici: salt-okunur personel — yalnız GET'ler requireStaff'tan geçer,
  // tüm mutasyonlar requireAdmin istediği için veri değiştiremez.
  const STAFF_KINDS: SubjectKind[] = ['admin', 'danisman', 'arge', 'izleyici'];
  for (const kind of STAFF_KINDS) {
    try {
      const decoded = verifyAccessToken(kind, token);
      if (decoded.mfa === 'pending') continue; // MFA ara token'ı hiçbir guard'da geçerli değil
      const subject = await findSubjectById(kind, decoded.sub);
      if (!subject) continue;
      req.auth = {
        subjectId: subject.id,
        subjectType: kind,
        email: subject.email,
        role: subject.role,
        ...(kind !== 'admin'
          ? {
              governanceRole:
                (subject as { governance_role?: 'analitik_danisman' | 'yz_arge' | 'izleyici' | null })
                  .governance_role ?? null,
            }
          : {}),
      };
      next();
      return;
    } catch {
      /* sıradaki staff kind'ı dene */
    }
  }

  recordAudit({
    eventType: 'authz.denied',
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? null,
    success: false,
    details: { path: req.path, expected: 'staff', reason: 'not a staff token' },
  });
  next(new HttpError(403, 'Bu kaynağa erişim yetkiniz yok.', 'FORBIDDEN'));
}

export function requireAdminRole(...allowedRoles: Array<'admin' | 'super_admin'>) {
  return function roleGuard(req: Request, _res: Response, next: NextFunction): void {
    if (!req.auth || req.auth.subjectType !== 'admin') {
      next(new HttpError(403, 'Yetki yok.', 'FORBIDDEN'));
      return;
    }
    if (!allowedRoles.includes(req.auth.role as 'admin' | 'super_admin')) {
      recordAudit({
        eventType: 'authz.denied',
        subjectId: req.auth.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: false,
        details: { requiredRoles: allowedRoles, actual: req.auth.role },
      });
      next(new HttpError(403, 'Yetki yok.', 'FORBIDDEN'));
      return;
    }
    next();
  };
}

/**
 * Yönetişim rolü kontrolü (kılavuz rolleri).
 * super_admin tüm yönetişim rollerinin yetkisine sahiptir (override).
 * Aksi halde admin'in `governance_role` alanı izinli roller arasında olmalı.
 */
export function requireGovernanceRole(
  ...allowedRoles: Array<'analitik_danisman' | 'lab_muhendisi' | 'yz_arge'>
) {
  return async function governanceGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!req.auth || req.auth.subjectType !== 'admin') {
      next(new HttpError(403, 'Yetki yok.', 'FORBIDDEN'));
      return;
    }
    // super_admin her yönetişim aksiyonunu yapabilir.
    if (req.auth.role === 'super_admin') {
      next();
      return;
    }
    const subject = await findSubjectById('admin', req.auth.subjectId) as
      | { governance_role?: string | null }
      | undefined;
    const govRole = subject?.governance_role ?? null;
    if (!govRole || !allowedRoles.includes(govRole as (typeof allowedRoles)[number])) {
      recordAudit({
        eventType: 'authz.denied',
        subjectId: req.auth.subjectId,
        subjectType: 'admin',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: false,
        details: { requiredGovernanceRoles: allowedRoles, actual: govRole },
      });
      next(
        new HttpError(
          403,
          'Bu işlem için yönetişim rolü yetkiniz yok.',
          'GOVERNANCE_ROLE_REQUIRED'
        )
      );
      return;
    }
    next();
  };
}

/**
 * Kullanıcı yönetişim rolü kontrolü. requireUser sonrası kullanılır.
 * Kullanıcı'nın `governance_role` alanı izinli set içinde olmalı.
 */
export function requireUserGovernanceRole(
  ...allowedRoles: Array<'analitik_danisman' | 'yz_arge'>
) {
  return function userGovernanceGuard(req: Request, _res: Response, next: NextFunction): void {
    if (!req.auth || req.auth.subjectType !== 'user') {
      next(new HttpError(403, 'Yetki yok.', 'FORBIDDEN'));
      return;
    }
    const govRole = req.auth.governanceRole ?? null;
    if (!govRole || !allowedRoles.includes(govRole as (typeof allowedRoles)[number])) {
      recordAudit({
        eventType: 'authz.denied',
        subjectId: req.auth.subjectId,
        subjectType: 'user',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: false,
        details: { requiredUserGovernanceRoles: allowedRoles, actual: govRole },
      });
      next(
        new HttpError(
          403,
          'Bu işlem için yönetişim rolü yetkiniz yok.',
          'GOVERNANCE_ROLE_REQUIRED'
        )
      );
      return;
    }
    next();
  };
}
