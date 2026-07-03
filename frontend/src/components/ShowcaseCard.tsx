/**
 * Showcase/Envanter proje kartı — like + comment + public profile link.
 *
 * Like: optimistic update (önce UI, sonra API).
 * Comments: panel toggle, ilk açılışta fetch.
 * Auth yoksa beğeni/yorum giriş'e yönlendirir.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useViewerKind } from '../hooks/useViewerKind';
import { useToast } from './Toast';
import { api } from '../services/api';
import { ConfirmDialog } from './ConfirmDialog';
import type { ShowcaseComment, ShowcaseItem, Visual } from '../types';
import { bookingPeriodLabel } from '../lib/utils';

function fmtRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
  return `${new Date(start).toLocaleDateString('tr-TR', opts)} → ${new Date(end).toLocaleDateString('tr-TR', opts)}`;
}
function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'az önce';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} dk önce`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} sa önce`;
  return new Date(iso).toLocaleDateString('tr-TR');
}
function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

interface Props {
  item: ShowcaseItem;
  /** authorId — public profile linki için (showcase API'sinden gelmiyor, bu yüzden opsiyonel). */
  authorId?: string;
  /** Mevcut beğeni sayısı (parent'tan). */
  likes: number;
  /** Mevcut yorum sayısı (parent'tan). */
  comments: number;
}

