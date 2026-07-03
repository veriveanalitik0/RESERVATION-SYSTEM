import { useCallback, useEffect, useState } from 'react';
import { useToast } from './Toast';
import { api } from '../services/api';
import { ConfirmDialog } from './ConfirmDialog';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import type { Visual, Booking } from '../types';

// Türkçe etiket (kullanıcıya görünen) + İngilizce prompt (flux/Pollinations
// İngilizce'de çok daha kaliteli sonuç verir). Butona tıklayınca prompt tema'ya set.
const THEME_SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  { label: 'Kurumsal Mavi-Beyaz', prompt: 'corporate clean blue and white, professional' },
  { label: 'Siberpunk Neon', prompt: 'cyberpunk neon, vibrant glow' },
  { label: 'Suluboya Pastel', prompt: 'soft watercolor, pastel colors' },
  { label: 'Minimal Tek Renk', prompt: 'minimal monochrome, clean lines' },
  { label: 'İzometrik 3B', prompt: 'isometric 3D render, soft shadows' },
  { label: 'Sıcak Anime', prompt: 'Studio Ghibli style, warm anime illustration' },
  { label: 'Fotogerçekçi', prompt: 'photorealistic, highly detailed, 8k' },
  { label: 'Düz Vektör', prompt: 'flat vector illustration, simple shapes' },
  { label: 'Retro 80’ler', prompt: 'retro 1980s synthwave aesthetic' },
  { label: 'Sinematik Altın Saat', prompt: 'cinematic golden hour lighting, dramatic' },
  { label: 'Karakalem Eskiz', prompt: 'detailed pencil sketch, hand drawn' },
  { label: 'Neon Karanlık', prompt: 'dark moody background, neon accents' },
  { label: 'Doğa Organik', prompt: 'organic nature, botanical, green tones' },
  { label: 'Teknoloji Devre', prompt: 'futuristic circuit board, high tech' },
  { label: 'Düşük Poli', prompt: 'low poly geometric art, colorful' },
  { label: 'Altın Lüks', prompt: 'luxury gold and black, elegant' },
];

/**
 * Görsel üretim stüdyosu — form + sonuç paneli + "Görsellerim" galerisi.
 * Profil sayfasının "Görsel Üret" sekmesinde render edilir; AppShell İÇERMEZ
 * ve prop almaz: galeri, projeler (booking) ve SSE 'visual.updated' aboneliği
 * dahil tüm state'ini kendisi yönetir.
 */
