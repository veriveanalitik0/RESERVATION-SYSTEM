/**
 * İnteraktif AI Lab krokisi — oda seçimi için 2D plan + 3D maket.
 *
 * Rezerve edilebilir odalar (klab DB'de karşılığı olanlar) canlı müsaitlik
 * rengiyle işaretlenir ve tıklanınca `onRoomSelect` ile dışarı verilir
 * (UserRooms bunu RoomDetailModal'a bağlar). Sistem dışı alanlar (toplantı
 * odaları, mutfak, salon vb.) bilgi kartı açar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Room } from '../../types';
import {
  FILTER_CHIPS,
  KROKI_CAT,
  KROKI_DOTPOS,
  KROKI_INFO,
  KROKI_ROOMS,
  KROKI_TP_INFO,
  KROKI_VIEWBOX,
  STATUS_COLORS,
  buildRoomIndex,
  roomStatus,
  shapeBBox,
  shapeCenter,
  type FloorFilter,
  type KrokiRoomDef,
} from './floorplanData';
import type { Floor3DHandle } from './floorplan3d';
import './floorplan.css';

interface Props {
  rooms: Room[];
  /** Rezerve edilebilir bir odaya tıklanınca (detay modalını açar). */
  onRoomSelect: (room: Room) => void;
  /** Aktif tarih filtresi etiketi (müsaitliğin hangi aralığa ait olduğunu gösterir). */
  rangeLabel?: string;
}

type ViewMode = '2d' | '3d';

const STATUS_LABEL: Record<'available' | 'busy' | 'unknown', string> = {
  available: 'Müsait',
  busy: 'Dolu',
  unknown: 'Sistem dışı',
};

