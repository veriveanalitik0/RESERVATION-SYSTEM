/**
 * Kiosk oda seçici (#5b) — hangi odanın ekranı açılacak.
 * Public: lab ekranını ayarlarken oda seçilir, /kiosk/:roomId tam ekran açılır.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { api } from '../services/api';
import type { KioskRoom } from '../types';

const TYPE_LABEL: Record<KioskRoom['roomType'], string> = {
  pod: 'Pod',
  experience: 'Deneyim Alanı',
  tribune: 'Tribün',
};

export default function KioskIndex() {
  const [rooms, setRooms] = useState<KioskRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.kioskRooms();
      setRooms(res.rooms);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-kt-green-900 via-kt-green-800 to-kt-violet-900 text-white">
      <header className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Logo size="sm" />
        <Link to="/" className="text-sm text-white/60 hover:text-white">
          ← Ana sayfa
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-widest text-kt-gold-300 font-bold mb-2">
            Kiosk · Oda Ekranı
          </div>
          <h1 className="text-4xl font-extrabold mb-2">Bir oda seçin</h1>
          <p className="text-white/70 max-w-2xl">
            Seçtiğiniz odanın son üretilen görseli tam ekran gösterilir ve otomatik yenilenir —
            lab odasındaki ekrana açın.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-white/10 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl bg-white/10 border border-white/10 p-8 text-center">
            <div className="text-lg font-bold mb-1">Odalar yüklenemedi</div>
            <p className="text-white/60 text-sm mb-4">
              Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center rounded-lg bg-kt-gold-400/90 hover:bg-kt-gold-300 text-kt-green-900 font-bold px-4 py-2 text-sm transition-colors"
            >
              Tekrar dene
            </button>
          </div>
        ) : rooms.length === 0 ? (
          <div className="rounded-xl bg-white/10 border border-white/10 p-8 text-center">
            <div className="text-lg font-bold mb-1">Henüz oda yok</div>
            <p className="text-white/60 text-sm">
              Gösterilecek bir oda bulunmuyor. Yönetici oda ekledikten sonra burada görünür.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {rooms.map((r) => (
              <Link
                key={r.id}
                to={`/kiosk/${r.id}`}
                className="group rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 hover:border-kt-gold-400/50 backdrop-blur p-4 transition-all"
              >
                <div className="text-[10px] uppercase tracking-wider text-kt-gold-300 font-bold mb-1">
                  {TYPE_LABEL[r.roomType] ?? r.roomType}
                </div>
                <div className="text-lg font-extrabold leading-tight mb-1 group-hover:text-kt-gold-200">
                  {r.name}
                </div>
                <div className="text-[11px] text-white/60">{r.code}</div>
                <div className="text-[11px] text-white/50 mt-2 truncate">{r.equipment}</div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
