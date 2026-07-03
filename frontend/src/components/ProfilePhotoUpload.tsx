/**
 * Profil fotoğrafı yükleme component'i.
 *
 * Akış:
 *  1. Kaynak seç — ya dosyadan (<input type="file" accept="image/jpeg">)
 *     ya da bilgisayar/cihaz kamerasından (getUserMedia ile canlı çekim)
 *  2. Client-side resize: canvas ile 400×400 kare crop + JPEG quality 0.85
 *  3. Boyut max 200KB (server limit) — iteratif quality azaltma
 *  4. Backend'e dataURL POST
 *  5. Mevcut foto'yu sil için ayrı buton
 *
 * Güvenlik:
 *  - Sadece JPEG (accept attribute + magic byte server tarafta)
 *  - SVG / HTML upload yasak (XSS)
 *  - Client-side resize ile EXIF temizliği (canvas re-encode metadata atar)
 *  - Kamera akışı modal kapanınca / unmount'ta durdurulur (track.stop)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from './Toast';
import { api } from '../services/api';

interface Props {
  /** Mevcut profil fotoğrafı data URL veya null. */
  current: string | null;
  /** Kullanıcı adı (placeholder initials için). */
  fullName: string;
  /** Yüklendi / silindi sonrası callback. */
  onChanged: (newDataUrl: string | null) => void;
}

const MAX_SIZE_BYTES = 200 * 1024;
const MAX_DIM = 400;

function initialsOf(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

/**
 * Bir görsel kaynağını (resim / video / canvas) 400×400 kare JPEG dataURL'e
 * çevirir. Kısa kenardan kare crop yapar, 200KB altına inene dek quality düşürür.
 */
function sourceToResizedJpegDataUrl(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): string {
  if (!srcW || !srcH) throw new Error('Görsel boyutu okunamadı.');

  // Resize hesabı — kısa kenar 400px, kare crop
  const minDim = Math.min(srcW, srcH);
  const scale = MAX_DIM / minDim;
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = MAX_DIM;
  canvas.height = MAX_DIM;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas desteklenmiyor.');

  // Center crop
  const sx = (newW - MAX_DIM) / 2 / scale;
  const sy = (newH - MAX_DIM) / 2 / scale;
  const sw = MAX_DIM / scale;
  const sh = MAX_DIM / scale;

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, MAX_DIM, MAX_DIM);

  // Iteratif quality azaltma — 200KB altına insin
  let quality = 0.85;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let bytes = Math.floor(dataUrl.length * 0.75);

  while (bytes > MAX_SIZE_BYTES && quality > 0.4) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    bytes = Math.floor(dataUrl.length * 0.75);
  }

  if (bytes > MAX_SIZE_BYTES) {
    throw new Error('Dosya çok büyük, daha küçük bir resim seçin.');
  }

  return dataUrl;
}

async function fileToResizedJpegDataUrl(file: File): Promise<string> {
  // 1) FileReader → dataURL
  const orig = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });

  // 2) Image objesinde yükle
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Görsel açılamadı.'));
    i.src = orig;
  });

  // 3) Kare crop + resize + compress
  return sourceToResizedJpegDataUrl(img, img.width, img.height);
}

/** getUserMedia hatasını kullanıcı dostu Türkçe mesaja çevirir. */
function cameraErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Kamera izni reddedildi. Tarayıcı ayarlarından izin verip tekrar deneyin.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Kullanılabilir bir kamera bulunamadı.';
    case 'NotReadableError':
      return 'Kameraya erişilemiyor. Başka bir uygulama kullanıyor olabilir.';
    default:
      return 'Kamera başlatılamadı. Lütfen tekrar deneyin.';
  }
}

/**
 * Kameradan fotoğraf çekme modal'ı.
 *
 * Açılınca getUserMedia ile ön kamerayı başlatır, canlı önizleme gösterir.
 * "Fotoğraf çek" o anki kareyi dondurur; "Bu fotoğrafı kullan" tam çözünürlüklü
 * canvas'ı parent'a verir (parent resize + upload yapar). Modal kapanınca veya
 * unmount olunca kamera akışı durdurulur.
 */
