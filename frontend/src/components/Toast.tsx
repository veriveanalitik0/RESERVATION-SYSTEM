import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Monoton artan sayaç — Date.now()+random() float hassasiyeti nedeniyle
  // aynı milisaniyedeki toast'lara çakışan anahtar üretebiliyordu.
  const seq = useRef(0);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++seq.current;
    setItems((s) => [...s, { id, kind, message }]);
    setTimeout(() => {
      setItems((s) => s.filter((i) => i.id !== id));
    }, 4500);
  }, []);

  // Sabit kimlikli context value: toast eklenip silindikçe consumer'ların
  // (useCallback([toast]) + useEffect zincirleri) yeniden tetiklenmesini önler.
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Ekran okuyucu duyurusu: bilgi/başarı kibarca (polite), hata anında
          (assertive) bildirilsin. Konteyner aria-live taşır; her toast kendi
          role'ünü (status / alert) belirtir. */}
      <div
        className="fixed top-6 right-6 z-[100] flex flex-col gap-2 max-w-md"
        role="region"
        aria-label="Bildirimler"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
            className={`px-5 py-3 rounded-xl shadow-kt-card animate-slide-up font-medium border ${
              t.kind === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : t.kind === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
