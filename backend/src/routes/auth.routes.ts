/**
 * Unified authentication routes.
 * Path: /api/auth/*
 *
 * Kullanıcı ve admin'in aynı login formundan giriş yapmasını sağlar.
 * Backend hangi tabloda eşleşme bulduğunu döner; frontend yönlendirme yapar.
 *
 * Güvenlik:
 * - Admin önceliği (aynı e-posta her iki tabloda varsa admin yetkisi verilir)
 * - Timing-safe (kullanıcı yoksa bile decoy argon2 hash)
 * - JWT keypair'ler hala AYRI (cross-token kullanım reddedilir — auth.middleware'de doğrulanıyor)
 * - Refresh token rotation aynı subject_type üzerinde işler
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  exitSurveySchema,
  forgotPasswordSchema,
  loginSchema,
  projectSurveySchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validators/schemas';
import { recordExitSurvey } from '../services/exit-survey.service';
import { recordProjectSurvey } from '../services/project-survey.service';
import {
  unifiedLogin,
  registerUser,
  findSubjectById,
  acceptUserConsent,
  CONSENT_VERSION,
} from '../services/auth.service';
import { requireAnySubject } from '../middleware/auth.middleware';
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../services/token.service';
import { recordAudit } from '../services/audit.service';
import { authRateLimit, sensitiveActionRateLimit } from '../middleware/security.middleware';
import { HttpError } from '../middleware/error.middleware';
import {
  clearRefreshCookie,
  csrfProtection,
  getRefreshCookie,
  setRefreshCookie,
} from '../middleware/cookie-auth';
import { isMfaRequired, verifyMfaCode } from '../services/mfa.service';
import { maskEmail } from '../utils/logger';
import type { AdminRecord, SubjectKind } from '../types/auth.types';

const router = Router();

/** MFA ara token'ının ömrü (sn) — yalnız TOTP adımını tamamlamaya yetecek kadar. */
export const MFA_PENDING_TTL = 300;

/**
 * Yeni kullanıcı kaydı — sadece 'user' rolü.
 * Admin oluşturmak için bu endpoint kullanılamaz (DB seviyesinde users tablosuna yazılır).
 */
router.post(
  '/register',
  sensitiveActionRateLimit,
  csrfProtection,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = registerSchema.parse(req.body);
      const created = await registerUser(input);

      // Hesap oluşturulduktan sonra otomatik login (UX için)
      const loginResult = await unifiedLogin(created.email, input.password);

      recordAudit({
        eventType: 'auth.login.success',
        subjectId: created.id,
        subjectType: 'user',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: true,
        details: { email: maskEmail(created.email), registration: true },
      });

      setRefreshCookie(res, 'user', loginResult.tokens.refreshToken);

      // Refresh token YALNIZ HttpOnly cookie'de yaşar (XSS'e karşı) — gövdede dönmez.
      res.status(201).json({
        accessToken: loginResult.tokens.accessToken,
        expiresIn: loginResult.tokens.expiresIn,
        type: 'user' as const,
        subject: loginResult.subject,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        recordAudit({
          eventType: 'validation.failure',
          subjectType: 'anonymous',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
          details: {
            scope: 'registration',
            email: typeof req.body?.email === 'string' ? maskEmail(req.body.email) : null,
            code: err.code,
          },
        });
      }
      next(err);
    }
  }
);

