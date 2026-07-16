/**
 * Genel Sohbet — `/sohbet`
 *
 * Rol-bağımsız 1:1 mesajlaşma: admin, danışman, ar-ge ve kullanıcı serbestçe
 * yazışır. Sol panelde kişi listesi (arama + son mesaj + okunmamış rozeti),
 * sağ panelde aktif konuşma. SSE ile anlık teslim.
 *
 * Tasarım: chat-template yapısı (sol liste + sağ pencere) bizim cyan/navy
 * paletimiz, role-badge ve btn-pill diliyle yeniden çizildi — yeni bağımlılık yok.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { FEATURES } from '../constants/features';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { ChatContact, ChatMessage, SubjectKind, Visual } from '../types';

/* Rol etiketine göre avatar tonu — sade, paletten. */
const ROLE_TONE: Record<string, { bg: string; text: string; ring: string }> = {
  Yönetici: { bg: 'bg-kt-green-900', text: 'text-white', ring: 'ring-kt-green-200' },
  'Analitik Danışman': { bg: 'bg-cyan-100', text: 'text-cyan-800', ring: 'ring-cyan-200' },
  'YZ / Ar-Ge': { bg: 'bg-violet-100', text: 'text-violet-800', ring: 'ring-violet-200' },
  Kullanıcı: { bg: 'bg-kt-gray-200', text: 'text-kt-gray-700', ring: 'ring-kt-gray-200' },
};
function toneFor(roleLabel: string) {
  return ROLE_TONE[roleLabel] ?? ROLE_TONE.Kullanıcı;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function fmtTime(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}
function fmtRelative(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'az önce';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} dk`;
  if (diff < 86_400_000) return fmtTime(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

export default function Chat() {
  const auth = useAuth();
  const toast = useToast();

  // Aktif oturumun kind'ı — tek oturum aktif olur (single-session).
  const kind: SubjectKind = useMemo(() => {
    if (auth.admin) return 'admin';
    if (auth.danisman) return 'danisman';
    if (auth.arge) return 'arge';
    return 'user';
  }, [auth.admin, auth.danisman, auth.arge]);

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);

  // Sohbet arka plan teması (kullanıcının seçtiği görsel) — yalnız 'user' kind.
  const [chatBg, setChatBg] = useState<string | null>(null);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [myVisuals, setMyVisuals] = useState<Visual[]>([]);
  const [visualsLoading, setVisualsLoading] = useState(false);
  const [savingBg, setSavingBg] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const activeContact = useMemo(
    () => contacts.find((c) => c.id === activeId) ?? null,
    [contacts, activeId]
  );

  const loadContacts = useCallback(async () => {
    try {
      const res = await api.chatContacts(kind);
      setContacts(res.contacts);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Kişiler yüklenemedi.');
    } finally {
      setLoadingContacts(false);
    }
  }, [kind, toast]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  // Sohbet temasını yükle (yalnız 'user' kind — /user/profile erişimi).
  useEffect(() => {
    if (kind !== 'user') return;
    let active = true;
    api
      .getProfile()
      .then((r) => {
        if (active) setChatBg(r.profile.chatBackgroundUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [kind]);

  async function openThemePicker() {
    setShowThemePicker(true);
    if (myVisuals.length === 0) {
      setVisualsLoading(true);
      try {
        const res = await api.listMyVisuals();
        setMyVisuals(res.visuals.filter((v) => v.imageUrl));
      } catch (err) {
        toast.push('error', (err as Error).message || 'Görseller yüklenemedi.');
      } finally {
        setVisualsLoading(false);
      }
    }
  }

  async function applyChatBg(visualId: string | null) {
    setSavingBg(true);
    try {
      const res = await api.setChatBackground(visualId);
      setChatBg(res.chatBackgroundUrl);
      setShowThemePicker(false);
      toast.push('success', visualId ? 'Sohbet teması ayarlandı.' : 'Tema kaldırıldı.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Tema ayarlanamadı.');
    } finally {
      setSavingBg(false);
    }
  }

  // Aktif konuşmayı yükle + okundu işaretle.
  const openConversation = useCallback(
    async (contactId: string) => {
      setActiveId(contactId);
      activeIdRef.current = contactId;
      setLoadingThread(true);
      try {
        const res = await api.chatConversation(kind, contactId);
        // Hızlı konuşma değiştirmede yarış: kullanıcı bu istek dönmeden başka
        // konuşmaya geçtiyse geç gelen eski yanıtı uygulama.
        if (activeIdRef.current !== contactId) return;
        setMessages(res.messages);
        // Okunmamış rozetini lokalde sıfırla (server zaten okundu işaretledi).
        setContacts((prev) =>
          prev.map((c) => (c.id === contactId ? { ...c, unread: 0 } : c))
        );
      } catch (err) {
        if (activeIdRef.current !== contactId) return;
        toast.push('error', (err as Error).message || 'Konuşma yüklenemedi.');
      } finally {
        if (activeIdRef.current === contactId) setLoadingThread(false);
      }
    },
    [kind, toast]
  );

  // Mesaj listesi değişince en alta kaydır.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loadingThread]);

  // Realtime — yeni mesaj geldiğinde.
  useRealtimeEvents(kind, (type, data) => {
    if (type !== 'chat.message') return;
    const payload = data as { message: ChatMessage; peerId: string };
    if (!payload?.message) return;
    // Açık konuşma bu kişiyle ise mesajı ekle + sunucuda okundu işaretle.
    if (activeIdRef.current && payload.peerId === activeIdRef.current) {
      setMessages((prev) => [...prev, payload.message]);
      void api.chatMarkRead(kind, activeIdRef.current).catch(() => undefined);
    }
    void loadContacts();
  });

  async function send() {
    const body = draft.trim();
    if (!body || !activeContact || sending) return;
    setSending(true);
    try {
      const res = await api.chatSend(kind, activeContact.id, activeContact.kind, body);
      setMessages((prev) => [...prev, res.message]);
      setDraft('');
      void loadContacts();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Mesaj gönderilemedi.');
    } finally {
      setSending(false);
    }
  }

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.fullName.toLocaleLowerCase('tr').includes(q) ||
        c.roleLabel.toLocaleLowerCase('tr').includes(q)
    );
  }, [contacts, search]);

  const totalUnread = useMemo(
    () => contacts.reduce((sum, c) => sum + c.unread, 0),
    [contacts]
  );

  return (
    <AppShell kind={kind}>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="role-badge-cyan">
            <span className="role-badge-dot bg-cyan-400" />
            Sohbet
          </div>
          <h1 className="text-3xl font-extrabold text-kt-green-900">Mesajlar</h1>
          <p className="text-kt-gray-500 text-sm mt-1">
            Ekipteki herkesle doğrudan yazışın — yönetici, danışman, Ar-Ge ve kullanıcılar.
            {totalUnread > 0 && (
              <span className="ml-1 font-semibold text-cyan-700">
                {totalUnread} okunmamış mesaj.
              </span>
            )}
          </p>
        </div>
        {/* Tema seçici üretilmiş görselleri listeler → FEATURE_VISUALS kapalıyken gizli. */}
        {kind === 'user' && FEATURES.visualStudio && (
          <button type="button" onClick={openThemePicker} className="btn-secondary text-sm shrink-0">
            🎨 Sohbet teması
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-15rem)] min-h-[460px]">
        {/* ===== SOL: kişi listesi ===== */}
        <aside className="rounded-2xl bg-white border border-kt-gray-100 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-kt-gray-100">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-kt-gray-400"
                fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="search"
                className="input pl-9 py-2 text-sm"
                placeholder="Kişi ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={60}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {loadingContacts ? (
              <div className="p-6 text-center text-sm text-kt-gray-400">Yükleniyor…</div>
            ) : filteredContacts.length === 0 ? (
              <div className="p-6 text-center text-sm text-kt-gray-400">
                {search ? 'Eşleşen kişi yok.' : 'Kişi yok.'}
              </div>
            ) : (
              filteredContacts.map((c) => {
                const tone = toneFor(c.roleLabel);
                const isActive = c.id === activeId;
                return (
                  <button
                    key={`${c.kind}-${c.id}`}
                    type="button"
                    onClick={() => void openConversation(c.id)}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-kt-gray-50 transition-colors ${
                      isActive ? 'bg-cyan-50' : 'hover:bg-kt-gray-50'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-xs font-bold overflow-hidden ${tone.bg} ${tone.text}`}
                    >
                      {c.kind === 'admin' ? (
                        <img src="/admin-pp.png" alt="" className="w-full h-full object-cover" />
                      ) : c.profilePhoto ? (
                        <img src={c.profilePhoto} alt="" className="w-full h-full object-cover" />
                      ) : (
                        initials(c.fullName)
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-kt-green-900 truncate">
                          {c.fullName}
                        </span>
                        {c.lastMessageAt && (
                          <span className="text-[10px] text-kt-gray-400 shrink-0">
                            {fmtRelative(c.lastMessageAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-kt-gray-500 truncate">
                          {c.lastMessage ?? c.roleLabel}
                        </span>
                        {c.unread > 0 && (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-cyan-600 text-white text-[10px] font-bold flex items-center justify-center">
                            {c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ===== SAĞ: konuşma penceresi ===== */}
        <section className="rounded-2xl bg-white border border-kt-gray-100 flex flex-col overflow-hidden">
          {!activeContact ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center mb-3">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="font-bold text-kt-green-900 mb-1">Bir konuşma seçin</h3>
              <p className="text-sm text-kt-gray-500 max-w-xs">
                Soldaki listeden bir kişiye tıklayarak mesajlaşmaya başlayın.
              </p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-4 py-3 border-b border-kt-gray-100 flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-xs font-bold overflow-hidden ${
                    toneFor(activeContact.roleLabel).bg
                  } ${toneFor(activeContact.roleLabel).text}`}
                >
                  {activeContact.kind === 'admin' ? (
                    <img src="/admin-pp.png" alt="" className="w-full h-full object-cover" />
                  ) : activeContact.profilePhoto ? (
                    <img src={activeContact.profilePhoto} alt="" className="w-full h-full object-cover" />
                  ) : (
                    initials(activeContact.fullName)
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-kt-green-900 truncate">
                    {activeContact.fullName}
                  </div>
                  <div className="text-xs text-kt-gray-500">{activeContact.roleLabel}</div>
                </div>
              </div>

              {/* Mesajlar */}
              <div
                ref={scrollRef}
                className={`flex-1 overflow-y-auto scrollbar-thin p-4 space-y-2 ${chatBg ? '' : 'bg-kt-gray-50/40'}`}
                style={
                  chatBg
                    ? {
                        // Hafif beyaz veil → görsel belirgin kalır, baloncuklar yine okunur
                        // (baloncuklar zaten opak; bu yüzden düşük veil yeterli).
                        backgroundImage: `linear-gradient(rgba(255,255,255,0.38), rgba(255,255,255,0.38)), url("${chatBg}")`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : undefined
                }
              >
                {loadingThread ? (
                  <div className="text-center text-sm text-kt-gray-400 py-6">Yükleniyor…</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-sm text-kt-gray-400 py-6">
                    Henüz mesaj yok. İlk mesajı siz gönderin.
                  </div>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${
                          m.mine
                            ? 'bg-kt-green-900 text-white rounded-br-sm'
                            : 'bg-white border border-kt-gray-100 text-kt-green-900 rounded-bl-sm'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div
                          className={`text-[10px] mt-1 ${
                            m.mine ? 'text-white/55' : 'text-kt-gray-400'
                          }`}
                        >
                          {fmtTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Girdi */}
              <div className="p-3 border-t border-kt-gray-100 flex items-end gap-2">
                <textarea
                  className="input resize-none py-2 text-sm min-h-[42px] max-h-32"
                  rows={1}
                  placeholder={`${activeContact.fullName.split(' ')[0]}'a mesaj yaz...`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  maxLength={2000}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!draft.trim() || sending}
                  className="btn-pill-primary btn-pill-sm shrink-0"
                >
                  <span className="relative z-10 flex items-center gap-1.5">
                    {sending ? 'Gönderiliyor…' : 'Gönder'}
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {showThemePicker && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        >
          <div
            className="bg-white rounded-2xl shadow-kt-card max-w-lg w-full max-h-[85vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-extrabold text-kt-green-900">Sohbet teması seç</h3>
              <button
                onClick={() => setShowThemePicker(false)}
                className="p-2 rounded-lg hover:bg-kt-gray-100 text-kt-gray-500"
                aria-label="Kapat"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {visualsLoading ? (
              <p className="text-sm text-kt-gray-400 text-center py-8 animate-pulse">Görseller yükleniyor…</p>
            ) : myVisuals.length === 0 ? (
              <div className="text-center py-8 text-sm text-kt-gray-500">
                Henüz görselin yok.{' '}
                <Link to="/profile?tab=gorsel" className="text-kt-violet-700 font-semibold underline">
                  Görsel Üret
                </Link>{' '}
                sayfasından oluştur.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {chatBg && (
                  <button
                    onClick={() => applyChatBg(null)}
                    disabled={savingBg}
                    className="aspect-square rounded-lg border-2 border-dashed border-kt-gray-300 text-xs font-semibold text-kt-gray-500 hover:border-rose-300 hover:text-rose-600 flex items-center justify-center disabled:opacity-50"
                  >
                    Kaldır
                  </button>
                )}
                {myVisuals.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => applyChatBg(v.id)}
                    disabled={savingBg}
                    title={v.fikir}
                    className={`aspect-square rounded-lg overflow-hidden border-2 transition-colors disabled:opacity-50 ${
                      chatBg === v.imageUrl ? 'border-kt-violet-500' : 'border-transparent hover:border-kt-violet-300'
                    }`}
                  >
                    {v.imageUrl && (
                      <img
                        src={v.imageUrl}
                        alt={v.fikir}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
                        }}
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </AppShell>
  );
}
