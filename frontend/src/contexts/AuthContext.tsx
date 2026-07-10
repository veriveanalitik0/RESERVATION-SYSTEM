import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser, SubjectKind } from '../types';
import { sessionStore } from '../services/storage';
import { api } from '../services/api';

/**
 * Auth state — 4 ayrı oturum slotu. Her kind kendi token'ını ayrı
 * sessionStorage anahtarında saklar; aynı tarayıcıda birden fazla rolün eş
 * zamanlı oturumu mümkündür ama her biri yalnızca kendi kind'ının
 * endpoint'lerine erişebilir.
 */
interface AuthState {
  user: AuthUser | null;
  admin: AuthUser | null;
  danisman: AuthUser | null;
  arge: AuthUser | null;
  izleyici: AuthUser | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (
    email: string,
    password: string
  ) => Promise<{
    kind: SubjectKind;
    subject: AuthUser;
    /** true ise oturum HENÜZ açılmadı — completeMfaLogin ile TOTP adımı gerekir. */
    mfaRequired?: boolean;
    mfaPendingToken?: string;
  }>;
  /** MFA ikinci adımı: TOTP/backup kodu doğrulanırsa tam oturumu açar. */
  completeMfaLogin: (
    pendingToken: string,
    code: string
  ) => Promise<{ kind: SubjectKind; subject: AuthUser }>;
  register: (payload: {
    email: string;
    password: string;
    passwordConfirm: string;
    fullName: string;
    // governanceRole REMOVED (C2) — registration self-service ile yönetişim
    // rolü atanamaz; admin atar.
  }) => Promise<{ kind: SubjectKind; subject: AuthUser }>;
  logout: (kind: SubjectKind) => Promise<void>;
  /** EK-1 beyanı onaylandı — oturumdaki subject'in consentAcceptedAt alanını günceller. */
  markConsentAccepted: (kind: SubjectKind, acceptedAt: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ALL_KINDS: SubjectKind[] = ['user', 'admin', 'danisman', 'arge', 'izleyici'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    admin: null,
    danisman: null,
    arge: null,
    izleyici: null,
    loading: true,
  });

  useEffect(() => {
    const snapshot: Partial<AuthState> = { loading: false };
    for (const k of ALL_KINDS) {
      const s = sessionStore.get(k);
      snapshot[k] = s ? s.subject : null;
    }
    // Sayfa yenilemesinde de governance role'lara göre rol slot'larını çapraz doldur.
    const u = snapshot.user;
    if (u && u.governanceRole === 'analitik_danisman' && !snapshot.danisman) snapshot.danisman = u;
    if (u && u.governanceRole === 'yz_arge' && !snapshot.arge) snapshot.arge = u;
    setState((curr) => ({ ...curr, ...snapshot }));
  }, []);

  // Refresh başarısız olunca (oturum öldü) api katmanı 'klab:session-expired'
  // event'i atar → ilgili slot temizlenir → ProtectedRoute login'e yönlendirir,
  // polling component'leri unmount olur (401 fırtınası kesilir).
  useEffect(() => {
    function onExpired(e: Event) {
      const kind = (e as CustomEvent).detail as SubjectKind;
      setState((curr) => {
        const next: AuthState = { ...curr, [kind]: null };
        if (kind === 'user') {
          next.danisman = null;
          next.arge = null;
        }
        return next;
      });
    }
    window.addEventListener('klab:session-expired', onExpired);
    return () => window.removeEventListener('klab:session-expired', onExpired);
  }, []);

