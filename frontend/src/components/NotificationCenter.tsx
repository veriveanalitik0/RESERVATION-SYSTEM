/**
 * Bildirim Merkezi — header zil + popover.
 *
 * Veri kaynağı: AppShell'deki useNotificationsData hook'u (tek kaynak — menü
 * rozetleriyle paylaşılır). Bu component sadece sunum + popover etkileşimi
 * yapar; fetch/SSE/state hook'ta yaşar.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppNotification, NotificationCategory } from '../types';

interface Props {
  items: AppNotification[];
  unread: number;
  messageUnread: number;
  onMarkAllRead: () => void;
  onItemRead: (item: AppNotification) => void;
}

function fmtRelative(iso: string): string {
  const ms = new Date(iso).getTime();
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'az önce';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} dk önce`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} sa önce`;
  return new Date(ms).toLocaleDateString('tr-TR');
}

export function NotificationCenter({
  items,
  unread,
  messageUnread,
  onMarkAllRead,
  onItemRead,
}: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Click outside → kapat
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  // ESC ile kapat
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const totalUnread = unread + messageUnread;
  const hasAny = items.length > 0 || totalUnread > 0;

  function clickItem(item: AppNotification) {
    onItemRead(item);
    if (item.link) navigate(item.link);
    setOpen(false);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-kt-gold-300 transition-colors"
        aria-label={totalUnread > 0 ? `Bildirimler, ${totalUnread} okunmamış` : 'Bildirimler'}
        title="Bildirimler"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-panel"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {totalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center px-1 ring-2 ring-kt-green-950">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notification-panel"
          role="dialog"
          aria-label="Bildirimler"
          className="absolute right-0 mt-2 w-[360px] max-h-[500px] rounded-2xl bg-white shadow-2xl border border-kt-gray-200 overflow-hidden flex flex-col z-50 animate-fade-in"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-kt-gray-100 flex items-center justify-between bg-gradient-to-r from-kt-green-50 to-white">
            <div>
              <h3 className="font-bold text-kt-green-900 text-sm">Bildirimler</h3>
              {totalUnread > 0 && (
                <div className="text-[10px] text-kt-gray-500">{totalUnread} okunmamış</div>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={onMarkAllRead}
                className="text-[11px] text-kt-green-700 hover:text-kt-gold-700 font-semibold"
              >
                Hepsini okundu yap
              </button>
            )}
          </div>

          {/* Body */}
          {!hasAny ? (
            <div className="p-8 text-center text-sm text-kt-gray-500">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-kt-gray-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-kt-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>Bildirim yok</div>
              <div className="text-[10px] text-kt-gray-400 mt-1">
                Talep değişimleri ve onaylar burada görünür.
              </div>
            </div>
          ) : (
            <div className="overflow-y-auto scrollbar-thin flex-1">
              {messageUnread > 0 && (
                <div className="px-4 py-2 bg-kt-gold-50 border-b border-kt-gold-100 text-xs text-kt-gold-800">
                  <strong>{messageUnread}</strong> okunmamış sohbet mesajı var.
                  <button
                    onClick={() => {
                      navigate('/sohbet');
                      setOpen(false);
                    }}
                    className="ml-2 font-bold underline"
                  >
                    Aç
                  </button>
                </div>
              )}
              {items.length === 0 ? (
                <div className="p-6 text-center text-xs text-kt-gray-400">
                  Kalıcı bildirim yok.
                </div>
              ) : (
                <ul>
                  {items.map((it) => (
                    <li key={it.id}>
                      <button
                        onClick={() => clickItem(it)}
                        className={`w-full text-left px-4 py-3 border-b border-kt-gray-50 hover:bg-kt-gray-50 transition-colors flex items-start gap-3 ${
                          !it.read ? 'bg-kt-gold-50/30' : ''
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            it.category === 'message'
                              ? 'bg-blue-100 text-blue-700'
                              : it.category === 'booking'
                              ? 'bg-kt-gold-100 text-kt-gold-700'
                              : it.category === 'waitlist'
                              ? 'bg-emerald-100 text-emerald-700'
                              : it.category === 'license'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-kt-gray-100 text-kt-gray-600'
                          }`}
                        >
                          <NotifyIcon category={it.category} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-kt-green-900 flex items-center gap-1.5">
                            <span className="truncate">{it.title}</span>
                            {!it.read && (
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                            )}
                          </div>
                          <div className="text-xs text-kt-gray-500 line-clamp-2">{it.body}</div>
                          <div className="text-[10px] text-kt-gray-400 mt-0.5">
                            {fmtRelative(it.createdAt)}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotifyIcon({ category }: { category: NotificationCategory }) {
  const common = {
    className: 'w-4 h-4',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2',
    viewBox: '0 0 24 24',
  };
  if (category === 'message')
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    );
  if (category === 'booking')
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    );
  if (category === 'waitlist')
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  if (category === 'license')
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
