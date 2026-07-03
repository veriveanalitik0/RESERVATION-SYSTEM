/**
 * Çift onay diyaloğu — geri alınamaz işlemler (iptal, silme, reddetme) için.
 *
 * Kullanım:
 *   const [confirm, setConfirm] = useState<(() => void) | null>(null);
 *   ...
 *   <button onClick={() => setConfirm(() => () => doDangerousThing(id))}>Sil</button>
 *   <ConfirmDialog
 *     open={!!confirm}
 *     message="Bu kayıt kalıcı olarak silinecek."
 *     onConfirm={() => { confirm?.(); setConfirm(null); }}
 *     onCancel={() => setConfirm(null)}
 *   />
 *
 * Overlay tıklaması KAPATMAZ (kurumsal modal politikası) — yalnız butonlar.
 */
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true → onay butonu kırmızı (yıkıcı işlem). Varsayılan true. */
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title = 'Emin misiniz?',
  message,
  confirmLabel = 'Evet, devam et',
  cancelLabel = 'Vazgeç',
  destructive = true,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-kt-green-950/70 backdrop-blur-sm p-4 animate-fade-in"
    >
      <div className="bg-white rounded-2xl shadow-kt-card max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-kt-green-900">{title}</h3>
            <p className="text-sm text-kt-gray-600 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-kt-gray-100 text-kt-green-800 hover:bg-kt-gray-200 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            autoFocus
            className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-kt-green-700 hover:bg-kt-green-800'
            }`}
          >
            {loading ? 'İşleniyor…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