export function VisualStudio() {
  const toast = useToast();
  const [fikir, setFikir] = useState('');
  const [tema, setTema] = useState('');
  const [generating, setGenerating] = useState(false);
  const [current, setCurrent] = useState<Visual | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [gallery, setGallery] = useState<Visual[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Projeye atama + silme için kullanıcının projeleri (booking) ve durum state'i.
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [assignTarget, setAssignTarget] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadGallery = useCallback(async () => {
    try {
      const res = await api.listMyVisuals();
      setGallery(res.visuals);
    } catch {
      /* galeri sessizce boş kalır */
    }
  }, []);

  useEffect(() => {
    loadGallery();
    // Projeye atama için kullanıcının projelerini yükle (sessizce).
    api
      .listUserBookings()
      .then((res) => setBookings(res.bookings))
      .catch(() => {});
  }, [loadGallery]);

  function showVisual(v: Visual) {
    setCurrent(v);
  }

  // current değiştiğinde (ilk gösterim ya da SSE güncellemesi) görsel yükleme durumu sıfırlanır.
  useEffect(() => {
    setImgError(false);
    setImgLoading(!!current?.imageUrl);
  }, [current?.id, current?.imageUrl, current?.status]);

  // Async üretim: backend bitince 'visual.updated' SSE push'lar → listeyi + mevcut görseli tazele.
  useRealtimeEvents('user', (type, data) => {
    if (type !== 'visual.updated') return;
    api
      .listMyVisuals()
      .then((res) => {
        setGallery(res.visuals);
        const id = (data as { id?: string } | null)?.id;
        if (id) {
          const updated = res.visuals.find((v) => v.id === id);
          if (updated) setCurrent((cur) => (cur && cur.id === id ? updated : cur));
        }
      })
      .catch(() => {});
  });

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (fikir.trim().length < 5) {
      toast.push('error', 'Fikir en az 5 karakter olmalı.');
      return;
    }
    setGenerating(true);
    try {
      const res = await api.createVisual({ fikir: fikir.trim(), tema: tema.trim() || undefined });
      showVisual(res.visual);
      toast.push('success', 'Üretim başladı — hazır olunca otomatik görünecek.');
      loadGallery();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Görsel üretilemedi.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerate() {
    if (!current) return;
    setGenerating(true);
    try {
      const res = await api.regenerateVisual(current.id);
      showVisual(res.visual);
      toast.push('success', 'Yeni varyant üretiliyor…');
      loadGallery();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Yeniden üretilemedi.');
    } finally {
      setGenerating(false);
    }
  }

  // Seçili görseli bir projenin (booking) envanter kartına arkaplan olarak atar.
  async function handleAssign() {
    if (!current || !assignTarget) return;
    setAssigning(true);
    try {
      await api.setShowcaseImage(assignTarget, current.id);
      const proj = bookings.find((b) => b.id === assignTarget);
      toast.push(
        'success',
        `Görsel "${proj?.projectName ?? 'projen'}" projesinin envanter kartına atandı.`
      );
    } catch (err) {
      toast.push('error', (err as Error).message || 'Görsel projeye atanamadı.');
    } finally {
      setAssigning(false);
    }
  }

  // Görseli kalıcı siler (sahibi). Bir projeye atanmışsa backend arkaplanı kaldırır.
  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await api.deleteVisual(id);
      setGallery((g) => g.filter((v) => v.id !== id));
      setCurrent((cur) => (cur && cur.id === id ? null : cur));
      toast.push('success', 'Görsel silindi.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Görsel silinemedi.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <form onSubmit={handleGenerate} className="card p-6 space-y-4 h-fit">
          <div>
            <label className="label">Fikir</label>
            <textarea
              className="input min-h-[110px]"
              value={fikir}
              onChange={(e) => setFikir(e.target.value)}
              maxLength={400}
              placeholder="Örn: Bankacılık için yapay zeka destekli bütçe asistanı"
              required
            />
            <div className="text-[10px] text-kt-gray-400 mt-1 text-right">{fikir.length} / 400</div>
          </div>
          <div>
            <label className="label">
              Görsel Tarz / Tema <span className="text-kt-gray-400 font-normal">(opsiyonel)</span>
            </label>
            <input
              className="input"
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              maxLength={200}
              placeholder="Örn: corporate clean blue-white"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {THEME_SUGGESTIONS.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setTema(t.prompt)}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold border bg-white text-kt-green-700 border-kt-gray-200 hover:border-kt-violet-300 transition-colors"
                  title={t.prompt}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={generating} className="btn-primary w-full">
            {generating ? 'Üretiliyor…' : 'Görsel Üret'}
          </button>
          <p className="text-[11px] text-kt-gray-400">
            Fikrin önce zengin bir İngilizce prompt'a çevrilir, sonra görsel üretilir.
          </p>
        </form>

        {/* Sonuç */}
        <div className="card p-6">
          {!current ? (
            <div className="h-full min-h-[300px] flex items-center justify-center text-center text-kt-gray-400">
              <div>
                <div className="text-5xl mb-3">🎨</div>
                Henüz görsel yok. Soldan bir fikir gönder.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative aspect-square rounded-xl overflow-hidden bg-kt-gray-100">
                {current.status === 'enhancing' || current.status === 'generating' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-kt-gray-500 text-sm">
                    <svg className="w-8 h-8 animate-spin text-kt-violet-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {current.status === 'enhancing' ? 'Fikir prompt’a çevriliyor…' : 'Görsel üretiliyor…'}
                  </div>
                ) : current.imageUrl && !imgError ? (
                  <>
                    {imgLoading && (
                      <div className="absolute inset-0 flex items-center justify-center text-kt-gray-400 text-sm animate-pulse">
                        Görsel yükleniyor…
                      </div>
                    )}
                    <img
                      src={current.imageUrl}
                      alt={current.fikir}
                      className="w-full h-full object-cover"
                      onLoad={() => setImgLoading(false)}
                      onError={() => {
                        setImgLoading(false);
                        setImgError(true);
                      }}
                    />
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-center p-4 text-sm text-kt-gray-500">
                    {current.status === 'error'
                      ? current.errorMessage || 'Görsel üretilemedi.'
                      : 'Görsel sağlayıcı şu an yanıt vermiyor. "Yeniden üret"i deneyin ya da birazdan tekrar deneyin.'}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-kt-green-900 truncate">{current.fikir}</span>
                <button
                  onClick={handleRegenerate}
                  disabled={
                    generating ||
                    current.status === 'enhancing' ||
                    current.status === 'generating'
                  }
                  className="btn-secondary text-sm shrink-0"
                >
                  {generating ||
                  current.status === 'enhancing' ||
                  current.status === 'generating'
                    ? '…'
                    : 'Yeniden üret'}
                </button>
              </div>

              {current.promptEn && (
                <details className="text-xs text-kt-gray-500">
                  <summary className="cursor-pointer font-semibold">Üretilen prompt</summary>
                  <p className="mt-1 leading-relaxed">{current.promptEn}</p>
                </details>
              )}
              {current.variants.length > 1 && (
                <div className="text-[11px] text-kt-gray-400">{current.variants.length} varyant üretildi</div>
              )}

              {/* Projeye ata + sil — yalnız hazır görselde */}
              {current.status === 'ready' && current.imageUrl && (
                <div className="space-y-2 pt-3 border-t border-kt-gray-100">
                  <label className="label">Bu görseli bir projene ata (envanter kartında görünür)</label>
                  <div className="flex gap-2">
                    <select
                      className="input flex-1"
                      value={assignTarget}
                      onChange={(e) => setAssignTarget(e.target.value)}
                    >
                      <option value="">Proje seç…</option>
                      {bookings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.projectName}
                          {b.status !== 'approved' ? ' (onay bekliyor)' : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAssign}
                      disabled={!assignTarget || assigning}
                      className="btn-primary shrink-0"
                    >
                      {assigning ? '…' : 'Ata'}
                    </button>
                  </div>
                  {bookings.length === 0 && (
                    <p className="text-[11px] text-kt-gray-400">
                      Henüz projen yok. Önce bir oda/proje talebi oluştur.
                    </p>
                  )}
                  <button
                    onClick={() => setConfirmDeleteId(current.id)}
                    disabled={deletingId === current.id}
                    className="btn-ghost text-rose-600 text-sm"
                  >
                    {deletingId === current.id ? 'Siliniyor…' : '🗑 Bu görseli sil'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Galeri */}
      {gallery.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-kt-green-900 mb-3">Görsellerim</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {gallery.map((v) => (
              <div key={v.id} className="relative group aspect-square">
                <button
                  onClick={() => showVisual(v)}
                  className="w-full h-full rounded-lg overflow-hidden bg-kt-gray-100 border border-kt-gray-100 hover:border-kt-violet-300 transition-colors block"
                  title={v.fikir}
                >
                  {v.imageUrl ? (
                    <img
                      src={v.imageUrl}
                      alt={v.fikir}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">🎨</div>
                  )}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(v.id)}
                  disabled={deletingId === v.id}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-sm leading-none opacity-0 group-hover:opacity-100 hover:bg-rose-600 transition-opacity flex items-center justify-center"
                  title="Görseli sil"
                >
                  {deletingId === v.id ? '·' : '×'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Görsel silinsin mi?"
        message="Bu görsel kalıcı olarak silinecek. Bir projeye atanmışsa kart arkaplanı kaldırılır."
        confirmLabel="Evet, sil"
        onConfirm={() => {
          if (confirmDeleteId) void handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
}
