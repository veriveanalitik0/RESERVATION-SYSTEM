/**
 * MovableModalShell — sürüklenebilir + ölçeklenebilir (zoom) modal kabuğu.
 *
 * Sorun: Talep gönderme/onaylama kartları büyük ekranlarda merkeze sabit
 * oturuyordu; içerik viewport'tan uzun olunca üst kısmı görünmez oluyordu.
 *
 * Çözüm:
 *  - Kart `max-h-[88vh]` + içeride dikey scroll → tamamı her zaman erişilebilir.
 *  - Üstteki tutma çubuğundan SÜRÜKLENEBİLİR (ekranda serbest konumlama);
 *    çubuk her zaman ekranda kalacak şekilde kenarlara clamp'lenir.
 *  - Zoom −/+/sıfırla butonlarıyla BÜYÜTÜLÜP KÜÇÜLTÜLEBİLİR (0.6×–1.3×).
 *
 * Kullanım: dış `fixed inset-0` overlay + `bg-white rounded-2xl` kart sarmalını
 * bu bileşenle değiştir; children = mevcut başlık + gövde.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface MovableModalShellProps {
  open: boolean;
  onClose: () => void;
  /** Tailwind genişlik sınıfı, ör. 'max-w-2xl'. */
  maxWidthClass?: string;
  /**
   * Erişilebilirlik: panel içindeki başlık elemanının id'si. Verilirse
   * dialog `aria-labelledby` ile o başlığı kullanır; verilmezse `aria-label`
   * devreye girer.
   */
  labelledById?: string;
  /** aria-labelledby yoksa kullanılacak erişilebilir başlık. */
  ariaLabel?: string;
  children: ReactNode;
}

/** Panel içindeki odaklanabilir (görünür, disabled olmayan) öğeleri döndürür. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  const sel =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

const MIN_SCALE = 0.6;
const MAX_SCALE = 1.3;
const SCALE_STEP = 0.1;
/** Sürüklerken kartın ekranda görünür kalması için kenar payı (px). */
const EDGE_MARGIN = 80;

export function MovableModalShell({
  open,
  onClose,
  maxWidthClass = 'max-w-2xl',
  labelledById,
  ariaLabel = 'İletişim kutusu',
  children,
}: MovableModalShellProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);
  // Modal açılmadan önce odakta olan tetikleyici öğe — kapanışta odak geri döner.
  const triggerRef = useRef<HTMLElement | null>(null);
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );

  // Açılışta konum/zoom sıfırla (önceki açılıştan kalmasın).
  useEffect(() => {
    if (open) {
      setPos({ x: 0, y: 0 });
      setScale(1);
    }
  }, [open]);

  // Açılışta odağı panele taşı; kapanışta tetikleyiciye geri döndür.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    // İlk odaklanabilir öğeye, yoksa panelin kendisine (tabIndex=-1) odaklan.
    const panel = panelRef.current;
    if (panel) {
      const focusables = getFocusable(panel);
      (focusables[0] ?? panel).focus();
    }
    return () => {
      // Kapanışta odağı, hâlâ DOM'da ise tetikleyiciye geri ver.
      const t = triggerRef.current;
      if (t && document.contains(t)) t.focus();
    };
  }, [open]);

  // Escape ile kapat + Tab/Shift+Tab odak tuzağı (focus-trap).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = getFocusable(panel);
      if (focusables.length === 0) {
        // Odaklanabilir öğe yoksa odak panel içinde kalsın.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Panel dışına / sınırlardan döngüle.
      if (e.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || active === panel || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const clampPos = useCallback((x: number, y: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Merkez referanslı offset; kartın yarısı + kenar payı kadar gezinebilir.
    const halfW = (rect?.width ?? 0) / 2;
    const halfH = (rect?.height ?? 0) / 2;
    const maxX = Math.max(0, vw / 2 + halfW - EDGE_MARGIN);
    const maxY = Math.max(0, vh / 2 + halfH - EDGE_MARGIN);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }, []);

  const onDragPointerDown = (e: React.PointerEvent) => {
    // Yalnız sol tık / dokunma; buton üzerindeyse sürükleme başlatma.
    if (e.button !== 0) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPos(clampPos(dragState.current.baseX + dx, dragState.current.baseY + dy));
  };

  const onDragPointerUp = (e: React.PointerEvent) => {
    dragState.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture zaten bırakılmış olabilir */
    }
  };

  const zoomOut = () => setScale((s) => Math.max(MIN_SCALE, Math.round((s - SCALE_STEP) * 10) / 10));
  const zoomIn = () => setScale((s) => Math.min(MAX_SCALE, Math.round((s + SCALE_STEP) * 10) / 10));
  const resetView = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  if (!open) return null;

  // Body'ye portal: AppShell'in sticky header'ı (z-40) gibi ata stacking-context'lere
  // hapsolmayı önler → modalın üstü artık hiçbir şeyin altında kalmaz.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-kt-green-950/70 backdrop-blur-sm animate-fade-in"
    >
      <div
        ref={panelRef}
        data-testid="movable-modal-panel"
        role="dialog"
        aria-modal="true"
        {...(labelledById ? { 'aria-labelledby': labelledById } : { 'aria-label': ariaLabel })}
        tabIndex={-1}
        className={`bg-white rounded-2xl shadow-kt-card ${maxWidthClass} w-full max-h-[88vh] overflow-hidden flex flex-col animate-slide-up focus:outline-none`}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sürükleme + zoom kontrol çubuğu */}
        <div
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          className="flex items-center justify-between gap-2 px-3 py-1.5 bg-kt-gray-100 border-b border-kt-gray-200 cursor-move select-none touch-none"
        >
          {/* Tutma göstergesi (grip) */}
          <div className="flex items-center gap-1.5 text-kt-gray-400">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
            </svg>
            <span className="text-[11px] font-medium text-kt-gray-500">Taşı</span>
          </div>
          {/* Zoom kontrolleri — pointer event'leri sürüklemeye yayılmasın */}
          <div
            className="flex items-center gap-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={zoomOut}
              disabled={scale <= MIN_SCALE}
              className="w-7 h-7 rounded-md bg-white border border-kt-gray-200 text-kt-gray-600 hover:bg-kt-gray-50 disabled:opacity-40 flex items-center justify-center"
              aria-label="Küçült"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" d="M5 12h14" /></svg>
            </button>
            <button
              type="button"
              onClick={resetView}
              className="px-2 h-7 rounded-md bg-white border border-kt-gray-200 text-[11px] tabular-nums font-semibold text-kt-gray-600 hover:bg-kt-gray-50"
              aria-label="Görünümü sıfırla"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={scale >= MAX_SCALE}
              className="w-7 h-7 rounded-md bg-white border border-kt-gray-200 text-kt-gray-600 hover:bg-kt-gray-50 disabled:opacity-40 flex items-center justify-center"
              aria-label="Büyült"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
        </div>

        {children}
      </div>
    </div>,
    document.body
  );
}
