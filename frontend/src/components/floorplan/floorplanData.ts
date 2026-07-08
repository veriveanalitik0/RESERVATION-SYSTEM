/**
 * AI Lab kat planı (kroki) veri katmanı.
 *
 * Geometri kaynak-of-truth: Kroki projesi (main.html) — 2378×1642 plan pikseli.
 * Oda kimlikleri kroki kodlarıdır (CA-01..CA-19, TP-*, SS-*, OT-*, DN/ET/BH/MT/SL).
 *
 * klab eşlemesi SAYI kuralıyla yapılır: "AILAB -1D 4-2xNVD" → 4 → CA-04.
 * (Ad bazlı eşleme güvensiz: 12/16/17/18 no'lu odaların kroki adları eski.)
 * Görünen ad/cihaz/kapasite DAİMA klab DB'den gelir; krokideki CALISMA_INFO
 * yer tutucuları kullanılmaz.
 */
import type { Room } from '../../types';

export const KROKI_VIEWBOX = '0 0 2378 1642';

export type KrokiShape =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'poly'; pts: number[] };

export type KrokiCat =
  | 'calisma'
  | 'toplanti'
  | 'deneyim'
  | 'sistem'
  | 'oturma'
  | 'etkinlik'
  | 'bahce'
  | 'mutfak'
  | 'salon';

export interface KrokiRoomDef {
  id: string;
  cat: KrokiCat;
  s: KrokiShape;
  /** Sabit etiket (bilgi alanları için); rezerve edilebilir odalarda klab adı basılır. */
  lab?: string;
  /** Etiket font boyutu / rengi / konumu (kroki ile birebir). */
  ls?: number;
  lc?: string;
  lx?: number;
  ly?: number;
  /** Dolgusuz "plain" alan (ETKİNLİK/BAHÇE/MUTFAK/SALON). */
  plain?: boolean;
  /** İnce kontur (oturma bantları). */
  sw?: number;
}

const R = (x: number, y: number, w: number, h: number): KrokiShape => ({ t: 'rect', x, y, w, h });
const P = (...pts: number[]): KrokiShape => ({ t: 'poly', pts });

export const KROKI_CAT: Record<KrokiCat, { name: string; color: string }> = {
  calisma: { name: 'Çalışma Odası', color: '#23B14D' },
  toplanti: { name: 'Toplantı Odası', color: '#00A3E8' },
  deneyim: { name: 'Deneyim Alanı', color: '#9AD9EA' },
  sistem: { name: 'Sistem Odası', color: '#A349A3' },
  oturma: { name: 'Oturma Alanı', color: '#B97A57' },
  etkinlik: { name: 'Etkinlik Alanı', color: '#F2921C' },
  bahce: { name: 'Bahçe', color: '#4E9A51' },
  mutfak: { name: 'Mutfak', color: '#F2921C' },
  salon: { name: 'Salon', color: '#F2921C' },
};