router.post(
  '/login',
  authRateLimit,
  csrfProtection,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = loginSchema.parse(req.body);
      const result = await unifiedLogin(input.email, input.password);

      const mfaRequired = result.kind === 'admin' && (await isMfaRequired(result.subject.id));

      // MFA'lı admin: tam token VERME. Parola doğru ama oturum ancak TOTP ile
      // açılır — kısa ömürlü 'pending' token döner, login'in ürettiği refresh
      // token iptal edilir. Tam token /auth/mfa/verify başarısında verilir.
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
          details: { email: maskEmail(result.subject.email), unified: true, mfaPending: true },
        });
        res.json({
          mfaRequired: true,
          mfaPendingToken,
          expiresIn: ttl,
          type: result.kind,
          subject: result.subject,
        });
        return;
      }

      recordAudit({
        eventType: 'auth.login.success',
        subjectId: result.subject.id,
        subjectType: result.kind,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: true,
        details: { email: maskEmail(result.subject.email), unified: true },
      });

      setRefreshCookie(res, result.kind, result.tokens.refreshToken);

      // Refresh token yalnız HttpOnly cookie'de — gövdede dönmez.
      res.json({
        accessToken: result.tokens.accessToken,
        expiresIn: result.tokens.expiresIn,
        type: result.kind,
        subject: result.subject,
        mfaRequired: false,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        recordAudit({
          eventType:
            err.code === 'ACCOUNT_LOCKED' ? 'auth.login.locked' : 'auth.login.failure',
          subjectType: 'anonymous',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
          details: {
            email: typeof req.body?.email === 'string' ? maskEmail(req.body.email) : null,
            code: err.code,
            unified: true,
          },
        });
      }
      next(err);
    }
  }
);

/**
 * MFA login doğrulama — pending token + TOTP/backup kodu → tam oturum.
 *
 * Güvenlik:
 * - Yalnız `mfa: 'pending'` claim'li, süresi geçmemiş admin token'ı kabul edilir
 *   (tam yetkili token bu endpoint'te işe yaramaz, pending token başka hiçbir
 *   endpoint'te geçmez — guard'lar reddeder).
 * - authRateLimit TOTP brute-force'unu sınırlar; her başarısız deneme audit'lenir.
 */