export function ShowcaseCard({ item, authorId, likes, comments }: Props) {
  const { user, admin, danisman, arge } = useAuth();
  const viewerKind = useViewerKind();
  const navigate = useNavigate();
  const toast = useToast();

  // Herhangi bir oturum açık mı? (admin dahil — envanterde beğeni/yorum GÖRSÜN.)
  const isLoggedIn = !!(user || admin || danisman || arge);
  // Beğeni/yorum YAZMA yalnız gerçek kullanıcıda mümkün (user slotu: normal +
  // governance kullanıcılar var; admin ayrı tablo → FK kabul etmez → salt-okunur).
  const canInteract = !!user;

  const [likeCount, setLikeCount] = useState(likes);
  const [commentCount, setCommentCount] = useState(comments);
  const [liked, setLiked] = useState(false);
  const [likeStatusLoaded, setLikeStatusLoaded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);
  const [commentsList, setCommentsList] = useState<ShowcaseComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [sending, setSending] = useState(false);

  // Arkaplan görseli — sadece projenin sahibi atayabilir.
  const isOwner = !!user && user.id === item.authorId;
  const [bgUrl, setBgUrl] = useState<string | null>(item.showcaseImageUrl);
  const [showPicker, setShowPicker] = useState(false);
  const [myVisuals, setMyVisuals] = useState<Visual[]>([]);
  const [visualsLoading, setVisualsLoading] = useState(false);
  const [savingBg, setSavingBg] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  async function ensureLikeStatus() {
    if (likeStatusLoaded || !isLoggedIn) return;
    try {
      const s = await api.getLikeStatus(item.id, viewerKind);
      setLiked(s.liked);
      setLikeCount(s.count);
      setLikeStatusLoaded(true);
    } catch {
      // ignore
    }
  }

  async function handleLike() {
    if (!isLoggedIn) {
      navigate('/login');
      return;
    }
    if (!canInteract) {
      toast.push('info', 'Beğeni yalnızca kullanıcı hesaplarına açık.');
      return;
    }
    // Optimistic
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => c + (wasLiked ? -1 : 1));
    try {
      const s = await api.toggleLike(item.id);
      setLiked(s.liked);
      setLikeCount(s.count);
    } catch (err) {
      // Rollback
      setLiked(wasLiked);
      setLikeCount((c) => c + (wasLiked ? 1 : -1));
      toast.push('error', (err as Error).message || 'İşlem başarısız.');
    }
  }

  async function toggleComments() {
    const next = !showComments;
    setShowComments(next);
    if (next && commentsList.length === 0) {
      setCommentsLoading(true);
      try {
        const res = await api.listComments(item.id, viewerKind);
        setCommentsList(res.comments);
      } catch (err) {
        toast.push('error', (err as Error).message || 'Yorumlar yüklenemedi.');
      } finally {
        setCommentsLoading(false);
      }
    }
  }

  async function handlePostComment(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }
    const body = commentBody.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await api.postComment(item.id, body);
      setCommentsList((list) => [res.comment, ...list]);
      setCommentCount((c) => c + 1);
      setCommentBody('');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Yorum gönderilemedi.');
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await api.deleteComment(commentId);
      setCommentsList((list) => list.filter((c) => c.id !== commentId));
      setCommentCount((c) => Math.max(0, c - 1));
    } catch (err) {
      toast.push('error', (err as Error).message || 'Yorum silinemedi.');
    }
  }

  async function openBackgroundPicker() {
    setShowPicker(true);
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

  async function applyBackground(visualId: string | null, url: string | null) {
    setSavingBg(true);
    try {
      await api.setShowcaseImage(item.id, visualId);
      setBgUrl(url);
      setShowPicker(false);
      toast.push('success', visualId ? 'Kart arkaplanı ayarlandı.' : 'Arkaplan kaldırıldı.');
    } catch (err) {
      toast.push('error', (err as Error).message || 'Arkaplan ayarlanamadı.');
    } finally {
      setSavingBg(false);
    }
  }

  // Mount sonrası like status fetch (herhangi bir oturum varsa — admin dahil)
  if (isLoggedIn && !likeStatusLoaded) {
    void ensureLikeStatus();
  }

  return (
    <>
    <article
      className={`card-hover p-5 flex flex-col h-full relative overflow-hidden ${
        item.isHighlight ? 'ring-2 ring-kt-gold-400' : ''
      }`}
      style={
        bgUrl
          ? {
              backgroundImage: `url("${bgUrl}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      {bgUrl && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/70 to-black/45 pointer-events-none" />
      )}
      <div className="relative z-10 flex flex-col flex-1 min-h-0">
      <div className="flex items-start justify-between mb-3">
        <span
          className={`text-[11px] font-bold tracking-wider ${
            bgUrl ? 'text-kt-gold-300' : 'text-kt-gold-700'
          }`}
        >
          {item.roomCode} · {item.neighborhood}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {isOwner && (
            <button
              onClick={openBackgroundPicker}
              className="px-2 py-0.5 rounded-md bg-kt-violet-100 text-kt-violet-800 text-[10px] font-bold border border-kt-violet-200 hover:bg-kt-violet-200 transition-colors"
              title="Kart arkaplan görseli ata"
            >
              🎨 Arkaplan
            </button>
          )}
          {item.isHighlight && (
            <span className="px-2 py-0.5 rounded-md bg-kt-gold-100 text-kt-gold-800 text-[10px] font-bold uppercase tracking-wider">
              ⭐ Öne çıkan
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setShowDetail(true)}
        className="text-left group/detail flex-1 flex flex-col min-w-0 w-full"
        title="Detayı ve büyük görseli aç"
      >
        <h3
          className={`text-lg font-bold mb-2 line-clamp-2 group-hover/detail:underline ${
            bgUrl ? 'text-white drop-shadow-lg' : 'text-kt-green-900'
          }`}
        >
          {item.projectName}
        </h3>
        <p
          className={`text-sm line-clamp-3 mb-3 flex-1 ${
            bgUrl ? 'text-white font-medium drop-shadow-lg' : 'text-kt-gray-700'
          }`}
        >
          {item.projectDescription}
        </p>
      </button>
      <div className="flex flex-wrap gap-1 mb-3">
        {item.technologies.slice(0, 5).map((t) => (
          <span
            key={t}
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
              bgUrl ? 'bg-white/20 text-white' : 'bg-kt-green-50 text-kt-green-800'
            }`}
          >
            {t}
          </span>
        ))}
        {item.technologies.length > 5 && (
          <span className="px-2 py-0.5 rounded-md text-kt-gray-400 text-[11px]">
            +{item.technologies.length - 5}
          </span>
        )}
      </div>

      {/* Yazar + tarih */}
      <div
        className={`flex items-center gap-2 pt-3 border-t ${
          bgUrl ? 'border-white/25' : 'border-kt-gray-100'
        }`}
      >
        {authorId ? (
          <Link
            to={`/u/${authorId}`}
            className="flex items-center gap-2 flex-1 min-w-0 group"
          >
            <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-kt-green-600 to-kt-green-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
              {item.authorPhoto ? (
                <img src={item.authorPhoto} alt="" className="w-full h-full object-cover" />
              ) : (
                initials(item.authorFullName)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`text-xs font-semibold truncate ${
                  bgUrl ? 'text-white group-hover:text-kt-gold-300' : 'text-kt-green-800 group-hover:text-kt-gold-700'
                }`}
              >
                {item.authorFullName}
              </div>
              <div className={`text-[10px] ${bgUrl ? 'text-white/90' : 'text-kt-gray-500'}`}>
                {fmtRange(item.startDate, item.endDate)} · {bookingPeriodLabel(item.period, item.periodMonths)}
              </div>
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-kt-green-600 to-kt-green-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
              {item.authorPhoto ? (
                <img src={item.authorPhoto} alt="" className="w-full h-full object-cover" />
              ) : (
                initials(item.authorFullName)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`text-xs font-semibold truncate ${
                  bgUrl ? 'text-white' : 'text-kt-green-800'
                }`}
              >
                {item.authorFullName}
              </div>
              <div className={`text-[10px] ${bgUrl ? 'text-white/90' : 'text-kt-gray-500'}`}>
                {fmtRange(item.startDate, item.endDate)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Like + Comment butonları */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <button
          onClick={handleLike}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition-all ${
            liked
              ? 'bg-rose-50 border-rose-200 text-rose-700'
              : 'bg-white border-kt-gray-200 text-kt-gray-600 hover:border-rose-200 hover:text-rose-700'
          }`}
          title={liked ? 'Beğeniyi kaldır' : 'Beğen'}
        >
          <svg className="w-3.5 h-3.5" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          <span className="font-semibold tabular-nums">{likeCount}</span>
        </button>

        <button
          onClick={toggleComments}
          aria-label="Yorumlar"
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition-all ${
            showComments
              ? 'bg-kt-gold-50 border-kt-gold-300 text-kt-gold-700'
              : 'bg-white border-kt-gray-200 text-kt-gray-600 hover:border-kt-gold-200 hover:text-kt-gold-700'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="font-semibold tabular-nums">{commentCount}</span>
        </button>
      </div>

      {/* Comments panel */}
      {showComments && (
        <div className="mt-3 border-t border-kt-gray-100 pt-3 space-y-2 animate-fade-in">
          {canInteract && (
            <form onSubmit={handlePostComment} className="flex gap-1.5">
              <input
                type="text"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Yorum yaz..."
                maxLength={1000}
                disabled={sending}
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-kt-gray-200 text-xs focus:border-kt-gold-400 focus:ring-1 focus:ring-kt-gold-400/30 outline-none"
              />
              <button
                type="submit"
                disabled={sending || !commentBody.trim()}
                className="px-2.5 py-1.5 rounded-lg bg-kt-green-700 hover:bg-kt-green-800 disabled:opacity-50 text-white text-xs font-semibold"
              >
                Gönder
              </button>
            </form>
          )}
          {!isLoggedIn && (
            <p className="text-[11px] text-kt-gray-500 italic text-center py-1">
              <Link to="/login" className="text-kt-gold-700 font-semibold underline">
                Giriş yap
              </Link>{' '}
              ve yorum gönder.
            </p>
          )}
          {isLoggedIn && !canInteract && (
            <p className="text-[11px] text-kt-gray-500 italic text-center py-1">
              Yorumları görüntülüyorsunuz (salt-okunur). Yorum yapma yalnızca kullanıcı hesaplarına açık.
            </p>
          )}

          {commentsLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-10 bg-kt-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : commentsList.length === 0 ? (
            <p className="text-[11px] text-kt-gray-400 italic text-center py-2">
              Henüz yorum yok. İlk yorumu sen yap.
            </p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
              {commentsList.map((c) => (
                <li key={c.id} className="flex gap-2 group">
                  <div className="w-6 h-6 rounded-full overflow-hidden bg-gradient-to-br from-kt-green-600 to-kt-green-800 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                    {c.userProfilePhoto ? (
                      <img src={c.userProfilePhoto} alt="" className="w-full h-full object-cover" />
                    ) : (
                      initials(c.userFullName)
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-[11px] font-bold text-kt-green-800">
                        {c.userFullName}
                      </span>
                      <span className="text-[10px] text-kt-gray-400">
                        {fmtRelative(c.createdAt)}
                      </span>
                      {user?.id === c.userId && (
                        <button
                          onClick={() => setConfirmDeleteCommentId(c.id)}
                          className="opacity-0 group-hover:opacity-100 ml-auto text-[10px] text-rose-500 hover:text-rose-700"
                          title="Yorumu sil"
                        >
                          Sil
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-kt-green-900 whitespace-pre-wrap break-words">
                      {c.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>
    </article>

    {/* Detay modalı — body'ye portal: AppShell main(z-10) stacking context'inden
        çık → sticky header (z-40) modalın üstünü örtmesin (üst kısım görünür kalsın). */}
    {showDetail && createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      >
        <div
          className="bg-white rounded-2xl shadow-kt-card max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative">
            {bgUrl ? (
              <img src={bgUrl} alt={item.projectName} className="w-full h-auto max-h-[65vh] object-contain rounded-t-2xl bg-kt-gray-100" />
            ) : (
              <div className="w-full aspect-video bg-gradient-to-br from-kt-green-700 to-kt-green-900 rounded-t-2xl flex items-center justify-center text-white/40 text-6xl">
                🗂️
              </div>
            )}
            <button
              onClick={() => setShowDetail(false)}
              className="absolute top-3 right-3 p-2 rounded-lg bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm"
              aria-label="Kapat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {item.isHighlight && (
              <span className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-kt-gold-400 text-kt-gold-900 text-[11px] font-bold uppercase tracking-wider">
                ⭐ Öne çıkan
              </span>
            )}
          </div>

          <div className="p-6 space-y-4">
            <div>
              <div className="text-[11px] font-bold tracking-wider text-kt-gold-700 mb-1">
                {item.roomCode} · {item.neighborhood}
              </div>
              <h2 className="text-2xl font-extrabold text-kt-green-900">{item.projectName}</h2>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-kt-green-600 to-kt-green-800 text-white flex items-center justify-center font-bold text-sm shrink-0">
                {item.authorPhoto ? (
                  <img src={item.authorPhoto} alt="" className="w-full h-full object-cover" />
                ) : (
                  initials(item.authorFullName)
                )}
              </div>
              <div className="min-w-0">
                {authorId ? (
                  <Link
                    to={`/u/${authorId}`}
                    className="text-sm font-semibold text-kt-green-800 hover:text-kt-gold-700 hover:underline"
                  >
                    {item.authorFullName}
                  </Link>
                ) : (
                  <span className="text-sm font-semibold text-kt-green-800">{item.authorFullName}</span>
                )}
                <div className="text-xs text-kt-gray-500">
                  {fmtRange(item.startDate, item.endDate)} · {bookingPeriodLabel(item.period, item.periodMonths)}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-1">Proje Açıklaması</h3>
              <p className="text-sm text-kt-green-800 leading-relaxed whitespace-pre-wrap">
                {item.projectDescription}
              </p>
            </div>

            {item.technologies.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-kt-gray-500 mb-1.5">
                  Teknolojiler <span className="font-normal normal-case">({item.technologies.length})</span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {item.technologies.map((t) => (
                    <span
                      key={t}
                      className="px-2.5 py-1 rounded-md text-xs font-semibold bg-kt-green-50 text-kt-green-800"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 pt-3 border-t border-kt-gray-100 text-sm text-kt-gray-600">
              <span className="flex items-center gap-1">❤️ {likeCount}</span>
              <span className="flex items-center gap-1">💬 {commentCount}</span>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}

    {showPicker && createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      >
        <div
          className="bg-white rounded-2xl shadow-kt-card max-w-lg w-full max-h-[85vh] overflow-y-auto p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-extrabold text-kt-green-900">Kart arkaplanı seç</h3>
            <button
              onClick={() => setShowPicker(false)}
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
              <Link to="/gorsel" className="text-kt-violet-700 font-semibold underline">
                Görsel Üret
              </Link>{' '}
              sayfasından oluştur.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {bgUrl && (
                <button
                  onClick={() => applyBackground(null, null)}
                  disabled={savingBg}
                  className="aspect-square rounded-lg border-2 border-dashed border-kt-gray-300 text-xs font-semibold text-kt-gray-500 hover:border-rose-300 hover:text-rose-600 flex items-center justify-center disabled:opacity-50"
                >
                  Kaldır
                </button>
              )}
              {myVisuals.map((v) => (
                <button
                  key={v.id}
                  onClick={() => applyBackground(v.id, v.imageUrl)}
                  disabled={savingBg}
                  title={v.fikir}
                  className={`aspect-square rounded-lg overflow-hidden border-2 transition-colors disabled:opacity-50 ${
                    bgUrl === v.imageUrl
                      ? 'border-kt-violet-500'
                      : 'border-transparent hover:border-kt-violet-300'
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
      <ConfirmDialog
        open={!!confirmDeleteCommentId}
        title="Yorum silinsin mi?"
        message="Yorumunuz kalıcı olarak silinecek. Bu işlem geri alınamaz."
        confirmLabel="Evet, sil"
        onConfirm={() => {
          if (confirmDeleteCommentId) void handleDeleteComment(confirmDeleteCommentId);
          setConfirmDeleteCommentId(null);
        }}
        onCancel={() => setConfirmDeleteCommentId(null)}
      />
    </>
  );
}
