/**
 * ChatWidget — sağ-altta kalıcı, yüzen genel sohbet widget'ı.
 *
 * Tüm giriş yapmış roller (user/admin/danisman/arge/izleyici) için AppShell'in
 * en altında mount edilir. `/sohbet` tam sayfasını TAMAMLAR (silmez): hızlı
 * erişim için köşede sabit bir FAB + açılır panel sunar.
 *
 * - Kapalı: yuvarlak FAB + okunmamış rozeti.
 * - Açık: kişi listesi ↔ konuşma görünümü (geri butonuyla listeye dön).
 * - Canlı: Chat.tsx'teki ile AYNI SSE 'chat.message' aboneliği (useRealtimeEvents).
 *
 * MovableModalShell DEĞİL — bu kalıcı bir köşe widget'ı, modal değil.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import { useViewerKind } from '../hooks/useViewerKind';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { api } from '../services/api';
import type { ChatContact, ChatMessage } from '../types';

/* Rol etiketine göre avatar tonu — Chat.tsx ile aynı palet. */
const ROLE_TONE: Record<string, { bg: string; text: string }> = {
  Yönetici: { bg: 'bg-kt-green-900', text: 'text-white' },
  'Analitik Danışman': { bg: 'bg-cyan-100', text: 'text-cyan-800' },
  'YZ / Ar-Ge': { bg: 'bg-violet-100', text: 'text-violet-800' },
  Kullanıcı: { bg: 'bg-kt-gray-200', text: 'text-kt-gray-700' },
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

export function ChatWidget() {
  const auth = useAuth();
  const toast = useToast();
  const kind = useViewerKind();

  // Yalnız giriş yapılmışsa göster — aktif slot var mı?
  const isAuthed = Boolean(
    auth.user || auth.admin || auth.danisman || auth.arge || auth.izleyici
  );

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const activeContact = useMemo(
    () => contacts.find((c) => c.id === activeId) ?? null,
    [contacts, activeId]
  );

  const refreshUnread = useCallback(async () => {
    if (!isAuthed) return;
    try {
      const res = await api.chatUnread(kind);
      setUnread(res.unread);
    } catch {
      /* sessizce yut — köşe widget'ı kullanıcıyı toast'a boğmamalı */
    }
  }, [isAuthed, kind]);

  const loadContacts = useCallback(async () => {
    if (!isAuthed) return;
    try {
      const res = await api.chatContacts(kind);
      setContacts(res.contacts);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Kişiler yüklenemedi.');
    } finally {
      setLoadingContacts(false);
    }
  }, [isAuthed, kind, toast]);

  // Açık konuşmayı yükle + okundu işaretle (Chat.tsx ile aynı yarış koruması).
  const openConversation = useCallback(
    async (contactId: string) => {
      setActiveId(contactId);
      activeIdRef.current = contactId;
      setLoadingThread(true);
      try {
        const res = await api.chatConversation(kind, contactId);
        if (activeIdRef.current !== contactId) return;
        setMessages(res.messages);
        setContacts((prev) =>
          prev.map((c) => (c.id === contactId ? { ...c, unread: 0 } : c))
        );
        void refreshUnread();
      } catch (err) {
        if (activeIdRef.current !== contactId) return;
        toast.push('error', (err as Error).message || 'Konuşma yüklenemedi.');
      } finally {
        if (activeIdRef.current === contactId) setLoadingThread(false);
      }
    },
    [kind, toast, refreshUnread]
  );

  function backToList() {
    setActiveId(null);
    activeIdRef.current = null;
    setMessages([]);
    setDraft('');
  }

  // Okunmamış rozeti: ilk yükleme + periyodik tazeleme (SSE'ye ek emniyet).
  useEffect(() => {
    if (!isAuthed) return undefined;
    void refreshUnread();
    const id = window.setInterval(() => void refreshUnread(), 30_000);
    return () => window.clearInterval(id);
  }, [isAuthed, refreshUnread]);

  // Panel açılınca kişi listesini yükle.
  useEffect(() => {
    if (!open || !isAuthed) return;
    setLoadingContacts(true);
    void loadContacts();
  }, [open, isAuthed, loadContacts]);

  // Mesaj listesi değişince en alta kaydır.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loadingThread]);

  // Esc ile kapama (konuşmadaysak önce listeye dön, sonra paneli kapat).
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (activeIdRef.current) backToList();
      else {
        setOpen(false);
        fabRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Realtime — Chat.tsx ile AYNI 'chat.message' aboneliği.
  useRealtimeEvents(isAuthed ? kind : null, (type, data) => {
    if (type !== 'chat.message') return;
    const payload = data as { message: ChatMessage; peerId: string };
    if (!payload?.message) return;
    // Açık konuşma bu kişiyle ise mesajı ekle + sunucuda okundu işaretle.
    if (activeIdRef.current && payload.peerId === activeIdRef.current) {
      setMessages((prev) => [...prev, payload.message]);
      void api.chatMarkRead(kind, activeIdRef.current).catch(() => undefined);
    }
    // Panel açıkken kişi listesini, her durumda unread rozetini tazele.
    if (open) void loadContacts();
    void refreshUnread();
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

  if (!isAuthed) return null;

  // ===== Kapalı: yuvarlak FAB =====
  if (!open) {
    return (
      <button
        ref={fabRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? `Sohbet — ${unread} okunmamış mesaj` : 'Sohbet'}
        aria-expanded={false}
        className={`fixed right-6 z-50 w-14 h-14 rounded-full bg-kt-green-900 text-white shadow-kt-card hover:bg-kt-green-800 hover:scale-105 transition-all flex items-center justify-center ${
          // Destek butonu (SupportRequestButton) yalnız user/danışman/arge'de aynı
          // köşede (bottom-6) durur → o rollerde sohbet FAB'ını üstüne istifle.
          // admin + izleyici'de destek butonu YOK → sohbet FAB'ı köşede (bottom-6).
          kind === 'user' || kind === 'danisman' || kind === 'arge' ? 'bottom-24' : 'bottom-6'
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-ai-light"
            aria-hidden="true"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    );
  }

  // ===== Açık: panel =====
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Sohbet"
      className="fixed z-50 flex flex-col overflow-hidden bg-white shadow-kt-card border border-kt-gray-100
                 inset-x-3 bottom-3 top-3 rounded-2xl
                 sm:inset-auto sm:bottom-6 sm:right-6 sm:top-auto sm:w-[360px] sm:h-[480px] sm:max-h-[calc(100vh-3rem)]"
    >
      {/* Header */}
      <div className="shrink-0 bg-gradient-to-r from-kt-green-950 to-kt-green-900 text-white px-3 py-2.5 flex items-center gap-2">
        {activeContact ? (
          <button
            type="button"
            onClick={backToList}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-kt-gold-300 transition-colors shrink-0"
            aria-label="Kişi listesine dön"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <svg className="w-5 h-5 ml-1 shrink-0 text-kt-gold-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}

        <div className="min-w-0 flex-1">
          {activeContact ? (
            <>
              <div className="font-bold text-sm leading-tight truncate">{activeContact.fullName}</div>
              <div className="text-[11px] text-kt-gold-300/80 leading-tight">{activeContact.roleLabel}</div>
            </>
          ) : (
            <div className="font-bold text-sm">Sohbet</div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            fabRef.current?.focus();
          }}
          className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors shrink-0"
          aria-label="Sohbeti kapat"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* İçerik */}
      {!activeContact ? (
        /* ===== Kişi listesi ===== */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-kt-gray-100 shrink-0">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-kt-gray-400"
                fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"
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
                aria-label="Kişi ara"
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
                return (
                  <button
                    key={`${c.kind}-${c.id}`}
                    type="button"
                    onClick={() => void openConversation(c.id)}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-kt-gray-50 hover:bg-kt-gray-50 transition-colors"
                  >
                    <div
                      className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-bold overflow-hidden ${tone.bg} ${tone.text}`}
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
        </div>
      ) : (
        /* ===== Konuşma ===== */
        <>
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2 bg-kt-gray-50/40"
          >
            {loadingThread ? (
              <div className="text-center text-sm text-kt-gray-400 py-6">Yükleniyor…</div>
            ) : messages.length === 0 ? (
              <div className="text-center text-sm text-kt-gray-400 py-6">
                Henüz mesaj yok. İlk mesajı siz gönderin.
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      m.mine
                        ? 'bg-kt-green-900 text-white rounded-br-sm'
                        : 'bg-white border border-kt-gray-100 text-kt-green-900 rounded-bl-sm'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`text-[10px] mt-1 ${m.mine ? 'text-white/55' : 'text-kt-gray-400'}`}>
                      {fmtTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Girdi */}
          <div className="shrink-0 p-2.5 border-t border-kt-gray-100 flex items-end gap-2">
            <textarea
              className="input resize-none py-2 text-sm min-h-[42px] max-h-28"
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
              aria-label="Mesaj"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              className="btn-pill-primary btn-pill-sm shrink-0"
              aria-label="Gönder"
            >
              <span className="relative z-10 flex items-center gap-1">
                {sending ? '…' : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
