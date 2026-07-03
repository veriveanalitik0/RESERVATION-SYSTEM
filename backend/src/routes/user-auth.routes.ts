/**
 * User authentication routes.
 * Path: /api/user/auth/*
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { loginSchema, refreshSchema } from '../validators/schemas';
import { login } from '../services/auth.service';
import {
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  issueRefreshToken,
  verifyAccessToken,
} from '../services/token.service';
import { recordAudit } from '../services/audit.service';
import { authRateLimit } from '../middleware/security.middleware';
import { requireUser } from '../middleware/auth.middleware';
import { HttpError } from '../middleware/error.middleware';
import {
  clearRefreshCookie,
  csrfProtection,
  getRefreshCookie,
  setRefreshCookie,
} from '../middleware/cookie-auth';
import { maskEmail } from '../utils/logger';

const router = Router();

router.post(
  '/login',
  authRateLimit,
  csrfProtection,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = loginSchema.parse(req.body);
      const result = await login('user', input.email, input.password);

      recordAudit({
        eventType: 'auth.login.success',
        subjectId: result.subject.id,
        subjectType: 'user',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: true,
        details: { email: maskEmail(result.subject.email) },
      });

      setRefreshCookie(res, 'user', result.tokens.refreshToken);

      // Refresh token yalnız HttpOnly cookie'de — gövdede dönmez.
      res.json({
        accessToken: result.tokens.accessToken,
        expiresIn: result.tokens.expiresIn,
        user: result.subject,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        recordAudit({
          eventType:
            err.code === 'ACCOUNT_LOCKED' ? 'auth.login.locked' : 'auth.login.failure',
          subjectType: 'user',
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
      decoded = verifyAccessToken('user', access, { ignoreExpiration: true });
    } catch {
      throw new HttpError(401, 'Access token geçersiz.', 'AUTH_INVALID');
    }

    const cookieToken = getRefreshCookie(req, 'user');
    const bodyParse = refreshSchema.safeParse(req.body);
    const refreshToken = cookieToken ?? (bodyParse.success ? bodyParse.data.refreshToken : null);
    if (!refreshToken) {
      throw new HttpError(401, 'Refresh token bulunamadı.', 'REFRESH_INVALID');
    }

    const outcome = await rotateRefreshToken('user', refreshToken, {
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    });

    if (!outcome.ok) {
      const isReuse = outcome.reason === 'reuse_detected';
      clearRefreshCookie(res, 'user');
      recordAudit({
        eventType: isReuse ? 'auth.refresh.reuse_detected' : 'auth.refresh.failure',
        subjectId: decoded.sub,
        subjectType: 'user',
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
    setRefreshCookie(res, 'user', rotated.refreshToken);
    recordAudit({
      eventType: 'auth.refresh.success',
      subjectId: rotated.subjectId,
      subjectType: 'user',
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

router.post('/logout', csrfProtection, requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cookieToken = getRefreshCookie(req, 'user');
    if (cookieToken) await revokeRefreshToken(cookieToken);
    const input = refreshSchema.safeParse(req.body);
    if (input.success) {
      await revokeRefreshToken(input.data.refreshToken);
    }
    clearRefreshCookie(res, 'user');
    recordAudit({
      eventType: 'auth.logout',
      subjectId: req.auth?.subjectId,
      subjectType: 'user',
      ipAddress: req.ip,
      success: true,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireUser, (req: Request, res: Response) => {
  res.json({
    id: req.auth!.subjectId,
    email: req.auth!.email,
    role: req.auth!.role,
  });
});

export default router;

/**
 * Yardımcı: token üreten servisi de export et ki diğer route'lar kullanabilsin.
 */
export { signAccessToken, issueRefreshToken };