function CameraCaptureModal({
  open,
  busy,
  onClose,
  onUse,
}: {
  open: boolean;
  /** Parent yükleme yapıyor — butonları kilitle. */
  busy: boolean;
  onClose: () => void;
  /** Çekilen kare — parent resize edip yükler. */
  onUse: (canvas: HTMLCanvasElement) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [shot, setShot] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);

  // Video elementi mount olunca akışı bağlar. Stream zaten hazırsa hemen bağlar,
  // değilse start() içinde bağlanır — iki sıralama da güvenli. Callback ref stabil
  // (useCallback []) olduğundan her render'da değil yalnız mount/unmount'ta çalışır.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // Kamera başlat / durdur — modal açılınca başlat, kapanınca/unmount'ta durdur.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);
    setStarting(true);
    setShot(null);

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Tarayıcınız kamera erişimini desteklemiyor. Güvenli (HTTPS) bağlantı gerekebilir.');
        setStarting(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => {});
        }
      } catch (err) {
        if (!cancelled) {
          setError(cameraErrorMessage(err));
          setStarting(false);
        }
      }
    }
    start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      // Sonraki açılış temiz başlasın — eski hata/çekim ekranı görünmesin.
      setError(null);
      setStarting(true);
      setShot(null);
    };
  }, [open]);

  if (!open) return null;

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Ayna görünümü — canlı önizlemeyle tutarlı olsun
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setShot({ canvas, url: canvas.toDataURL('image/jpeg', 0.9) });
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kameradan fotoğraf çek"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <div
        className="bg-white rounded-2xl shadow-kt-card max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-kt-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-kt-gold-700 font-bold">
              Profil fotoğrafı
            </div>
            <h2 className="text-xl font-extrabold text-kt-green-900">Kameradan çek</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-lg hover:bg-kt-gray-100 text-kt-gray-500 disabled:opacity-50"
            aria-label="Kapat"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="p-6">
          {/* Önizleme alanı — kare; kaydedilen fotoğrafla aynı kırpma. Video hep
              mount'lu kalır; hata / yükleniyor / çekim önizlemesi üst katmandır.
              Böylece srcObject capture/retake ya da yeniden açılışta kaybolmaz. */}
          <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-kt-green-950 ring-1 ring-kt-gray-200">
            <video
              ref={attachVideo}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={() => setStarting(false)}
              style={{ transform: 'scaleX(-1)' }}
              className="w-full h-full object-cover"
            />
            {shot && (
              <img
                src={shot.url}
                alt="Çekilen fotoğraf"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            {starting && !shot && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
                <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs font-semibold">Kamera başlatılıyor…</span>
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 gap-2 bg-kt-green-950">
                <svg className="w-10 h-10 text-kt-gold-400" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-sm text-white/90 font-medium">{error}</p>
              </div>
            )}
          </div>

          <p className="text-[10px] text-kt-gray-400 mt-2 text-center">
            Ortadaki kare alan profil fotoğrafı olur · 400×400 px · max 200 KB
          </p>

          <div className="flex gap-2 mt-4">
            {shot ? (
              <>
                <button
                  type="button"
                  onClick={() => setShot(null)}
                  disabled={busy}
                  className="flex-1 btn-ghost text-sm"
                >
                  Tekrar çek
                </button>
                <button
                  type="button"
                  onClick={() => onUse(shot.canvas)}
                  disabled={busy}
                  className="flex-1 btn-primary text-sm"
                >
                  {busy ? 'Yükleniyor…' : 'Bu fotoğrafı kullan'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="flex-1 btn-ghost text-sm"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={capture}
                  disabled={busy || starting || !!error}
                  className="flex-1 btn-primary text-sm"
                >
                  Fotoğraf çek
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ProfilePhotoUpload({ current, fullName, onChanged }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [hover, setHover] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/jpe?g$/i.test(file.type)) {
      toast.push('error', 'Yalnızca JPEG yükleyebilirsiniz.');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.push('error', 'Dosya 5MB üstü. Daha küçük bir resim seçin.');
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await fileToResizedJpegDataUrl(file);
      await api.setMyPhoto(dataUrl);
      onChanged(dataUrl);
      toast.push('success', 'Profil fotoğrafı güncellendi.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Yükleme başarısız.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleCameraUse(canvas: HTMLCanvasElement) {
    setUploading(true);
    try {
      const dataUrl = sourceToResizedJpegDataUrl(canvas, canvas.width, canvas.height);
      await api.setMyPhoto(dataUrl);
      onChanged(dataUrl);
      toast.push('success', 'Profil fotoğrafı güncellendi.');
      setCameraOpen(false);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Yükleme başarısız.');
    } finally {
      setUploading(false);
    }
  }

  async function handleClear() {
    setUploading(true);
    try {
      await api.clearMyPhoto();
      onChanged(null);
      toast.push('info', 'Profil fotoğrafı kaldırıldı.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative w-32 h-32 rounded-3xl overflow-hidden cursor-pointer group shadow-kt-soft ring-2 ring-kt-gold-300/40 hover:ring-kt-gold-400/70 transition-all"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => !uploading && fileRef.current?.click()}
      >
        {current ? (
          <img src={current} alt="Profil fotoğrafı" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-kt-green-700 via-kt-green-800 to-kt-green-950 flex items-center justify-center text-white text-3xl font-extrabold">
            {initialsOf(fullName)}
          </div>
        )}

        {/* Hover overlay */}
        <div
          className={`absolute inset-0 bg-gradient-to-t from-kt-green-950/85 via-kt-green-900/50 to-transparent flex flex-col items-center justify-end p-3 transition-opacity ${
            hover || uploading ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <svg className="w-7 h-7 text-white mb-1" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-white text-[11px] font-bold tracking-wider uppercase">
            {uploading ? 'Yükleniyor…' : 'Değiştir'}
          </span>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/jpg"
        className="hidden"
        onChange={handleFile}
      />

      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mt-3 text-xs">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-kt-gold-700 hover:text-kt-gold-800 font-semibold underline-offset-2 hover:underline disabled:opacity-50"
        >
          JPEG yükle
        </button>
        <span className="text-kt-gray-300">·</span>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={uploading}
          className="text-kt-gold-700 hover:text-kt-gold-800 font-semibold underline-offset-2 hover:underline disabled:opacity-50"
        >
          Kameradan çek
        </button>
        {current && (
          <>
            <span className="text-kt-gray-300">·</span>
            <button
              type="button"
              onClick={handleClear}
              disabled={uploading}
              className="text-rose-600 hover:text-rose-700 font-semibold underline-offset-2 hover:underline disabled:opacity-50"
            >
              Kaldır
            </button>
          </>
        )}
      </div>
      <p className="text-[10px] text-kt-gray-400 mt-1">Max 200 KB · JPEG veya kamera · 400×400 px'e küçültülür</p>

      <CameraCaptureModal
        open={cameraOpen}
        busy={uploading}
        onClose={() => !uploading && setCameraOpen(false)}
        onUse={handleCameraUse}
      />
    </div>
  );
}