export default function RoomFloorPlan({ rooms, onRoomSelect, rangeLabel }: Props) {
  const [filterKey, setFilterKey] = useState('all');
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<ViewMode>('2d');
  const [switching, setSwitching] = useState(false);
  const [infoAreaId, setInfoAreaId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tip, setTip] = useState<{ text: string; sub?: string; x: number; y: number } | null>(null);

  const roomIndex = useMemo(() => buildRoomIndex(rooms), [rooms]);
  const roomIndexRef = useRef(roomIndex);
  roomIndexRef.current = roomIndex;

  const filter: FloorFilter | null = useMemo(
    () => FILTER_CHIPS.find((c) => c.key === filterKey)?.filter ?? null,
    [filterKey],
  );

  const matches = useCallback(
    (def: KrokiRoomDef): boolean => {
      if (!filter) return true;
      if (filter.cats) return filter.cats.includes(def.cat);
      const mapped = roomIndex.get(def.id);
      if (!mapped) return false;
      return filter.status === 'available' ? mapped.isAvailable : !mapped.isAvailable;
    },
    [filter, roomIndex],
  );

  // Kroki footer istatistikleri — yalnız sisteme bağlı odalar üzerinden.
  const stats = useMemo(() => {
    const mapped = [...roomIndex.values()];
    const avail = mapped.filter((r) => r.isAvailable).length;
    const computers = mapped.filter((r) => r.roomType === 'pod').reduce((a, r) => a + r.capacity, 0);
    return { total: mapped.length, avail, busy: mapped.length - avail, computers };
  }, [roomIndex]);

  const handleRoomActivate = useCallback(
    (def: KrokiRoomDef) => {
      const mapped = roomIndexRef.current.get(def.id);
      setSelectedId(def.id);
      setTip(null); // dokunmatikte tooltip modalın üstünde asılı kalmasın
      if (mapped) onRoomSelect(mapped);
      else setInfoAreaId(def.id);
    },
    [onRoomSelect],
  );

  // Bilgi kartı: Escape ile kapanır, açılınca odak Kapat düğmesine gider.
  const infoCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!infoAreaId) return;
    infoCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInfoAreaId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoAreaId]);

  // ---------- 3D görünüm ----------
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<Floor3DHandle | null>(null);
  const filterRef = useRef<FloorFilter | null>(filter);
  filterRef.current = filter;

  const statusColorOf = useCallback((krokiId: string) => {
    return STATUS_COLORS[roomStatus(roomIndexRef.current.get(krokiId))];
  }, []);
  // roomIndex bağımlılığı bilinçli: canlı müsaitlik değişince kimliği değişsin
  // ki applyFilter effect'i yeniden tetiklensin (durum filtresi bayatlamasın).
  const isBusy = useCallback(
    (krokiId: string): boolean | null => {
      const room = roomIndex.get(krokiId);
      return room ? !room.isAvailable : null;
    },
    [roomIndex],
  );
  const tipTextOf = useCallback((krokiId: string) => {
    const mapped = roomIndexRef.current.get(krokiId);
    if (mapped) return `${mapped.name} · ${mapped.equipment} — ${mapped.isAvailable ? 'Müsait' : 'Dolu'}`;
    const def = KROKI_ROOMS.find((r) => r.id === krokiId);
    return KROKI_INFO[krokiId]?.title ?? (def ? KROKI_CAT[def.cat].name : krokiId);
  }, []);
  const handleRoomActivateRef = useRef(handleRoomActivate);
  handleRoomActivateRef.current = handleRoomActivate;

  const enter3D = useCallback(async () => {
    if (switching || mode === '3d') return;
    setSwitching(true);
    setMode('3d');
    try {
      const { buildFloor3D } = await import('./floorplan3d');
      // Konteyner render edilsin diye bir kare bekle.
      await new Promise((r) => requestAnimationFrame(r));
      const el = containerRef.current;
      if (!el) return;
      if (!handleRef.current) {
        // 3D etiketleri: sisteme bağlı odalarda klab adı; diğer alanlarda tür
        // adı — adlandırılmış toplantı odaları kroki adıyla (TP_INFO) ezilir.
        const labels: Record<string, string> = {
          'TP-01': 'Toplantı', 'TP-02': 'Toplantı', 'TP-03': 'Toplantı',
          'TP-04': 'Toplantı', 'TP-05': 'Toplantı', 'TP-06': 'Toplantı',
          'SS-01': 'Sistem', 'SS-02': 'Sistem',
          'MT-01': 'Mutfak', 'SL-01': 'Salon', 'BH-01': 'Bahçe',
          ...KROKI_TP_INFO,
        };
        for (const [kid, room] of roomIndexRef.current) labels[kid] = room.name;
        handleRef.current = buildFloor3D(el, {
          statusColorOf,
          tipTextOf,
          labels,
          onRoomClick: (krokiId) => {
            const def = KROKI_ROOMS.find((r) => r.id === krokiId);
            if (def) handleRoomActivateRef.current(def);
          },
        });
      }
      const h = handleRef.current;
      h.refreshStatus();
      h.applyFilter(filterRef.current, isBusy);
      h.setPose(0);
      h.resize();
      h.start();
      h.morphTo(1, 880, () => setSwitching(false));
    } catch (err) {
      // three yüklenemedi (ör. çevrimdışı) veya WebGL yok — 2D'ye geri dön.
      console.error('[kroki] 3D görünüm başlatılamadı:', err);
      // Yarım kalmış kurulum artığı (öksüz canvas/WebGL bağlamı) bırakma.
      if (!handleRef.current && containerRef.current) containerRef.current.innerHTML = '';
      setMode('2d');
      setSwitching(false);
    }
  }, [switching, mode, statusColorOf, tipTextOf, isBusy]);

  const exit3D = useCallback(() => {
    if (switching || mode === '2d') return;
    const h = handleRef.current;
    if (!h) {
      setMode('2d');
      return;
    }
    setSwitching(true);
    h.morphTo(0, 880, () => {
      h.stop();
      setMode('2d');
      setSwitching(false);
    });
  }, [switching, mode]);

  // Canlı müsaitlik/filtre değişimlerini 3D'ye yansıt (isBusy roomIndex ile
  // birlikte değiştiğinden durum filtresi de canlı veriyle yeniden uygulanır).
  useEffect(() => {
    handleRef.current?.refreshStatus();
  }, [roomIndex]);
  useEffect(() => {
    handleRef.current?.applyFilter(filter, isBusy);
  }, [filter, isBusy]);
  // Unmount: GPU kaynaklarını bırak.
  useEffect(
    () => () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    },
    [],
  );

  // Varsayılan görünüm 3D: kroki açılır açılmaz maket yükselir (WebGL yoksa
  // enter3D kendi içinde 2D'ye düşer). Yalnız ilk mount'ta çalışır.
  const autoEnteredRef = useRef(false);
  useEffect(() => {
    if (autoEnteredRef.current) return;
    autoEnteredRef.current = true;
    void enter3D();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 2D tooltip ----------
  const showTip = useCallback((e: React.MouseEvent, def: KrokiRoomDef) => {
    const mapped = roomIndexRef.current.get(def.id);
    const text = mapped ? `${mapped.name} · ${mapped.equipment}` : KROKI_INFO[def.id]?.title ?? KROKI_CAT[def.cat].name;
    const sub = mapped ? (mapped.isAvailable ? 'Müsait' : 'Dolu') : undefined;
    setTip({ text, sub, x: e.clientX, y: e.clientY });
  }, []);

  const dimmed = filter !== null;
  const infoMeta = infoAreaId ? KROKI_INFO[infoAreaId] : null;

  return (
    <div className="fp-panel" data-testid="floorplan">
      {/* üst çubuk: filtreler + görünüm + zoom */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#164836]">
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="fp-chip"
              aria-pressed={filterKey === chip.key}
              onClick={() => setFilterKey(filterKey === chip.key ? 'all' : chip.key)}
            >
              {chip.dot && <span className="fp-dot" style={{ background: chip.dot }} />}
              {chip.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {mode === '2d' && (
            <div className="flex items-center gap-1">
              <button type="button" className="fp-zbtn" aria-label="Uzaklaştır" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                −
              </button>
              <span className="fp-zlabel">%{Math.round(zoom * 100)}</span>
              <button type="button" className="fp-zbtn" aria-label="Yakınlaştır" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                +
              </button>
            </div>
          )}
          <div className="flex items-center gap-1 rounded-xl border border-[#215E47] p-1">
            <button
              type="button"
              className="fp-chip !border-0"
              aria-pressed={mode === '2d'}
              disabled={switching}
              onClick={exit3D}
            >
              2D Plan
            </button>
            <button
              type="button"
              className="fp-chip !border-0"
              aria-pressed={mode === '3d'}
              disabled={switching}
              onClick={enter3D}
            >
              3D Maket
            </button>
          </div>
        </div>
      </div>

      {/* istatistik satırı */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs text-[#9DC1AE] border-b border-[#164836]">
        <span>
          <b className="text-white">{stats.total}</b> sistemli oda
        </span>
        <span className="text-emerald-400">
          <b>{stats.avail}</b> müsait
        </span>
        <span className="text-amber-400">
          <b>{stats.busy}</b> dolu
        </span>
        <span>
          <b className="text-white">{stats.computers}</b> bilgisayar
        </span>
        {rangeLabel && <span className="ml-auto text-[#6E9683]">Müsaitlik: {rangeLabel}</span>}
      </div>

      {/* 2D plan */}
      <div className="fp-stage" style={{ display: mode === '2d' ? 'block' : 'none' }}>
        <div className="fp-canvas" style={{ width: `${zoom * 100}%` }}>
          <div className="fp-sheet">
            {/* role="img" verilmez: içindeki odalar ekran okuyucular için
                etkileşimli butonlardır; img rolü onları sunumsal yapardı. */}
            <svg viewBox={KROKI_VIEWBOX} preserveAspectRatio="xMidYMid meet" aria-label="Yapay Zeka Laboratuvarı kat planı">
              <rect x="0" y="0" width="2378" height="1642" fill="#FAF8F2" />

              {/* iç duvarlar */}
              <path className="fp-iwall" d="M1207,478 L1935,478" />
              <path className="fp-dwall" d="M1207,34 L1207,478" />
              <path className="fp-iwall" d="M1207,478 L1207,1224 M1935,478 L1935,1224 M1207,1224 L1935,1224" />
              <path className="fp-dwall" d="M868,478 L868,1224" />
              <path className="fp-dwall" d="M876,478 L1200,478" />
              <path className="fp-dwall" d="M876,1224 L1200,1224" />
              <path className="fp-dwall" d="M868,716 L1122,716" />

              {/* dış duvar (Giriş 1 solda, Giriş 2 üstte boşluklu) */}
              <path
                className="fp-wall"
                d="M57,478 L57,725 M57,992 L57,1242 L489,1242 L491,1614 L837,1614 L838,1580 L1039,1580 L1040,1614 L2326,1613 L2321,29 L1141,29 M1015,29 L533,29 L532,321 L272,321 L271,478 L57,478"
              />

              <rect className="fp-col" x="448" y="824" width="57" height="69" rx="3" />
              <rect className="fp-col" x="820" y="812" width="51" height="107" rx="3" />

              <text className="fp-gtext" x="42" y="862" fontSize="52">
                Giriş 1
              </text>
              <text className="fp-gtext" x="1013" y="118" fontSize="52">
                Giriş 2
              </text>

              <g className={`fp-rooms${dimmed ? ' fp-dim' : ''}`}>
                {KROKI_ROOMS.map((def) => (
                  <FloorRoom
                    key={def.id}
                    def={def}
                    room={roomIndex.get(def.id)}
                    on={matches(def)}
                    selected={selectedId === def.id}
                    onActivate={() => handleRoomActivate(def)}
                    onHover={(e) => showTip(e, def)}
                    onLeave={() => setTip(null)}
                  />
                ))}
              </g>
            </svg>
          </div>
        </div>
      </div>

      {/* 3D maket */}
      <div
        ref={containerRef}
        className="fp-3d"
        style={{ display: mode === '3d' ? 'block' : 'none', aspectRatio: '2378 / 1400' }}
        aria-label="3D maket görünümü"
      />

      {/* 2D tooltip */}
      {tip && (
        <div
          className="fp-tip on"
          style={{
            left: Math.min(tip.x + 14, window.innerWidth - 240),
            top: Math.min(tip.y + 16, window.innerHeight - 60),
          }}
        >
          {tip.text}
          {tip.sub && <small>{tip.sub}</small>}
        </div>
      )}

      {/* sistem dışı alan bilgi kartı */}
      {infoMeta &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-label={infoMeta.title}
            onClick={() => setInfoAreaId(null)}
          >
            <div className="bg-white rounded-2xl shadow-kt-card max-w-sm w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {infoMeta.img && (
                <img
                  src={infoMeta.img}
                  alt={infoMeta.title}
                  className="w-full h-44 object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="p-5">
                <h3 className="text-lg font-bold text-kt-green-900 mb-1">{infoMeta.title}</h3>
                <p className="text-sm text-kt-gray-500 mb-4">{infoMeta.desc}</p>
                <dl className="space-y-1.5 mb-5">
                  {infoMeta.rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm">
                      <dt className="text-kt-gray-500">{k}</dt>
                      <dd className="font-semibold text-kt-green-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-kt-gray-400 mb-4">Bu alan randevu sistemi kapsamında değildir.</p>
                <button ref={infoCloseRef} type="button" className="btn-secondary w-full" onClick={() => setInfoAreaId(null)}>
                  Kapat
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ---------- tek oda (SVG) ---------- */

interface FloorRoomProps {
  def: KrokiRoomDef;
  room: Room | undefined;
  on: boolean;
  selected: boolean;
  onActivate: () => void;
  onHover: (e: React.MouseEvent) => void;
  onLeave: () => void;
}

function FloorRoom({ def, room, on, selected, onActivate, onHover, onLeave }: FloorRoomProps) {
  const cat = KROKI_CAT[def.cat];
  const status = roomStatus(room);
  const [cx, cy] = shapeCenter(def.s);
  const [bx0, by0, bx1] = shapeBBox(def.s);
  const lx = def.lx ?? cx;
  const ly = def.ly ?? cy;

  const shape =
    def.s.t === 'rect' ? (
      <rect className="fp-shape" x={def.s.x} y={def.s.y} width={def.s.w} height={def.s.h} rx={6} fill={def.plain ? 'transparent' : cat.color} style={def.sw ? { strokeWidth: def.sw } : undefined} />
    ) : (
      <polygon className="fp-shape" points={def.s.pts.join(' ')} fill={def.plain ? 'transparent' : cat.color} />
    );

  // Etiket: sisteme bağlı odada klab adı; değilse kroki etiketi.
  let label: React.ReactNode = null;
  if (room) {
    if (def.cat === 'calisma') {
      const W = bx1 - bx0;
      const H = shapeBBox(def.s)[3] - by0;
      const L = room.name.length || 1;
      const size = Math.max(12, Math.min((W - 16) / (L * 0.58), H * 0.5, 28));
      label = (
        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={size.toFixed(1)} fill="#0E2117">
          {room.name}
        </text>
      );
    } else if (def.lab) {
      label = <MultilineLabel def={def} lx={lx} ly={ly} />;
    }
  } else if (def.cat === 'toplanti' && KROKI_TP_INFO[def.id]) {
    // Adlandırılmış toplantı odası: "T" yerine kroki adı (main.html TP_INFO
    // dalıyla aynı font formülü, oda genişliğine sığacak şekilde).
    const name = KROKI_TP_INFO[def.id];
    const W = bx1 - bx0;
    const H = shapeBBox(def.s)[3] - by0;
    const size = Math.max(12, Math.min((W - 16) / (name.length * 0.58), H * 0.4, 34));
    label = (
      <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={size.toFixed(1)} fill="#0e2a34">
        {name}
      </text>
    );
  } else if (def.lab) {
    label = <MultilineLabel def={def} lx={lx} ly={ly} />;
  }

  // Durum noktası: yalnız sisteme bağlı odalarda (canlı müsaitlik).
  const dot = room ? KROKI_DOTPOS[def.id] ?? [bx1 - 16, by0 + 16] : null;

  const ariaLabel = room
    ? `${room.name}, ${STATUS_LABEL[status]}, ${room.equipment}`
    : `${KROKI_INFO[def.id]?.title ?? cat.name} (bilgi)`;

  return (
    <g
      className={`fp-room${def.plain ? ' fp-plain' : ''}${on ? ' fp-on' : ''}${selected ? ' fp-sel' : ''}`}
      data-kroki-id={def.id}
      data-bookable={room ? 'true' : 'false'}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      onMouseMove={onHover}
      onMouseLeave={onLeave}
    >
      {shape}
      {label}
      {dot && <circle cx={dot[0]} cy={dot[1]} r={11} fill={STATUS_COLORS[status]} stroke="#ffffff" strokeWidth={3.5} />}
    </g>
  );
}

function MultilineLabel({ def, lx, ly }: { def: KrokiRoomDef; lx: number; ly: number }) {
  const lines = (def.lab ?? '').split('\n');
  if (!lines[0]) return null;
  const size = def.ls ?? 88;
  return (
    <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={size} fill={def.lc ?? '#141a22'}>
      {lines.map((ln, i) => (
        <tspan key={ln} x={lx} dy={i === 0 ? `${-(lines.length - 1) * 0.55}em` : '1.1em'}>
          {ln}
        </tspan>
      ))}
    </text>
  );
}