/** Kroki geometrisi — main.html ROOMS dizisiyle birebir. */
export const KROKI_ROOMS: KrokiRoomDef[] = [
  { id: 'CA-01', cat: 'calisma', s: R(541, 40, 88, 154) },
  { id: 'CA-02', cat: 'calisma', s: R(638, 41, 91, 152) },
  { id: 'CA-03', cat: 'calisma', s: R(738, 40, 87, 154) },
  { id: 'CA-04', cat: 'calisma', s: R(494, 487, 187, 106) },
  { id: 'CA-05', cat: 'calisma', s: R(500, 1132, 185, 149) },
  { id: 'CA-06', cat: 'calisma', s: R(2181, 889, 133, 76) },
  { id: 'CA-07', cat: 'calisma', s: R(2181, 974, 133, 73) },
  { id: 'CA-08', cat: 'calisma', s: R(2181, 1056, 133, 79) },
  { id: 'CA-09', cat: 'calisma', s: R(2181, 1144, 133, 87) },
  // alt-orta açılı/oval kenarlı odalar — kesin kontur
  { id: 'CA-10', cat: 'calisma', s: P(870, 1340, 865, 1354, 865, 1364, 873, 1379, 1003, 1449, 1003, 1333, 881, 1333), lx: 938, ly: 1372 },
  { id: 'CA-11', cat: 'calisma', s: P(1012, 1333, 1200, 1333, 1205, 1339, 1205, 1445, 1192, 1458, 1023, 1457, 1013, 1454), lx: 1108, ly: 1396 },
  { id: 'CA-12', cat: 'calisma', s: P(1304, 1332, 1375, 1334, 1531, 1426, 1537, 1448, 1525, 1460, 1307, 1459, 1289, 1445, 1290, 1341), lx: 1408, ly: 1406 },
  { id: 'CA-13', cat: 'calisma', s: P(1784, 1334, 1850, 1333, 1865, 1343, 1865, 1445, 1849, 1460, 1628, 1461, 1619, 1453, 1618, 1433, 1624, 1425), lx: 1748, ly: 1406 },
  { id: 'CA-14', cat: 'calisma', s: R(1048, 1514, 143, 86) },
  { id: 'CA-15', cat: 'calisma', s: R(1200, 1514, 124, 86) },
  { id: 'CA-16', cat: 'calisma', s: R(1333, 1514, 135, 86) },
  { id: 'CA-17', cat: 'calisma', s: R(1545, 1514, 133, 86) },
  { id: 'CA-18', cat: 'calisma', s: R(1687, 1514, 124, 86) },
  { id: 'CA-19', cat: 'calisma', s: R(1820, 1514, 125, 86) },

  { id: 'TP-01', cat: 'toplanti', s: R(68, 486, 202, 233), lab: 'T' },
  { id: 'TP-02', cat: 'toplanti', s: R(279, 486, 205, 233), lab: 'T' },
  { id: 'TP-03', cat: 'toplanti', s: R(72, 1001, 198, 231), lab: 'T' },
  { id: 'TP-04', cat: 'toplanti', s: R(281, 1001, 207, 231), lab: 'T' },
  { id: 'TP-06', cat: 'toplanti', s: P(500, 1291, 682, 1291, 700, 1385, 828, 1521, 829, 1600, 500, 1600), lab: 'T', lx: 625, ly: 1470 },
  { id: 'TP-05', cat: 'toplanti', s: R(1956, 1370, 356, 230), lab: 'T' },

  { id: 'SS-01', cat: 'sistem', s: R(280, 330, 251, 147), lab: 'S' },
  { id: 'SS-02', cat: 'sistem', s: R(2182, 1240, 131, 117), lab: 'S' },

  { id: 'OT-01', cat: 'oturma', s: R(868, 421, 699, 53), lab: '', sw: 5 },
  { id: 'OT-02', cat: 'oturma', s: R(1477, 1514, 59, 86), lab: '', sw: 5 },

  { id: 'DN-01', cat: 'deneyim', s: R(1935, 40, 380, 839), lab: 'DENEYİM\nALANI', ls: 54, lc: '#1F2530', lx: 2125, ly: 400 },

  { id: 'ET-01', cat: 'etkinlik', s: R(1207, 40, 728, 438), lab: 'ETKİNLİK ALANI', ls: 56, lc: '#F2921C', plain: true, lx: 1571, ly: 205 },
  { id: 'BH-01', cat: 'bahce', s: R(1207, 478, 728, 746), lab: 'BAHÇE', ls: 80, lc: '#1F2530', plain: true, lx: 1571, ly: 880 },
  { id: 'MT-01', cat: 'mutfak', s: R(868, 478, 339, 238), lab: 'MUTFAK', ls: 50, lc: '#F2921C', plain: true, lx: 1037, ly: 600 },
  { id: 'SL-01', cat: 'salon', s: R(868, 716, 339, 508), lab: 'SALON', ls: 50, lc: '#F2921C', plain: true, lx: 1037, ly: 980 },
];

