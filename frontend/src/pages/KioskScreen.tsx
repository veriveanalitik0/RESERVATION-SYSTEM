/**
 * Kiosk ekranı (#5b) — bir odanın son üretilen görselini TAM EKRAN gösterir.
 *
 * - Auto-refresh: her 15 sn'de bir son görseli yeniden çeker (yeni üretim gelince geçer).
 * - Idle screen: oda için henüz görsel yoksa animasyonlu marka ekranı.
 * - Public: oda ekranı, login gerektirmez. Görsel iç URL (prompt'suz) + oda bilgisi.
 *
 * Kullanım: /kiosk/:roomId — lab odasındaki ekrana tam ekran açılır.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../services/api';
import type { KioskData } from '../types';

const REFRESH_MS = 15_000;

export default function KioskScreen() {
  const { roomId = '' } = useParams();
  const [data, setData] = useState<KioskData | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const prevUrlRef = useRef<string | null>(null);
  const [fade, setFade] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.roomKiosk(roomId);
      // Yeni görsel geldiyse yumuşak geçiş tetikle.
      if (res.latestVisual?.imageUrl && res.latestVisual.imageUrl !== prevUrlRef.current) {
        prevUrlRef.current = res.latestVisual.imageUrl;
        setFade(true);
        window.setTimeout(() => setFade(false), 600);
      }
      setData(res);
      setError(false);
    } catch {
      setError(true);
    }
  }, [roomId]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(clock);
    };
  }, [load]);

  const visual = data?.latestVisual ?? null;
  const room = data?.room ?? null;

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden select-none">
      {visual ? (
        <img
          src={visual.imageUrl}
          alt={room?.name ?? 'Kiosk görseli'}
          className={`absolute inset-0 w-full h-full object-cover animate-ken-burns transition-opacity duration-700 ${
            fade ? 'opacity-0' : 'opacity-100'
          }`}
        />
      ) : (
        // Idle screen — marka gradyanı (gorsel_uretim tarzı)
        <div className="absolute inset-0 bg-gradient-to-br from-kt-green-900 via-kt-green-800 to-kt-violet-900">
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
            <div className="w-24 h-24 rounded-3xl bg-white/10 backdrop-blur flex items-center justify-center mb-6 animate-float-slow">
              <svg className="w-12 h-12 text-kt-gold-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-5xl font-extrabold tracking-tight mb-2">{room?.name ?? 'AI Lab'}</div>
            <div className="text-kt-gold-300 text-lg font-semibold">{room?.equipment}</div>
            <div className="mt-8 text-white/60 text-sm animate-pulse">
              Bu oda için henüz görsel üretilmedi — Profilim → Görsel Üret sekmesinden ekleyin.
            </div>
          </div>
        </div>
      )}

      {/* Alt bilgi şeridi (görsel varken) */}
      {visual && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-8 flex items-end justify-between">
          <div>
            <div className="text-3xl font-extrabold drop-shadow-lg">{room?.name}</div>
            <div className="text-kt-gold-300 font-semibold drop-shadow">
              {room?.code} · {room?.equipment}
            </div>
          </div>
          <div className="text-right text-white/80 text-sm drop-shadow">
            <div className="text-2xl font-bold tabular-nums">
              {new Date(now).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div>Kuveyt Türk AI Lab</div>
          </div>
        </div>
      )}

      {/* Üst köşe: oda kodu + çıkış (kiosk modundan) */}
      <div className="absolute top-0 inset-x-0 p-5 flex items-center justify-between">
        <div className="text-xs font-bold tracking-widest uppercase text-white/70 drop-shadow">
          {room?.code ?? 'KIOSK'}
        </div>
        <Link
          to="/kiosk"
          className="text-xs text-white/50 hover:text-white/90 bg-black/30 rounded-lg px-3 py-1.5 backdrop-blur"
        >
          ← Oda seç
        </Link>
      </div>

      {error && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-rose-600/80 rounded-lg px-3 py-1 text-xs">
          Bağlantı hatası — tekrar deneniyor…
        </div>
      )}
    </div>
  );
}
