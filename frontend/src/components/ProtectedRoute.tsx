import { Navigate } from 'react-router-dom';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import { api } from '../services/api';
import { ConsentCard } from './ConsentCard';
import { AuthBackground } from './AuthBackground';
import type { AuthUser, SubjectKind } from '../types';

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

/**
 * EK-1 beyanı kapısı — login/register akışındaki onay kartının KALICI güvence
 * ağı. Oturum, kart onaylanmadan da sessionStorage'a yazıldığından F5 veya
 * doğrudan URL ile korumalı sayfalara girilebiliyordu; bu kapı, beyanı
 * onaylanmamış (consentAcceptedAt === null) user-tabanlı oturumları içerik
 * yerine beyan kartına düşürür. Onay → oturum güncellenir, sayfa açılır;
 * ret → oturum kapatılır (me null olur, ProtectedRoute /login'e yönlendirir).
 */
function ConsentGate({ kind, subject }: { kind: SubjectKind; subject: AuthUser }) {
  const { logout, markConsentAccepted } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function handleAccept() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.acceptConsent(kind);
      markConsentAccepted(kind, res.consentAcceptedAt);
      toast.push('success', 'EK-1 beyanı kaydedildi. İyi çalışmalar!');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Beyan onayı kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    if (busy) return;
    setBusy(true);
    try {
      await logout(kind);
    } catch {
      // Yerel oturum temizliği logout() finally'sinde yapıldı; ağ hatası yutulur.
    } finally {
      setBusy(false);
      toast.push('info', 'EK-1 beyanı onaylanmadan laboratuvar sistemine giriş yapılamaz.');
    }
  }

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center px-4 py-12 overflow-hidden bg-kt-green-950">
      <AuthBackground greenOrb />
      <div className="relative z-20 w-full max-w-2xl animate-fade-in">
        <ConsentCard
          fullName={subject.fullName}
          loading={busy}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      </div>
    </div>
  );
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
  const candidates: SubjectKind[] =
    kind === 'any'
      ? ['admin', 'danisman', 'arge', 'izleyici', 'user']
      : Array.isArray(kind)
        ? kind
        : [kind];
  const matchedKind = candidates.find((k) => slot(k)) ?? null;
  const me = matchedKind ? slot(matchedKind) : null;
  if (!me || !matchedKind) {
    return <Navigate to="/login" replace />;
  }
  // EK-1 beyanı onaylanmamış user-tabanlı oturum: içerik yerine beyan kapısı.
  // (Admin'ler kapsam dışı — consentAcceptedAt alanları undefined'dır.)
  if (matchedKind !== 'admin' && me.consentAcceptedAt === null) {
    return <ConsentGate kind={matchedKind} subject={me} />;
  }
  return <>{children}</>;
}
