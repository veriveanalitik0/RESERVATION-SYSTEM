/**
 * Auth type definitions.
 */
/**
 * Subject token kind — yönetişim rolleri için ayrı token akışları.
 *
 *  user      → sıradan kullanıcı (lab odası booking yapabilir)
 *  admin     → Lab Mühendisi (admin panel)
 *  danisman  → Analitik Danışman (yalnızca /governance/danisman/*)
 *  arge      → YZ / Ar-Ge Mühendisi (yalnızca /governance/arge/*)
 *
 * Bir user'ın hesabı bunlardan birini taşır (governance_role'e göre login'de
 * kind belirlenir). Token'lar farklı `aud` claim'iyle imzalanır ve farklı
 * refresh cookie path'lerine düşer — birinden alınan token diğer endpoint'lere
 * geçerli değildir.
 */
export type SubjectKind = 'user' | 'admin' | 'danisman' | 'arge' | 'izleyici';

/** Auth flow'larında HTTP kind eşlemesi — login response.type, refresh cookie vs. */
export const SUBJECT_KINDS: readonly SubjectKind[] = ['user', 'admin', 'danisman', 'arge', 'izleyici'] as const;

/** Bir SubjectKind'ın user-side mi (auth.middleware için kullanılır) admin-side mi. */
export function isUserSideKind(k: SubjectKind): boolean {
  return k === 'user' || k === 'danisman' || k === 'arge' || k === 'izleyici';
}

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: 'user';
  governance_role: 'analitik_danisman' | 'yz_arge' | 'izleyici' | null;
  department: string | null;
  title: string | null;
  manager: string | null;
  phone: string | null;
  bio: string | null;
  project_idea: string | null;
  failed_login_count: number;
  locked_until: string | null;
  status: number;
  created_at: string;
  updated_at: string;
}

export interface AdminRecord {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: 'admin' | 'super_admin';
  failed_login_count: number;
  locked_until: string | null;
  status: number;
  created_at: string;
  updated_at: string;
}

export interface JwtPayload {
  sub: string;
  type: SubjectKind;
  role: string;
  email: string;
  /** User'lar için yönetişim rolü (varsa). Admin'ler için undefined. */
  governanceRole?: 'analitik_danisman' | 'yz_arge' | 'izleyici' | null;
  /**
   * MFA'lı admin login'inin ara aşaması. 'pending' taşıyan token YALNIZCA
   * /auth/mfa/verify'da geçerlidir; tüm guard'lar reddeder. TOTP doğrulanınca
   * claim'siz (tam yetkili) token verilir.
   */
  mfa?: 'pending';
}

export interface AuthContext {
  subjectId: string;
  subjectType: SubjectKind;
  email: string;
  role: string;
  /** Sadece user'lar için anlamlı. */
  governanceRole?: 'analitik_danisman' | 'yz_arge' | 'izleyici' | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express Request augmentation bunu gerektirir
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