  /**
   * Single-session enforcement: Yeni bir kind ile login olunduğunda DİĞER tüm
   * rol session'larını (storage + state) TEMİZLE. Aksi halde sıralı login'lerde
   * sessionStorage'da birden çok token birikir ve URL'den /admin /danisman /arge
   * arası serbestçe gezilebilir (privilege escalation by stale session).
   *
   * Tek istisna: 'user' kind'ı governanceRole taşıyorsa, o rolün slot'u da
   * AYNI subject ile doldurulur — danisman/arge zaten user tipindeki bir
   * hesabın türevidir, ayrı bir login değildir.
   */
  const applySession = useCallback((kind: SubjectKind, subject: AuthUser) => {
    // 1. Diğer kind'ların storage'ını da temizle (sessionStore.clear hem token hem state)
    for (const k of ALL_KINDS) {
      if (k !== kind) sessionStore.clear(k);
    }
    // 2. State'i sıfırla: yalnız bu kind set edilmiş olsun
    setState(() => {
      const fresh: AuthState = {
        user: null,
        admin: null,
        danisman: null,
        arge: null,
        izleyici: null,
        loading: false,
      };
      fresh[kind] = subject;
      // 3. Governance-rolüne göre çapraz slot (aynı subject ile — ekstra login değil)
      if (kind === 'user' && subject.governanceRole === 'analitik_danisman') {
        fresh.danisman = subject;
      } else if (kind === 'user' && subject.governanceRole === 'yz_arge') {
        fresh.arge = subject;
      }
      return fresh;
    });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      // MFA'lı admin: backend tam token vermedi — oturum kaydetme, TOTP adımına geç.
      if (res.mfaRequired && res.mfaPendingToken) {
        return {
          kind: res.type,
          subject: res.subject,
          mfaRequired: true,
          mfaPendingToken: res.mfaPendingToken,
        };
      }
      sessionStore.save(
        res.type,
        { accessToken: res.accessToken!, expiresIn: res.expiresIn },
        res.subject
      );
      applySession(res.type, res.subject);
      return { kind: res.type, subject: res.subject };
    },
    [applySession]
  );

  const completeMfaLogin = useCallback(
    async (pendingToken: string, code: string) => {
      const res = await api.mfaLoginVerify(pendingToken, code);
      sessionStore.save(
        res.type,
        { accessToken: res.accessToken, expiresIn: res.expiresIn },
        res.subject
      );
      applySession(res.type, res.subject);
      return { kind: res.type as SubjectKind, subject: res.subject };
    },
    [applySession]
  );

  const register = useCallback(
    async (payload: {
      email: string;
      password: string;
      passwordConfirm: string;
      fullName: string;
    }) => {
      const res = await api.register(payload);
      sessionStore.save(
        res.type,
        { accessToken: res.accessToken, expiresIn: res.expiresIn },
        res.subject
      );
      applySession(res.type, res.subject);
      return { kind: res.type, subject: res.subject };
    },
    [applySession]
  );

  const markConsentAccepted = useCallback((kind: SubjectKind, acceptedAt: string) => {
    sessionStore.patchSubject(kind, { consentAcceptedAt: acceptedAt });
    // Aynı subject birden çok slot'ta olabilir (user + governance türev slotları) —
    // hepsini güncelle ki modal/kart tekrar tetiklenmesin.
    setState((curr) => {
      const target = curr[kind];
      if (!target) return curr;
      const next: AuthState = { ...curr };
      for (const k of ALL_KINDS) {
        const s = next[k];
        if (s && s.id === target.id) {
          next[k] = { ...s, consentAcceptedAt: acceptedAt };
        }
      }
      return next;
    });
  }, []);

  const logout = useCallback(async (kind: SubjectKind) => {
    try {
      if (kind === 'admin') {
        await api.logoutAdmin();
      } else {
        // user, danisman, arge — hepsi /api/auth/logout'a düşer; ayrıca user-side
        // refresh cookie temizlenmesi gerektirebilir.
        await api.logoutUser();
      }
    } finally {
      sessionStore.clear(kind);
      setState((s) => ({ ...s, [kind]: null }));
    }
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      login,
      completeMfaLogin,
      register,
      logout,
      markConsentAccepted,
    }),
    [state, login, completeMfaLogin, register, logout, markConsentAccepted]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook, provider ile ayni dosyada (bilincli)
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
