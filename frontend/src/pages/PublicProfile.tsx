/**
 * Public profil sayfası — `/u/:userId`.
 *
 * - Auth gerektirmez (herkes görebilir).
 * - Gösterilenler: full_name, department, title, bio, projectIdea, profilePhoto
 *   + onaylı + showcase_visible projeler + likes/comments aggregate stats.
 * - GİZLENEN: email, status, hassas profile field'ları.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { api } from '../services/api';
import type { PublicProfile as ProfileT } from '../types';

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
function fmtDateRange(s: string, e: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
  return `${new Date(s).toLocaleDateString('tr-TR', opts)} → ${new Date(e).toLocaleDateString('tr-TR', opts)}`;
}
function fmtJoinDate(s: string): string {
  return new Date(s).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

export default function PublicProfile() {
  const { userId } = useParams<{ userId: string }>();
  const { user, admin } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<ProfileT | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api.getPublicProfile(userId);
      setProfile(res.profile);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 404) setNotFound(true);
      else toast.push('error', e.message || 'Profil yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const homeLink = admin ? '/admin' : user ? '/rooms' : '/';
  const isOwnProfile = user?.id === userId;

  return (
    <div className="min-h-screen flex flex-col bg-ai-light relative">
      {/* Header */}
      <header className="bg-gradient-to-r from-kt-green-950 via-kt-green-900 to-kt-green-950 border-b border-kt-gold-400/20 sticky top-0 z-40 shadow-glow-blue">
        <div className="absolute inset-0 bg-neural-grid-dark opacity-30 pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to={homeLink} className="shrink-0">
            <Logo size="sm" variant="light" />
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/showcase" className="text-sm font-semibold text-white/70 hover:text-kt-gold-300">
              ← Envanter
            </Link>
            {!user && !admin && (
              <Link
                to="/login"
                className="px-4 py-1.5 rounded-lg bg-kt-gold-400/20 text-kt-gold-300 text-sm font-semibold border border-kt-gold-400/40 hover:bg-kt-gold-400/30"
              >
                Giriş Yap
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-5xl w-full mx-auto px-6 py-10">
        {loading ? (
          <div className="card p-12 animate-pulse h-64" />
        ) : notFound || !profile ? (
          <EmptyState
            icon="users"
            title="Profil bulunamadı"
            description="Aradığınız kullanıcı silinmiş veya devre dışı bırakılmış olabilir."
            tone="rose"
            action={
              <Link to="/showcase" className="btn-secondary text-sm">
                Envantere dön
              </Link>
            }
          />
        ) : (
          <>
            {/* ====== Profile Header Card ====== */}
            <section
              className="relative card p-8 md:p-10 overflow-hidden mb-6"
              style={
                profile.profileBackgroundUrl
                  ? {
                      backgroundImage: `url("${profile.profileBackgroundUrl}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
            >
              {profile.profileBackgroundUrl ? (
                /* Kullanıcının seçtiği arka plan üstüne okunabilirlik için koyu overlay. */
                <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/55 to-black/65 pointer-events-none" />
              ) : (
                <>
                  {/* Glow accents (yalnız arka plan görseli yokken) */}
                  <div className="absolute -top-16 -right-16 w-64 h-64 bg-kt-gold-400/15 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-kt-violet-500/12 rounded-full blur-3xl pointer-events-none" />
                </>
              )}

              <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-6">
                {/* Avatar */}
                <div className="w-32 h-32 rounded-3xl overflow-hidden ring-4 ring-kt-gold-300/40 shadow-glow-cyan shrink-0">
                  {profile.profilePhoto ? (
                    <img src={profile.profilePhoto} alt={profile.fullName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-kt-green-700 via-kt-green-800 to-kt-green-950 text-white flex items-center justify-center text-4xl font-extrabold">
                      {initials(profile.fullName)}
                    </div>
                  )}
                </div>

                {/* Bio */}
                <div className="flex-1 text-center md:text-left min-w-0">
                  <div className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-2 ${profile.profileBackgroundUrl ? 'text-kt-gold-300' : 'text-kt-gold-700'}`}>
                    AI Lab · Public Profile
                  </div>
                  <h1 className={`text-3xl md:text-4xl font-extrabold mb-1 ${profile.profileBackgroundUrl ? 'text-white drop-shadow-lg' : 'text-kt-green-900'}`}>
                    {profile.fullName}
                  </h1>
                  <div className="flex flex-wrap gap-2 justify-center md:justify-start mb-3">
                    {profile.title && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-kt-green-50 text-kt-green-800 text-xs font-semibold border border-kt-green-100">
                        {profile.title}
                      </span>
                    )}
                    {profile.department && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-kt-gold-50 text-kt-gold-700 text-xs font-semibold border border-kt-gold-200/60">
                        {profile.department}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-kt-gray-100 text-kt-gray-600 text-xs font-semibold">
                      Üye · {fmtJoinDate(profile.joinedAt)}
                    </span>
                  </div>
                  {profile.bio && (
                    <p className={`text-sm max-w-2xl leading-relaxed ${profile.profileBackgroundUrl ? 'text-white/90 drop-shadow' : 'text-kt-gray-700'}`}>{profile.bio}</p>
                  )}
                  {isOwnProfile && (
                    <Link
                      to="/profile"
                      className={`inline-flex items-center gap-1 mt-3 text-xs font-bold ${profile.profileBackgroundUrl ? 'text-kt-gold-300 hover:text-kt-gold-200' : 'text-kt-gold-700 hover:text-kt-gold-800'}`}
                    >
                      ✎ Profilimi düzenle
                    </Link>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className={`relative z-10 mt-6 pt-6 border-t grid grid-cols-3 gap-4 text-center ${profile.profileBackgroundUrl ? 'border-white/20' : 'border-kt-gray-100'}`}>
                <Stat label="Onaylı proje" value={profile.stats.projectCount} tone="cyan" onDark={!!profile.profileBackgroundUrl} />
                <Stat label="Toplam beğeni" value={profile.stats.totalLikes} tone="gold" onDark={!!profile.profileBackgroundUrl} />
                <Stat label="Toplam yorum" value={profile.stats.totalComments} tone="violet" onDark={!!profile.profileBackgroundUrl} />
              </div>
            </section>

            {/* ====== Projects ====== */}
            <section>
              <h2 className="text-xl font-bold text-kt-green-900 mb-4 flex items-center gap-2">
                <span className="text-shimmer">Projeler</span>
                <span className="text-sm text-kt-gray-400 font-semibold">({profile.projects.length})</span>
              </h2>
              {profile.projects.length === 0 ? (
                <EmptyState
                  icon="showcase"
                  title="Henüz görünür proje yok"
                  description={
                    isOwnProfile
                      ? 'Onaylı bir projeniz olduğunda Taleplerim sayfasından "Envanterde göster" seçeneğini açabilirsiniz.'
                      : 'Bu kullanıcı henüz envantere proje eklemedi.'
                  }
                  tone="cyan"
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {profile.projects.map((p) => {
                    const hasBg = !!p.showcaseImageUrl;
                    return (
                    <article
                      key={p.id}
                      className={`card-hover p-5 relative overflow-hidden ${p.isHighlight ? 'ring-2 ring-kt-gold-400' : ''}`}
                      style={
                        hasBg
                          ? {
                              backgroundImage: `url("${p.showcaseImageUrl}")`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }
                          : undefined
                      }
                    >
                      {hasBg && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/70 to-black/45 pointer-events-none" />
                      )}
                      <div className="relative z-10">
                      <div className="flex items-start justify-between mb-2">
                        <span className={`text-[11px] font-bold tracking-wider ${hasBg ? 'text-kt-gold-300' : 'text-kt-gold-700'}`}>
                          {p.roomCode} · {p.roomName}
                        </span>
                        {p.isHighlight && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-kt-gold-100 text-kt-gold-800">
                            ⭐ Öne çıkan
                          </span>
                        )}
                      </div>
                      <h3 className={`text-lg font-bold mb-1.5 line-clamp-2 ${hasBg ? 'text-white' : 'text-kt-green-900'}`}>
                        {p.projectName}
                      </h3>
                      <p className={`text-sm line-clamp-3 mb-3 ${hasBg ? 'text-white/85' : 'text-kt-gray-600'}`}>
                        {p.projectDescription}
                      </p>
                      <div className="flex flex-wrap gap-1 mb-3">
                        {p.technologies.slice(0, 5).map((t) => (
                          <span
                            key={t}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${hasBg ? 'bg-white/15 text-white' : 'bg-kt-green-50 text-kt-green-800'}`}
                          >
                            {t}
                          </span>
                        ))}
                        {p.technologies.length > 5 && (
                          <span className={`px-2 py-0.5 rounded text-[11px] ${hasBg ? 'text-white/60' : 'text-kt-gray-400'}`}>
                            +{p.technologies.length - 5}
                          </span>
                        )}
                      </div>
                      <div className={`flex items-center justify-between pt-3 border-t text-xs ${hasBg ? 'border-white/20' : 'border-kt-gray-100'}`}>
                        <span className={hasBg ? 'text-white/70' : 'text-kt-gray-500'}>{fmtDateRange(p.startDate, p.endDate)}</span>
                        <div className="flex items-center gap-3">
                          <span className={`flex items-center gap-1 font-semibold ${hasBg ? 'text-rose-300' : 'text-rose-600'}`}>
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"/></svg>
                            {p.likeCount}
                          </span>
                          <span className={`flex items-center gap-1 font-semibold ${hasBg ? 'text-kt-gold-300' : 'text-kt-gold-700'}`}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                            {p.commentCount}
                          </span>
                        </div>
                      </div>
                      </div>
                    </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="relative z-10 border-t border-kt-gray-200 bg-gradient-to-r from-kt-green-950 to-kt-green-900 py-4 text-center text-xs text-white/50">
        <span className="text-kt-gold-400 font-semibold">Kuveyt Türk</span>
        <span className="mx-2 text-kt-gold-400/40">·</span>
        Yapay Zeka Laboratuvarı · Public Profile
      </footer>
    </div>
  );
}

function Stat({ label, value, tone, onDark }: { label: string; value: number; tone: 'cyan' | 'gold' | 'violet'; onDark?: boolean }) {
  const colors = onDark
    ? tone === 'cyan'
      ? 'text-kt-gold-300'
      : tone === 'gold'
      ? 'text-rose-300'
      : 'text-kt-violet-300'
    : tone === 'cyan'
    ? 'text-kt-gold-700'
    : tone === 'gold'
    ? 'text-rose-600'
    : 'text-kt-violet-600';
  return (
    <div>
      <div className={`text-3xl font-extrabold tabular-nums ${colors}`}>{value}</div>
      <div className={`text-[11px] uppercase tracking-wider font-semibold mt-0.5 ${onDark ? 'text-white/70' : 'text-kt-gray-500'}`}>{label}</div>
    </div>
  );
}
