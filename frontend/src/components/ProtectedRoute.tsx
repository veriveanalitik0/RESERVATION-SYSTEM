import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { SubjectKind } from '../types';

interface ProtectedRouteProps {
  /**
   * Erişebilecek oturum(lar):
   *  - tek bir SubjectKind
   *  - 'any' — herhangi bir aktif oturum (rol-bağımsız sayfalar)
   *  - SubjectKind[] — birden çok rol (örn. admin panel sayfaları artık
   *    danışman/arge tarafından read-only görülebiliyor)
   */
  kind: SubjectKind | 'any' | SubjectKind[];
  children: ReactNode;
}

export function ProtectedRoute({ kind, children }: ProtectedRouteProps) {
  const auth = useAuth();
  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kt-gray-50">
        <div className="text-kt-gray-500">Yükleniyor...</div>
      </div>
    );
  }
  const slot = (k: SubjectKind) =>
    k === 'admin'
      ? auth.admin
      : k === 'danisman'
        ? auth.danisman
        : k === 'arge'
          ? auth.arge
          : k === 'izleyici'
            ? auth.izleyici
            : auth.user;
  const me =
    kind === 'any'
      ? auth.admin ?? auth.danisman ?? auth.arge ?? auth.izleyici ?? auth.user
      : Array.isArray(kind)
        ? (kind.map(slot).find(Boolean) ?? null)
        : slot(kind);
  if (!me) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
