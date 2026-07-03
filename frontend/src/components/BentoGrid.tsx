/**
 * BentoGrid — asimetrik dashboard tile layout.
 *
 * Tasarım: 21st.dev "Bento Grid" referansı + Kuveyt Türk cyan/navy paleti.
 * Her tile farklı boyutta olabilir (col-span / row-span), hover'da yumuşak
 * lift effect. Sade dot-radial pattern hover'da görünür (AI feel — fakat
 * yumuşak, dökülmüş eski grad-orb değil).
 *
 * Kullanım:
 *   <BentoGrid>
 *     <BentoTile colSpan={2}>...</BentoTile>
 *     <BentoTile>...</BentoTile>
 *     <BentoTile rowSpan={2}>...</BentoTile>
 *   </BentoGrid>
 *
 * Veya helper variant ile:
 *   <BentoGrid>
 *     <BentoTile title="Talepler" meta="24" status="Live" tags={['inbox']}>
 *       <Icon />
 *     </BentoTile>
 *   </BentoGrid>
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface BentoGridProps {
  children: ReactNode;
  /** Default cols=3 (lg). Mobile: 1 col. */
  cols?: 2 | 3 | 4;
  className?: string;
}

const COL_CLS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
};

export function BentoGrid({ children, cols = 3, className = '' }: BentoGridProps) {
  return <div className={`grid ${COL_CLS[cols]} gap-3 ${className}`}>{children}</div>;
}

interface BentoTileProps {
  /** Kac kolon kaplar (1/2/3). Mobile'da hep 1. */
  colSpan?: 1 | 2 | 3;
  /** Hep aktif glow + dot pattern (vurgu tile için). */
  highlight?: boolean;
  /** Tile içine href verirsen tıklanabilir wrapper olur. */
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

const COLSPAN_CLS: Record<1 | 2 | 3, string> = {
  1: 'col-span-1',
  2: 'col-span-1 md:col-span-2',
  3: 'col-span-1 md:col-span-2 lg:col-span-3',
};

export function BentoTile({
  colSpan = 1,
  highlight = false,
  onClick,
  children,
  className = '',
}: BentoTileProps) {
  const interactive = onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-kt-soft' : '';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={`group relative overflow-hidden rounded-xl border border-kt-gray-100 bg-white p-5 text-left transition-all duration-300 will-change-transform ${interactive} ${COLSPAN_CLS[colSpan]} ${className}`}
    >
      {/* Dot pattern overlay — hover'da görünür (subtle AI feel). */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          highlight ? 'opacity-30' : 'opacity-0 group-hover:opacity-30'
        }`}
        style={{
          backgroundImage:
            'radial-gradient(circle at 2px 2px, rgba(111, 176, 44, 0.18) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
        aria-hidden
      />
      <div className="relative">{children}</div>
    </Tag>
  );
}

/** Pratik helper — title/meta/icon/status/tags ile prebuilt tile. */
interface BentoStatTileProps {
  icon: LucideIcon;
  title: string;
  meta?: string;
  description?: string;
  status?: string;
  tags?: string[];
  colSpan?: 1 | 2 | 3;
  highlight?: boolean;
  onClick?: () => void;
}

export function BentoStatTile({
  icon: Icon,
  title,
  meta,
  description,
  status,
  tags,
  colSpan = 1,
  highlight = false,
  onClick,
}: BentoStatTileProps) {
  return (
    <BentoTile colSpan={colSpan} highlight={highlight} onClick={onClick}>
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-kt-gold-100 text-kt-gold-700 group-hover:bg-kt-gold-200 transition-colors">
          <Icon size={18} />
        </div>
        {status && (
          <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-kt-gray-100 text-kt-gray-600 backdrop-blur-sm group-hover:bg-kt-gray-200 transition-colors uppercase tracking-wider">
            {status}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <h3 className="font-semibold text-kt-green-900 tracking-tight text-base">
          {title}
          {meta && (
            <span className="ml-2 text-xs text-kt-gray-500 font-normal tabular-nums">{meta}</span>
          )}
        </h3>
        {description && (
          <p className="text-sm text-kt-gray-600 leading-snug">{description}</p>
        )}
      </div>
      {tags && tags.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3 text-xs text-kt-gray-500 flex-wrap">
          {tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-md bg-kt-gray-100 group-hover:bg-kt-gold-50 transition-colors"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </BentoTile>
  );
}