/** Kroki'deki durum noktalarının özel konumları (açılı odalar). */
export const KROKI_DOTPOS: Record<string, [number, number]> = {
  'CA-10': [988, 1350],
  'CA-11': [1190, 1349],
  'CA-12': [1322, 1352],
  'CA-13': [1842, 1352],
};

export function shapeCenter(s: KrokiShape): [number, number] {
  if (s.t === 'rect') return [s.x + s.w / 2, s.y + s.h / 2];
  let sx = 0;
  let sy = 0;
  const n = s.pts.length / 2;
  for (let i = 0; i < s.pts.length; i += 2) {
    sx += s.pts[i];
    sy += s.pts[i + 1];
  }
  return [sx / n, sy / n];
}

export function shapeBBox(s: KrokiShape): [number, number, number, number] {
  if (s.t === 'rect') return [s.x, s.y, s.x + s.w, s.y + s.h];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < s.pts.length; i += 2) {
    xs.push(s.pts[i]);
    ys.push(s.pts[i + 1]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * klab odası → kroki kimliği.
 * Pod kodu "AILAB -1D N-…" içindeki N sayısıyla CA-N'e bağlanır ("-1D" kat
 * belirteci ve "2xNVD" çarpanı yanlış yakalanmasın diye desen sabitlenmiştir).
 * Pod dışı türler tip üzerinden eşlenir (ada güvenmek kırılgan).
 */
export function krokiIdForRoom(room: Pick<Room, 'code' | 'roomType'>): string | null {
  if (room.roomType === 'experience') return 'DN-01';
  if (room.roomType === 'tribune') return 'ET-01';
  const m = room.code.match(/-1D\s+(\d+)-/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 19) return null;
  return `CA-${String(n).padStart(2, '0')}`;
}

/** rooms listesinden krokiId → Room haritası üretir. */
export function buildRoomIndex(rooms: Room[]): Map<string, Room> {
  const map = new Map<string, Room>();
  for (const room of rooms) {
    const id = krokiIdForRoom(room);
    if (id) map.set(id, room);
  }
  return map;
}

/** Rezerve edilemeyen kroki alanlarının bilgi kartı içerikleri (kroki metinleri). */
export interface KrokiInfoMeta {
  title: string;
  desc: string;
  rows: Array<[string, string]>;
  /** public/kroki altındaki görsel (yoksa placeholder gösterilir). */
  img?: string;
}

export const KROKI_INFO: Record<string, KrokiInfoMeta> = {
  'TP-01': tpMeta('TP-01'),
  'TP-02': tpMeta('TP-02'),
  'TP-03': tpMeta('TP-03'),
  'TP-04': tpMeta('TP-04'),
  'TP-05': tpMeta('TP-05'),
  'TP-06': tpMeta('TP-06'),
  'SS-01': {
    title: 'Sistem Odası',
    desc: 'Sunucu, ağ ve altyapı donanımının bulunduğu, erişimi sınırlı teknik oda.',
    rows: [['Tür', 'Sistem Odası'], ['Erişim', 'Yetkili personel'], ['İçerik', 'Sunucu & ağ donanımı']],
  },
  'SS-02': {
    title: 'Sistem Odası',
    desc: 'Sunucu, ağ ve altyapı donanımının bulunduğu, erişimi sınırlı teknik oda.',
    rows: [['Tür', 'Sistem Odası'], ['Erişim', 'Yetkili personel'], ['İçerik', 'Sunucu & ağ donanımı']],
    img: '/kroki/SS-02.jpg',
  },
  'OT-01': {
    title: 'Oturma Alanı',
    desc: 'Kısa molalar ve gündelik sohbetler için rahat oturma alanı.',
    rows: [['Tür', 'Oturma Alanı'], ['Kullanım', 'Mola & dinlenme']],
    img: '/kroki/OT-01.jpg',
  },
  'OT-02': {
    title: 'Oturma Alanı',
    desc: 'Kısa molalar ve gündelik sohbetler için rahat oturma alanı.',
    rows: [['Tür', 'Oturma Alanı'], ['Kullanım', 'Mola & dinlenme']],
    img: '/kroki/OT-02.jpg',
  },
  'MT-01': {
    title: 'Açık Mutfak',
    desc: 'Salonla bütünleşik açık mutfak; içecek ve atıştırmalık hazırlığı için.',
    rows: [['Tür', 'Açık Mutfak'], ['Kullanım', 'İkram & hazırlık']],
    img: '/kroki/MT-01.jpg',
  },
  'SL-01': {
    title: 'Salon',
    desc: 'Mutfakla bağlantılı, rahat oturma ve sosyalleşme salonu.',
    rows: [['Tür', 'Salon'], ['Kullanım', 'Ortak yaşam alanı']],
    img: '/kroki/SL-01.jpg',
  },
  'BH-01': {
    title: 'Bahçe',
    desc: 'Laboratuvarın merkezindeki açık bahçe; hava almak ve dinlenmek için.',
    rows: [['Tür', 'Bahçe'], ['Konum', 'Açık hava']],
  },
  'CA-19': {
    title: 'Oda 19',
    desc: 'Bu çalışma odası henüz randevu sistemine tanımlı değil.',
    rows: [['Tür', 'Çalışma Odası'], ['Durum', 'Sistem dışı']],
    img: '/kroki/CA-19.jpg',
  },
};

function tpMeta(id: string): KrokiInfoMeta {
  return {
    title: 'Toplantı Odası',
    desc: 'Ekip toplantıları, sunum ve görüşmeler için kapalı oda. Randevu sistemi kapsamında değildir.',
    rows: [['Tür', 'Toplantı Odası'], ['Kapasite', '6–8 kişi'], ['Donanım', 'Ekran + beyaz tahta']],
    img: `/kroki/${id}.jpg`,
  };
}

/** 2D/3D filtre çipleri — kroki ile aynı kategoriler. */
export interface FloorFilter {
  cats?: KrokiCat[];
  status?: 'available' | 'busy';
}

export const FILTER_CHIPS: Array<{ key: string; label: string; dot?: string; filter: FloorFilter | null }> = [
  { key: 'all', label: 'Tümü', filter: null },
  { key: 'calisma', label: 'Çalışma', dot: '#23B14D', filter: { cats: ['calisma'] } },
  { key: 'toplanti', label: 'Toplantı', dot: '#00A3E8', filter: { cats: ['toplanti'] } },
  { key: 'deneyim', label: 'Deneyim', dot: '#9AD9EA', filter: { cats: ['deneyim'] } },
  { key: 'sistem', label: 'Sistem', dot: '#A349A3', filter: { cats: ['sistem'] } },
  { key: 'oturma', label: 'Oturma', dot: '#B97A57', filter: { cats: ['oturma'] } },
  { key: 'ortak', label: 'Ortak', dot: '#F2921C', filter: { cats: ['etkinlik', 'bahce', 'mutfak', 'salon'] } },
  { key: 'st-available', label: 'Müsait', dot: '#10B981', filter: { status: 'available' } },
  { key: 'st-busy', label: 'Dolu', dot: '#f59e0b', filter: { status: 'busy' } },
];

/** Uygulama müsaitlik renkleri (kart görünümüyle tutarlı: emerald / amber). */
export const STATUS_COLORS = {
  available: '#10B981',
  busy: '#F59E0B',
  unknown: '#9CA3AF',
} as const;

export function roomStatus(room: Room | undefined): keyof typeof STATUS_COLORS {
  if (!room) return 'unknown';
  return room.isAvailable ? 'available' : 'busy';
}