router.post(
  '/mfa/verify',
  authRateLimit,
  csrfProtection,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bearer = req.get('authorization')?.split(' ')[1];
      if (!bearer) throw new HttpError(401, 'MFA oturumu bulunamadı.', 'MFA_SESSION_REQUIRED');

      let decoded;
      try {
        decoded = verifyAccessToken('admin', bearer);
      } catch {
        throw new HttpError(401, 'MFA oturumu geçersiz veya süresi doldu.', 'MFA_SESSION_INVALID');
      }
      if (decoded.mfa !== 'pending') {
        throw new HttpError(401, 'MFA oturumu geçersiz.', 'MFA_SESSION_INVALID');
      }

      const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
      if (!code || code.length < 6 || code.length > 16) {
        throw new HttpError(400, 'Geçersiz doğrulama kodu.', 'VALIDATION');
      }

      const verify = await verifyMfaCode(decoded.sub, code);
      if (!verify.valid) {
        recordAudit({
          eventType: 'auth.mfa.verify.failure',
          subjectId: decoded.sub,
          subjectType: 'admin',
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: false,
        });
        throw new HttpError(401, 'MFA kodu geçersiz.', 'MFA_INVALID');
      }

      const admin = (await findSubjectById('admin', decoded.sub)) as AdminRecord | undefined;
      if (!admin) throw new HttpError(401, 'Oturum geçersiz.', 'SUBJECT_NOT_FOUND');

      const { token: accessToken, ttl } = signAccessToken('admin', {
        sub: admin.id,
        role: admin.role,
        email: admin.email,
      });
      const { token: refreshToken } = await issueRefreshToken('admin', admin.id);
      setRefreshCookie(res, 'admin', refreshToken);

      recordAudit({
        eventType: 'auth.mfa.verify.success',
        subjectId: admin.id,
        subjectType: 'admin',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: true,
        details: { usedBackupCode: verify.usedBackupCode },
      });

      res.json({
        accessToken,
        expiresIn: ttl,
        type: 'admin' as const,
        subject: {
          id: admin.id,
          email: admin.email,
          fullName: admin.full_name,
          role: admin.role,
        },
        usedBackupCode: verify.usedBackupCode,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * EK-1 "Okudum, Kabul Ettim" beyanı onayı — bir kereye mahsus, login/register
 * akışındaki onay kartından çağrılır. Tüm user-tabanlı kind'lar (user/danisman/
 * arge/izleyici) kabul edilir; admin hesapları beyan kapsamı dışındadır.
 * İdempotent: tekrar çağrı mevcut onay zamanını döner.
 */
router.post(
  '/consent',
  csrfProtection,
  requireAnySubject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = req.auth!;
      if (auth.subjectType === 'admin') {
        throw new HttpError(
          400,
          'Beyan onayı yalnız kullanıcı hesapları için geçerlidir.',
          'CONSENT_NOT_APPLICABLE'
        );
      }

      const result = await acceptUserConsent(auth.subjectId);

      if (!result.alreadyAccepted) {
        recordAudit({
          eventType: 'user.consent.accepted',
          subjectId: auth.subjectId,
          subjectType: auth.subjectType,
          ipAddress: req.ip,
          userAgent: req.get('user-agent') ?? null,
          success: true,
          details: { version: CONSENT_VERSION },
        });
      }

      res.json({
        ok: true,
        consentAcceptedAt: result.consentAcceptedAt,
        version: CONSENT_VERSION,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Çıkış anketi — kullanıcı "Çıkış" derken doldurduğu 5 soruluk deneyim anketi.
 *
 * Logout'tan ÖNCE çağrılır (token hâlâ geçerliyken). Anket zorunlu değildir:
 * kullanıcı "Atla" derse istek hiç atılmaz. Anket kaydı BAŞARISIZ olsa bile
 * çıkış engellenmemeli — frontend hatayı yutar ve logout'a devam eder.
 */
router.post(
  '/exit-survey',
  csrfProtection,
  requireAnySubject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = exitSurveySchema.parse(req.body);
      const auth = req.auth!;
      const { saved } = await recordExitSurvey(auth.subjectId, auth.subjectType, input);
      res.status(saved ? 201 : 200).json({ saved });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Proje sonu anketi — 3 açık uçlu soruyla projenin ve deneyimin anlatıldığı anket.
 *
 * ŞİMDİLİK çıkış akışında gösteriliyor (İLERİDE proje tamamlanma akışına
 * taşınacak); bu yüzden /exit-survey ile aynı sözleşme geçerli: logout'tan
 * ÖNCE çağrılır, zorunlu değildir ("Atla" → istek atılmaz), kayıt BAŞARISIZ
 * olsa bile çıkış engellenmemeli — frontend hatayı yutar ve logout'a devam eder.
 * requireAnySubject bilinçli: exit-survey ile simetri korunur; UI zaten
 * user-dışı rollere anketi göstermiyor.
 */
router.post(
  '/project-survey',
  csrfProtection,
  requireAnySubject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = projectSurveySchema.parse(req.body);
      const auth = req.auth!;
      const { saved } = await recordProjectSurvey(auth.subjectId, auth.subjectType, input);
      res.status(saved ? 201 : 200).json({ saved });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Parola sıfırlama talebi.
 * Güvenlik: kullanıcı varlığı ifşa edilmez — e-posta kayıtlı olsun olmasın
 * her zaman aynı (başarılı) yanıt döner.
 */
router.post(
  '/forgot-password',
  sensitiveActionRateLimit,
  csrfProtection,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      const { requestPasswordReset } = await import('../services/password-reset.service');
      await requestPasswordReset(email);
      recordAudit({
        eventType: 'password_reset.requested',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: true,
        details: { email: maskEmail(email) },
      });
      res.json({
        message:
          'E-posta kayıtlıysa parola sıfırlama bağlantısı gönderildi. Gelen kutunu kontrol et.',
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Parola sıfırlama — token + yeni parola.
 */
router.post(
  '/reset-password',
  authRateLimit,
  csrfProtection,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = resetPasswordSchema.parse(req.body);
      const { resetPassword } = await import('../services/password-reset.service');
      const { userId } = await resetPassword(input.token, input.password);
      recordAudit({
        eventType: 'password_reset.completed',
        subjectId: userId,
        subjectType: 'user',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? null,
        success: true,
      });
      res.json({ message: 'Parolan güncellendi. Yeni parolanla giriş yapabilirsin.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Unified refresh: frontend, sahip olduğu subject_type'ı body içinde bildirir.
 * Backend yine doğru key pair ile validate eder.
 */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const access = req.get('authorization')?.split(' ')[1];
    if (!access) throw new HttpError(401, 'Access token gerekli.', 'AUTH_REQUIRED');

    // Hangi key/aud ile decode edileceğini sırayla dene: user → admin → danisman → arge.
    // ignoreExpiration: süresi geçmiş access token (15dk sonrası) refresh'i ENGELLEMEZ —
    // kimlik HttpOnly refresh cookie'sinden doğrulanır; access token yalnız subject'i
    // tanımlar (imza/aud/iss yine doğrulanır). Aksi halde 15dk sonra zorla logout olurdu.
    let decoded;
    let kind: SubjectKind = 'user';
    const tryKinds: SubjectKind[] = ['user', 'admin', 'danisman', 'arge', 'izleyici'];
    let verified = false;
    for (const k of tryKinds) {
      try {
        decoded = verifyAccessToken(k, access, { ignoreExpiration: true });
        kind = k;
        verified = true;
        break;
      } catch {
        /* try next */
      }
    }
    if (!verified || !decoded) {
      throw new HttpError(401, 'Access token geçersiz.', 'AUTH_INVALID');
    }

    // Cookie öncelikli, body fallback (geriye uyum)
    const cookieToken = getRefreshCookie(req, kind);
    const refreshToken =
      cookieToken ??
      (refreshSchema.safeParse(req.body).success
        ? (refreshSchema.parse(req.body).refreshToken as string)
        : null);
    if (!refreshToken) {
      throw new HttpError(401, 'Refresh token bulunamadı.', 'REFRESH_INVALID');
    }

    // Yeni access token'ı DB'deki TAZE subject'ten imzala: devre dışı bırakılan
    // (status≠1) veya rolü/governance_role'ü değişen kullanıcı anında yansır —
    // bayat token claim'iyle yetki uzatılmaz.
    const subject = await findSubjectById(kind, decoded.sub);
    if (!subject) {
      clearRefreshCookie(res, kind);
      throw new HttpError(401, 'Oturum geçersiz veya hesap pasif.', 'REFRESH_INVALID');
    }

    const outcome = await rotateRefreshToken(kind, refreshToken, {
      sub: subject.id,
      email: subject.email,
      role: subject.role,
    });

    if (!outcome.ok) {
      const isReuse = outcome.reason === 'reuse_detected';
      // Saldırı veya geçersiz refresh: cookie'yi temizle
      clearRefreshCookie(res, kind);
      recordAudit({
        eventType: isReuse ? 'auth.refresh.reuse_detected' : 'auth.refresh.failure',
        subjectId: decoded.sub,
        subjectType: kind,
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
    setRefreshCookie(res, kind, rotated.refreshToken);
    recordAudit({
      eventType: 'auth.refresh.success',
      subjectId: rotated.subjectId,
      subjectType: kind,
      ipAddress: req.ip,
      success: true,
    });

    res.json({
      accessToken: rotated.accessToken,
      expiresIn: rotated.expiresIn,
      type: kind,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', csrfProtection, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens: string[] = [];
    const kinds: SubjectKind[] = ['user', 'admin', 'danisman', 'arge', 'izleyici'];
    for (const k of kinds) {
      const cookie = getRefreshCookie(req, k);
      if (cookie) tokens.push(cookie);
    }

    const bodyParsed = refreshSchema.safeParse(req.body);
    if (bodyParsed.success) tokens.push(bodyParsed.data.refreshToken);

    for (const t of tokens) await revokeRefreshToken(t);

    for (const k of kinds) clearRefreshCookie(res, k);

    recordAudit({
      eventType: 'auth.logout',
      ipAddress: req.ip,
      success: true,
      details: { unified: true },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
