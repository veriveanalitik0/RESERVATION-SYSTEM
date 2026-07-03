/**
 * ⌘K Komut Paleti — global hızlı navigasyon + arama.
 *
 * Açma: ⌘K / Ctrl+K
 * Klavye: ↑↓ navigate, Enter seç, ESC kapat.
 *
 * Komut kaynakları:
 *  - Statik navigasyon (kullanıcı/admin'e göre)
 *  - Backend GET'leri: odalar, kullanıcı listesi (admin), kendi booking'leri
 *  - Aksiyonlar: çıkış yap, yeni booking
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import type { SubjectKind } from '../types';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: 'Navigasyon' | 'Aksiyonlar' | 'Odalar' | 'Taleplerim' | 'Kullanıcılar';
  keywords?: string;
  icon: 'nav' | 'room' | 'booking' | 'user' | 'action' | 'logout' | 'plus';
  onSelect: () => void | Promise<void>;
}

interface Props {
  kind: SubjectKind;
}

const USER_NAV: Array<{ label: string; path: string; hint: string }> = [
  { label: 'Odalar', path: '/rooms', hint: 'AI Lab odalarını görüntüle' },
  { label: 'Taleplerim', path: '/bookings', hint: 'Gönderdiğin talepler' },
  { label: 'Sıramda', path: '/waitlist', hint: 'Bekleme listesindeki kayıtların' },
  { label: 'Envanter', path: '/showcase', hint: 'Onaylanan projeler galerisi' },
  { label: 'Profilim', path: '/profile', hint: 'Profil ayarları' },
  { label: 'Gizlilik & Verilerim', path: '/privacy', hint: 'KVKK ihracı + silme' },
];

const ADMIN_NAV: Array<{ label: string; path: string; hint: string }> = [
  { label: 'Talepler', path: '/admin', hint: 'Tüm booking talepleri' },
  { label: 'Takvim', path: '/admin/calendar', hint: 'Aylık görünüm' },
  { label: 'Analiz', path: '/admin/analytics', hint: 'İstatistikler ve grafikler' },
  { label: 'Bekleme', path: '/admin/waitlist', hint: 'Waitlist kayıtları' },
  { label: 'Kullanıcılar', path: '/admin/users', hint: 'User yönetimi' },
  { label: 'Lisanslar', path: '/admin/licenses', hint: 'Cursor/Claude vb. lisans analizi' },
  { label: 'Audit', path: '/admin/audit', hint: 'Tüm güvenlik logları' },
  { label: 'Güvenlik', path: '/admin/security', hint: 'MFA ayarları' },
];

function iconFor(name: Command['icon']) {
  const common = { className: 'w-4 h-4', fill: 'none', stroke: 'currentColor', strokeWidth: '2', viewBox: '0 0 24 24' };
  switch (name) {
    case 'room':
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>;
    case 'booking':
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/></svg>;
    case 'user':
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>;
    case 'plus':
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>;
    case 'logout':
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>;
    case 'action':
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>;
    default:
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>;
  }
}

export function CommandPalette({ kind }: Props) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dynamicItems, setDynamicItems] = useState<Command[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Open/close shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (open && e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus input + reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Dinamik öğeleri çek (open olunca)
  const loadDynamic = useCallback(async () => {
    try {
      if (kind === 'user') {
        const [rooms, bookings] = await Promise.all([
          api.listUserRooms(),
          api.listUserBookings(),
        ]);
        const items: Command[] = [];
        for (const r of rooms.rooms) {
          items.push({
            id: `room-${r.id}`,
            label: `${r.code} · ${r.district} · ${r.neighborhood}`,
            hint: r.isAvailable ? 'Müsait' : 'Dolu',
            group: 'Odalar',
            keywords: `${r.code} ${r.district} ${r.neighborhood} ${r.name}`,
            icon: 'room',
            onSelect: () => navigate('/rooms'),
          });
        }
        for (const b of bookings.bookings.slice(0, 15)) {
          items.push({
            id: `book-${b.id}`,
            label: `${b.projectName}`,
            hint: `${b.roomCode} · ${b.status}`,
            group: 'Taleplerim',
            keywords: `${b.projectName} ${b.roomCode} ${b.roomName}`,
            icon: 'booking',
            onSelect: () => navigate('/bookings'),
          });
        }
        setDynamicItems(items);
      } else {
        const [bookings, users] = await Promise.all([
          api.listAdminBookings(),
          api.adminListUsers().catch(() => ({ users: [] as any[] })),
        ]);
        const items: Command[] = [];
        for (const b of bookings.bookings.slice(0, 30)) {
          items.push({
            id: `abk-${b.id}`,
            label: `${b.projectName}`,
            hint: `${b.userFullName ?? ''} · ${b.roomCode} · ${b.status}`,
            group: 'Taleplerim',
            keywords: `${b.projectName} ${b.userFullName} ${b.userEmail} ${b.roomCode}`,
            icon: 'booking',
            onSelect: () => navigate('/admin'),
          });
        }
        for (const u of users.users.slice(0, 30)) {
          items.push({
            id: `usr-${u.id}`,
            label: u.fullName,
            hint: u.email,
            group: 'Kullanıcılar',
            keywords: `${u.fullName} ${u.email} ${u.department ?? ''}`,
            icon: 'user',
            onSelect: () => navigate(`/u/${u.id}`),
          });
        }
        setDynamicItems(items);
      }
    } catch {
      // sessizce
    }
  }, [kind, navigate]);

  useEffect(() => {
    if (open) loadDynamic();
  }, [open, loadDynamic]);

  const allCommands: Command[] = useMemo(() => {
    const nav = (kind === 'user' ? USER_NAV : ADMIN_NAV).map(
      (n): Command => ({
        id: `nav-${n.path}`,
        label: n.label,
        hint: n.hint,
        group: 'Navigasyon',
        keywords: n.label.toLowerCase(),
        icon: 'nav',
        onSelect: () => navigate(n.path),
      })
    );
    const actions: Command[] = [
      ...(kind === 'user'
        ? [
            {
              id: 'act-new-booking',
              label: 'Yeni randevu al',
              hint: 'Müsait bir oda seç',
              group: 'Aksiyonlar' as const,
              icon: 'plus' as const,
              keywords: 'randevu yeni kirala booking',
              onSelect: () => navigate('/rooms'),
            },
          ]
        : []),
      {
        id: 'act-logout',
        label: 'Çıkış yap',
        hint: 'Oturumu sonlandır',
        group: 'Aksiyonlar' as const,
        icon: 'logout' as const,
        keywords: 'çıkış logout exit',
        onSelect: async () => {
          await logout(kind);
          navigate('/login', { replace: true });
        },
      },
    ];
    return [...nav, ...actions, ...dynamicItems];
  }, [kind, dynamicItems, logout, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter((c) => {
      const haystack = `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [allCommands, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  // activeIndex'i clamp
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIndex]);

  // Keyboard nav
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) {
        void cmd.onSelect();
        setOpen(false);
      }
    }
  }

  if (!open) return null;

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[10vh] animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-kt-gray-200 overflow-hidden ring-1 ring-kt-gold-400/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="px-4 py-3 border-b border-kt-gray-100 flex items-center gap-3">
          <svg className="w-5 h-5 text-kt-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Bir sayfa, oda, proje, kullanıcı ara..."
            className="flex-1 bg-transparent outline-none text-base text-kt-green-900 placeholder:text-kt-gray-400"
          />
          <kbd className="text-[10px] font-bold text-kt-gray-500 bg-kt-gray-100 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-kt-gray-500">
              Eşleşme yok.
            </div>
          ) : (
            groups.map(([group, items]) => (
              <div key={group}>
                <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-kt-gray-400 bg-kt-gray-50/50">
                  {group}
                </div>
                {items.map((cmd) => {
                  const idx = runningIndex++;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => {
                        void cmd.onSelect();
                        setOpen(false);
                      }}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                        isActive ? 'bg-kt-gold-50 text-kt-gold-900' : 'hover:bg-kt-gray-50 text-kt-green-900'
                      }`}
                    >
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          isActive ? 'bg-kt-gold-200 text-kt-gold-800' : 'bg-kt-gray-100 text-kt-gray-600'
                        }`}
                      >
                        {iconFor(cmd.icon)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{cmd.label}</div>
                        {cmd.hint && (
                          <div className="text-[11px] text-kt-gray-500 truncate">{cmd.hint}</div>
                        )}
                      </div>
                      {isActive && (
                        <kbd className="text-[10px] font-bold text-kt-gold-700 bg-kt-gold-100 px-1.5 py-0.5 rounded">
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-kt-gray-100 bg-kt-gray-50/40 flex items-center justify-between text-[10px] text-kt-gray-500">
          <div className="flex items-center gap-3">
            <span><kbd className="bg-white border border-kt-gray-200 px-1 rounded">↑</kbd> <kbd className="bg-white border border-kt-gray-200 px-1 rounded">↓</kbd> gez</span>
            <span><kbd className="bg-white border border-kt-gray-200 px-1 rounded">↵</kbd> seç</span>
          </div>
          <span><kbd className="bg-white border border-kt-gray-200 px-1 rounded">⌘ K</kbd> aç/kapat</span>
        </div>
      </div>
    </div>
  );
}
