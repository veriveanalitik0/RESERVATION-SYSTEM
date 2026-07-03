/**
 * AILAB oda kart başlığı için modern AI / donanım temalı görsel.
 *
 *  - NVIDIA DGX SPARK pod'ları → gerçek NVIDIA DGX Spark Blackwell fotoğrafı +
 *    cyan/emerald tinted overlay (UserRooms gradient'i okunabilirliği sağlıyor).
 *  - MAC STUDIO pod'ları → gerçek Mac Studio fotoğrafı + slate tinted overlay.
 *  - AI Deneyim Alanı → workshop sahnesi SVG (ekran + figürler) — gerçek fotoğraf yok.
 *
 * Pod numarasından deterministic bir hue ofseti çıkararak her odanın görsel
 * varyasyonunu sağlıyoruz (aynı tip cihaz olsa bile her kart "kendi rengini"
 * koruyor).
 */
import type { Room } from '../types';

interface Props {
  room: Room;
  className?: string;
}

type Variant = 'nvidia' | 'mac' | 'workshop';

function variantFromEquipment(equipment: string | null | undefined): Variant {
  const eq = (equipment ?? '').toLowerCase();
  if (eq.includes('nvidia') || eq.includes('dgx')) return 'nvidia';
  if (eq.includes('mac')) return 'mac';
  return 'workshop';
}

/** Oda kodundan deterministik 0..1 değeri (renk varyasyonu için). */
function seedFromRoom(room: Room): number {
  const code = room.code ?? room.id ?? '';
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) | 0;
  return ((hash % 100) + 100) / 200;
}

const PALETTE_WORKSHOP = { from: '#3730A3', to: '#A855F7', accent: '#F0ABFC' };

export function RoomHeroVisual({ room, className = '' }: Props) {
  if (!room) return null;
  const variant = variantFromEquipment(room.equipment);

  if (variant === 'nvidia' || variant === 'mac') {
    return <PhotoHero variant={variant} className={className} />;
  }

  // Workshop: orijinal SVG
  const seed = seedFromRoom(room);
  const palette = PALETTE_WORKSHOP;
  const uid = (room.id ?? 'room').slice(0, 6);

  return (
    <svg
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.from} />
          <stop offset="100%" stopColor={palette.to} />
        </linearGradient>
        <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={palette.accent} stopOpacity="0.55" />
          <stop offset="100%" stopColor={palette.accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`spot-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="200" fill={`url(#bg-${uid})`} />
      <circle cx={70 + seed * 80} cy={40 + seed * 30} r="120" fill={`url(#glow-${uid})`} />
      <circle cx={320 - seed * 60} cy="160" r="100" fill={`url(#glow-${uid})`} opacity="0.6" />
      <circle cx={200} cy={100} r="160" fill={`url(#spot-${uid})`} />
      <g opacity="0.10" stroke={palette.accent} strokeWidth="0.4" fill="none">
        {Array.from({ length: 11 }).map((_, i) => (
          <line key={`v-${i}`} x1={i * 40} y1="0" x2={i * 40} y2="200" />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`h-${i}`} x1="0" y1={i * 40} x2="400" y2={i * 40} />
        ))}
      </g>
      <WorkshopArt palette={palette} />
    </svg>
  );
}

/* ============================================================
 * NVIDIA / MAC — gerçek fotoğraf + brand-coherent overlay
 * ============================================================
 * Görsel src'i public/images/ altında; brand vibe'ı korumak için her variant
 * kendi renk tinted overlay'ini ve hafif vinyetini taşır. UserRooms zaten alt
 * gradient + room code/title overlay'lerini ekliyor — burada sadece foto + tint.
 */
function PhotoHero({
  variant,
  className,
}: {
  variant: 'nvidia' | 'mac';
  className: string;
}) {
  const cfg =
    variant === 'nvidia'
      ? {
          src: '/images/nvidia-dgx-spark.jpg',
          alt: 'NVIDIA DGX Spark — Blackwell',
          // Emerald → cyan tint, NVIDIA brand vibe
          tint: 'linear-gradient(135deg, rgba(6,78,59,0.42) 0%, rgba(8,145,178,0.32) 60%, rgba(111, 176, 44,0.18) 100%)',
        }
      : {
          src: '/images/mac-studio.png',
          alt: 'Apple Mac Studio',
          // Slate + violet tint, Studio Pro vibe
          tint: 'linear-gradient(135deg, rgba(15,23,42,0.45) 0%, rgba(71,85,105,0.30) 55%, rgba(124,58,237,0.20) 100%)',
        };

  return (
    <div className={`${className} relative`} aria-hidden="true">
      <img
        src={cfg.src}
        alt={cfg.alt}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Brand-coherent tint */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: cfg.tint }}
      />
      {/* Hafif vinyet — okunabilirliği destekler */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(10,22,40,0.35) 100%)',
        }}
      />
    </div>
  );
}

/* ============================================================
 * AI DENEYİM ALANI — workshop sahnesi (gerçek foto yok)
 * ============================================================ */
function WorkshopArt({ palette }: { palette: { accent: string } }) {
  const { accent } = palette;
  return (
    <g transform="translate(200 100)">
      {/* Büyük ekran */}
      <rect x="-110" y="-65" width="220" height="80" rx="6" fill="#0F172A" stroke={accent} strokeWidth="2" />
      {/* Ekran içeriği — neural mesh */}
      <g stroke={accent} strokeWidth="1" opacity="0.7">
        <line x1="-90" y1="-45" x2="-50" y2="-30" />
        <line x1="-90" y1="-25" x2="-50" y2="-30" />
        <line x1="-90" y1="-25" x2="-50" y2="-5" />
        <line x1="-50" y1="-30" x2="-10" y2="-15" />
        <line x1="-50" y1="-5" x2="-10" y2="-15" />
        <line x1="-50" y1="-5" x2="-10" y2="10" />
        <line x1="-10" y1="-15" x2="30" y2="-10" />
        <line x1="-10" y1="10" x2="30" y2="-10" />
        <line x1="30" y1="-10" x2="70" y2="-20" />
        <line x1="30" y1="-10" x2="70" y2="5" />
      </g>
      {[
        [-90, -45],
        [-90, -25],
        [-50, -30],
        [-50, -5],
        [-10, -15],
        [-10, 10],
        [30, -10],
        [70, -20],
        [70, 5],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={accent} />
      ))}
      <circle cx="70" cy="5" r="5" fill={accent} />

      {/* Yer/masa zemini */}
      <rect x="-130" y="22" width="260" height="2" fill={accent} opacity="0.4" />

      {/* Katılımcı figürleri — silüet */}
      {[-95, -55, -15, 25, 65].map((x, i) => (
        <g key={i} transform={`translate(${x} 50)`}>
          <circle cx="0" cy="-26" r="5" fill={accent} opacity="0.85" />
          <path
            d="M -8 -20 Q 0 -22 8 -20 L 6 -2 L -6 -2 Z"
            fill={accent}
            opacity="0.7"
          />
        </g>
      ))}

      <text
        x="0"
        y="74"
        textAnchor="middle"
        fill={accent}
        fontSize="9"
        fontWeight="bold"
        fontFamily="monospace"
        letterSpacing="2"
      >
        AI DENEYİM ALANI
      </text>
    </g>
  );
}
