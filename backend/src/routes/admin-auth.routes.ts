/**
 * Admin authentication routes.
 * Path: /api/admin/auth/*
 * Not: Admin tablosu user'lardan ayrı, JWT key'i ayrı.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { loginSchema, refreshSchema } from '../validators/schemas';
import { login } from '../services/auth.service';
import {
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../services/token.service';
import { MFA_PENDING_TTL } from './auth.routes';
import { recordAudit } from '../services/audit.service';
import { authRateLimit } from '../middleware/security.middleware';
import { requireAdmin } from '../middleware/auth.middleware';
import { HttpError } from '../middleware/error.middleware';
import {
  clearRefreshCookie,
  csrfProtection,
  getRefreshCookie,
  setRefreshCookie,
} from '../middleware/cookie-auth';
import { isMfaRequired } from '../services/mfa.service';
import { maskEmail } from '../utils/logger';

const router = Router();

router.post(
  '/login',
  authRateLimit,
  csrfProtection,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = loginSchema.parse(req.body);
      const result = await login('admin', input.email, input.password);

      // MFA aktifse tam token VERİLMEZ — kısa ömürlü pending token döner;
      // tam oturum /api/auth/mfa/verify başarısında açılır (sunucu tarafı zorlama).
      const mfaRequired = await isMfaRequired(result.subject.id);
      if (mfaRequired) {
        await revokeRefreshToken(result.tokens.refreshToken);
        const { token: mfaPendingToken, ttl } = signAccessToken(
          'admin',
          {
            sub: result.subject.id,
            role: result.subject.role,
            email: result.subject.email,
            mfa: 'pending',
          },
          { ttlOverride: MFA_PENDING_TTL }
        );
        recordAudit({
          eventType: 'auth.login.success',
          subjectId: result.subject.id,
          subjectType: 'admin',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: true,
          details: { email: maskEmail(result.subject.email), mfaPending: true },
        });
        res.json({
          mfaRequired: true,
          mfaPendingToken,
          expiresIn: ttl,
          admin: result.subject,
        });
        return;
      }

      recordAudit({
        eventType: 'auth.login.success',
        subjectId: result.subject.id,
        subjectType: 'admin',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: true,
        details: { email: maskEmail(result.subject.email) },
      });

      setRefreshCookie(res, 'admin', result.tokens.refreshToken);

      // Refresh token yalnız HttpOnly cookie'de — gövdede dönmez.
      res.json({
        accessToken: result.tokens.accessToken,
        expiresIn: result.tokens.expiresIn,
        admin: result.subject,
        mfaRequired: false,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        recordAudit({
          eventType:
            err.code === 'ACCOUNT_LOCKED' ? 'auth.login.locked' : 'auth.login.failure',
          subjectType: 'admin',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
          details: {
            email: typeof req.body?.email === 'string' ? maskEmail(req.body.email) : null,
            code: err.code,
          },
        });
      }
      next(err);
    }
  }
);

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const access = req.get('authorization')?.split(' ')[1];
    if (!access) throw new HttpError(401, 'Access token gerekli.', 'AUTH_REQUIRED');

    // ignoreExpiration: kimlik HttpOnly refresh cookie'sinden gelir; süresi geçmiş
    // access token refresh'i engellemesin (unified /api/auth/refresh ile tutarlı).
    let decoded;
    try {
      decoded = verifyAccessToken('admin', access, { ignoreExpiration: true });
    } catch {
      throw new HttpError(401, 'Access token geçersiz.', 'AUTH_INVALID');
    }

    const cookieToken = getRefreshCookie(req, 'admin');
    const bodyParse = refreshSchema.safeParse(req.body);
    const refreshToken = cookieToken ?? (bodyParse.success ? bodyParse.data.refreshToken : null);
    if (!refreshToken) {
      throw new HttpError(401, 'Refresh token bulunamadı.', 'REFRESH_INVALID');
    }

    const outcome = await rotateRefreshToken('admin', refreshToken, {
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    });

    if (!outcome.ok) {
      const isReuse = outcome.reason === 'reuse_detected';
      clearRefreshCookie(res, 'admin');
      recordAudit({
        eventType: isReuse ? 'auth.refresh.reuse_detected' : 'auth.refresh.failure',
        subjectId: decoded.sub,
        subjectType: 'admin',
        ipAddress: req.ip,
        success: false,
        details: { reason: outcome.reason },
      });
      throw new HttpError(
        401,
        isReuse ? 'Oturum güvenliği gereği yeniden giriş yapın.' : 'Refresh token geçersiz.',
        isReuse ? 'REFRESH_REUSE' : 'REFRESH_INVALID'
      );
    }

    const rotated = outcome.tokens;
    setRefreshCookie(res, 'admin', rotated.refreshToken);
    recordAudit({
      eventType: 'auth.refresh.success',
      subjectId: rotated.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
    });

    res.json({
      accessToken: rotated.accessToken,
      expiresIn: rotated.expiresIn,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', csrfProtection, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cookieToken = getRefreshCookie(req, 'admin');
    if (cookieToken) await revokeRefreshToken(cookieToken);
    const input = refreshSchema.safeParse(req.body);
    if (input.success) await revokeRefreshToken(input.data.refreshToken);
    clearRefreshCookie(res, 'admin');
    recordAudit({
      eventType: 'auth.logout',
      subjectId: req.auth?.subjectId,
      subjectType: 'admin',
      ipAddress: req.ip,
      success: true,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAdmin, (req: Request, res: Response) => {
  res.json({
    id: req.auth!.subjectId,
    email: req.auth!.email,
    role: req.auth!.role,
  });
});

export default router;
