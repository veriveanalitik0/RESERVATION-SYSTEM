/**
 * Her kullanıcı ekranında sağ-altta görünen sabit "Destek" butonu.
 * Tıklanınca açıklama modal'ı açılır; gönderilince admin'e bildirim düşer.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from './Toast';
import { api } from '../services/api';
import type { SubjectKind } from '../types';

interface SupportRequestButtonProps {
  /** Hangi rol token'ıyla destek talebi atılacak (user/danisman/arge). */
  kind?: SubjectKind;
}

export function SupportRequestButton({ kind = 'user' }: SupportRequestButtonProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createSupportRequest(description.trim(), kind);
      toast.push(
        'success',
        'Destek talebiniz alındı, ekibimiz en kısa sürede dönüş yapacak.'
      );
      setDescription('');
      setOpen(false);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Destek talebi gönderilemedi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-kt-green-800 text-white shadow-kt-card hover:bg-kt-green-700 transition-colors"
        title="Destek talep et"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="text-sm font-semibold">Destek</span>
      </button>

      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        >
          <div
            className="bg-white rounded-2xl shadow-kt-card max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="border-b border-kt-gray-100 px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-kt-gold-700 font-bold">
                  Yardım
                </div>
                <h2 className="text-xl font-extrabold text-kt-green-900">Destek Talep Et</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="p-2 rounded-lg hover:bg-kt-gray-100 text-kt-gray-500 disabled:opacity-50"
                aria-label="Kapat"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <form onSubmit={submit} className="p-6 space-y-4">
              <p className="text-sm text-kt-gray-600">
                Yaşadığınız sorunu veya talebinizi açıklayın. Yöneticiye bildirim
                olarak iletilecektir.
              </p>
              <div>
                <label className="label">Açıklama</label>
                <textarea
                  className="input min-h-[120px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  minLength={10}
                  required
                  autoFocus
                  placeholder="Sorununuzu veya talebinizi detaylıca yazın..."
                />
                <div className="text-[10px] text-kt-gray-400 mt-1 text-right">
                  {description.length} / 1000
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="flex-1 btn-ghost text-sm"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={submitting || description.trim().length < 10}
                  className="flex-1 btn-primary text-sm"
                >
                  {submitting ? 'Gönderiliyor…' : 'Gönder'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
