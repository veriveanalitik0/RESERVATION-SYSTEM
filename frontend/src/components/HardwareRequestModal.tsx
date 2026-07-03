/**
 * Donanım talebi modal'ı — yeni talep oluşturma + mevcut talebi düzenleme.
 * WaitlistModal/BookingModal desenini izler.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  CreateHardwareRequestPayload,
  EquipmentType,
  HardwareRequest,
  HardwareUrgency,
} from '../types';

const EQUIPMENT_OPTIONS: Array<{ value: EquipmentType; label: string }> = [
  { value: 'mouse', label: 'Mouse' },
  { value: 'keyboard', label: 'Klavye' },
  { value: 'camera', label: 'Kamera' },
  { value: 'monitor', label: 'Monitör' },
  { value: 'headset', label: 'Kulaklık' },
  { value: 'other', label: 'Diğer' },
];

const URGENCY_OPTIONS: Array<{ value: HardwareUrgency; label: string }> = [
  { value: 'low', label: 'Düşük' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Yüksek' },
];

interface Props {
  open: boolean;
  loading: boolean;
  /** Düzenlenen talep — null ise yeni talep. */
  editing: HardwareRequest | null;
  onClose: () => void;
  onSubmit: (payload: CreateHardwareRequestPayload) => void | Promise<void>;
}

export function HardwareRequestModal({ open, loading, editing, onClose, onSubmit }: Props) {
  const [equipmentType, setEquipmentType] = useState<EquipmentType>('mouse');
  const [equipmentDetail, setEquipmentDetail] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<HardwareUrgency>('normal');

  useEffect(() => {
    if (open) {
      setEquipmentType(editing?.equipmentType ?? 'mouse');
      setEquipmentDetail(editing?.equipmentDetail ?? '');
      setQuantity(editing?.quantity ?? 1);
      setReason(editing?.reason ?? '');
      setUrgency(editing?.urgency ?? 'normal');
    }
  }, [open, editing]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      equipmentType,
      equipmentDetail: equipmentDetail.trim() || null,
      quantity,
      reason: reason.trim(),
      urgency,
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <div
        className="bg-white rounded-2xl shadow-kt-card max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-white border-b border-kt-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-kt-gold-700 font-bold">
              Donanım talebi
            </div>
            <h2 className="text-xl font-extrabold text-kt-green-900">
              {editing ? 'Talebi düzenle' : 'Yeni donanım talebi'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-kt-gray-100 text-kt-gray-500"
            aria-label="Kapat"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label">Donanım türü</label>
            <div className="grid grid-cols-3 gap-2">
              {EQUIPMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEquipmentType(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    equipmentType === opt.value
                      ? 'bg-kt-green-700 text-white border-kt-green-700'
                      : 'bg-white text-kt-green-800 border-kt-gray-200 hover:border-kt-green-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Adet</label>
              <input
                type="number"
                className="input"
                value={quantity}
                min={1}
                max={20}
                onChange={(e) =>
                  setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                }
                required
              />
            </div>
            <div>
              <label className="label">Aciliyet</label>
              <div className="flex gap-1.5">
                {URGENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setUrgency(opt.value)}
                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      urgency === opt.value
                        ? 'bg-kt-green-700 text-white border-kt-green-700'
                        : 'bg-white text-kt-green-800 border-kt-gray-200 hover:border-kt-green-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="label">
              {equipmentType === 'other'
                ? 'Donanım açıklaması'
                : 'Marka / model (opsiyonel)'}
            </label>
            <input
              type="text"
              className="input"
              value={equipmentDetail}
              onChange={(e) => setEquipmentDetail(e.target.value)}
              maxLength={200}
              placeholder={
                equipmentType === 'other'
                  ? 'Hangi donanıma ihtiyacınız var?'
                  : 'örn: Logitech MX Master'
              }
              required={equipmentType === 'other'}
            />
          </div>

          <div>
            <label className="label">Gerekçe</label>
            <textarea
              className="input min-h-[90px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              minLength={10}
              required
              placeholder="Bu donanıma neden ihtiyaç duyduğunuzu açıklayın..."
            />
            <div className="text-[10px] text-kt-gray-400 mt-1 text-right">
              {reason.length} / 1000
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-ghost text-sm"
              disabled={loading}
            >
              Vazgeç
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary text-sm"
              disabled={loading || reason.trim().length < 10}
            >
              {loading ? 'Gönderiliyor…' : editing ? 'Güncelle' : 'Talep gönder'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
