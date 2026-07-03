/**
 * EmptyState — boş liste / 404 / "henüz veri yok" durumları için.
 *
 * Tasarım: 21st.dev "Interactive Empty State" referansı + Kuveyt Türk
 * cyan/navy paleti. 3 lucide ikon staggered stack (-6° / 0° / +6°), hover'da
 * yelpaze açılır (CSS-only, framer-motion gerektirmez).
 *
 * Geriye uyumluluk: Eski API (icon='rooms', tone='cyan') korundu — her
 * `icon` semantic key'i 3 lucide ikonluk thematic stack'e map'lenir. Yeni
 * caller'lar isterse `icons={[Icon1, Icon2, Icon3]}` ile override edebilir.
 */
import type { ReactNode } from 'react';
import {
  Building2,
  DoorOpen,
  MapPin,
  Inbox,
  FileText,
  CalendarCheck,
  Clock,
  Users,
  ListOrdered,
  Image as ImageIcon,
  Star,
  Trophy,
  User,
  UserCheck,
  Archive,
  FileSearch,
  ScrollText,
  MessageSquare,
  Mail,
  MessagesSquare,
  Search,
  Filter,
  Eye,
  Award,
  Heart,
  BarChart3,
  TrendingUp,
  PieChart,
  Package,
  Tag,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';

export type EmptyStateIcon =
  | 'rooms'
  | 'bookings'
  | 'waitlist'
  | 'showcase'
  | 'users'
  | 'audit'
  | 'message'
  | 'search'
  | 'star'
  | 'data'
  | 'licenses';

type Tone = 'cyan' | 'gold' | 'rose' | 'violet';

interface Props {
  /** Semantic key — 3 thematic lucide ikona map'lenir. */
  icon?: EmptyStateIcon;
  /** Doğrudan 3 lucide ikon (icon prop'unu override eder). */
  icons?: LucideIcon[];
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: Tone;
}

/** Her semantic key 3 thematic lucide ikona map'lenir (orta-vurgulu sıra). */
const ICON_STACK: Record<EmptyStateIcon, LucideIcon[]> = {
  rooms:    [Building2, DoorOpen, MapPin],
  bookings: [Inbox, FileText, CalendarCheck],
  waitlist: [Clock, Users, ListOrdered],
  showcase: [ImageIcon, Star, Trophy],
  users:    [User, Users, UserCheck],
  audit:    [Archive, FileSearch, ScrollText],
  message:  [MessageSquare, Mail, MessagesSquare],
  search:   [Search, Filter, Eye],
  star:     [Star, Award, Heart],
  data:     [BarChart3, TrendingUp, PieChart],
  licenses: [Package, Tag, KeyRound],
};

const TONE_TILE: Record<Tone, string> = {
  cyan:   'text-kt-gold-600 border-kt-gold-200 group-hover:border-kt-gold-400 group-hover:text-kt-gold-700',
  gold:   'text-kt-gold-600 border-kt-gold-200 group-hover:border-kt-gold-400 group-hover:text-kt-gold-700',
  rose:   'text-rose-600 border-rose-200 group-hover:border-rose-400 group-hover:text-rose-700',
  violet: 'text-kt-violet-600 border-kt-violet-300 group-hover:border-kt-violet-500 group-hover:text-kt-violet-700',
};

const TONE_BORDER: Record<Tone, string> = {
  cyan:   'border-kt-gray-200 hover:border-kt-gold-400/50 hover:bg-kt-gold-50/30',
  gold:   'border-kt-gray-200 hover:border-kt-gold-400/50 hover:bg-kt-gold-50/30',
  rose:   'border-rose-200 hover:border-rose-300 hover:bg-rose-50/30',
  violet: 'border-kt-violet-200 hover:border-kt-violet-300 hover:bg-kt-violet-50/40',
};

export function EmptyState({
  icon = 'search',
  icons,
  title,
  description,
  action,
  tone = 'cyan',
}: Props) {
  const stack = (icons && icons.length >= 3 ? icons.slice(0, 3) : ICON_STACK[icon]);
  const [IconLeft, IconCenter, IconRight] = stack;
  const tile = `w-12 h-12 rounded-xl flex items-center justify-center bg-white border shadow-sm transition-all duration-300 ${TONE_TILE[tone]}`;

  return (
    <div
      className={`group rounded-2xl border-2 border-dashed text-center px-8 py-12 flex flex-col items-center justify-center transition-colors duration-200 bg-white ${TONE_BORDER[tone]}`}
    >
      {/* 3-icon staggered stack — hover'da yelpaze açılır */}
      <div className="relative flex justify-center isolate mb-6">
        <div
          className={`${tile} relative left-2 top-1 z-10 -rotate-6 group-hover:-translate-x-5 group-hover:-translate-y-1 group-hover:-rotate-[15deg] group-hover:scale-110`}
        >
          <IconLeft size={20} />
        </div>
        <div
          className={`${tile} relative z-20 group-hover:-translate-y-2 group-hover:scale-[1.12]`}
        >
          <IconCenter size={20} />
        </div>
        <div
          className={`${tile} relative right-2 top-1 z-10 rotate-6 group-hover:translate-x-5 group-hover:-translate-y-1 group-hover:rotate-[15deg] group-hover:scale-110`}
        >
          <IconRight size={20} />
        </div>
      </div>

      <h3 className="text-lg font-semibold text-kt-green-900 mb-1.5 tracking-tight">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-kt-gray-500 max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5 inline-block">{action}</div>}
    </div>
  );
}
