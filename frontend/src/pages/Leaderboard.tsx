/**
 * Liderlik / Sıralama (#5a).
 *
 * İki sıralama:
 *  - Kullanıcılar: oda kullanımı (onaylı booking + gün) + showcase etkileşimi
 *    (aldığı beğeni/yorum) bileşik skoru.
 *  - Projeler: showcase beğeni + yorum skoru.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { api } from '../services/api';
import type { Leaderboard as LeaderboardData } from '../types';

function medal(rank: number): string {
  if (rank === 0) return '🥇';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return `${rank + 1}`;
}

function rankCls(rank: number): string {
  if (rank === 0) return 'bg-gradient-to-r from-kt-gold-100 to-kt-gold-50 border-kt-gold-300';
  if (rank === 1) return 'bg-gradient-to-r from-kt-gray-100 to-white border-kt-gray-200';
  if (rank === 2) return 'bg-gradient-to-r from-amber-50 to-white border-amber-200';
  return 'bg-white border-kt-gray-100';
}

export default function Leaderboard() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'users' | 'projects'>('users');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.leaderboard();
        if (!cancelled) setData(res);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxUserScore = data?.users[0]?.score || 1;
  const maxProjectScore = data?.projects[0]?.score || 1;

  return (
    <AppShell kind="user">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-kt-green-900 mb-1">Leader Board</h1>
        <p className="text-kt-gray-500">
          Oda kullanımı ve Envanter etkileşimine göre en aktif ekipler ve projeler.
        </p>
      </div>

      {/* Tab seçici */}
      <div className="inline-flex rounded-xl border border-kt-gray-200 bg-white p-1 mb-6">
        <button
          onClick={() => setTab('users')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
            tab === 'users' ? 'bg-kt-green-700 text-white' : 'text-kt-gray-600 hover:text-kt-green-800'
          }`}
        >
          👥 Kullanıcılar
        </button>
        <button
          onClick={() => setTab('projects')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
            tab === 'projects' ? 'bg-kt-green-700 text-white' : 'text-kt-gray-600 hover:text-kt-green-800'
          }`}
        >
          🏆 Projeler
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-16 animate-pulse" />
          ))}
        </div>
      ) : !data ? (
        <div className="text-kt-gray-500">Sıralama yüklenemedi.</div>
      ) : tab === 'users' ? (
        <div className="space-y-2">
          {data.users.length === 0 && (
            <div className="text-kt-gray-500 italic">Henüz sıralama için yeterli aktivite yok.</div>
          )}
          {data.users.map((u, i) => {
            const hasBg = !!u.profileBackgroundUrl;
            return (
            <div
              key={u.userId}
              className={`relative overflow-hidden flex items-center gap-4 rounded-xl border p-3 ${rankCls(i)}`}
              style={
                hasBg
                  ? {
                      backgroundImage: `url("${u.profileBackgroundUrl}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
            >
              {hasBg && (
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/35 pointer-events-none" />
              )}
              <div className={`relative z-10 w-9 text-center text-xl font-extrabold shrink-0 ${hasBg ? 'text-white' : 'text-kt-green-900'}`}>
                {medal(i)}
              </div>
              <Link
                to={`/u/${u.userId}`}
                className={`relative z-10 flex-1 min-w-0 ${hasBg ? 'hover:text-kt-gold-300' : 'hover:text-kt-gold-700'}`}
                title="Profili gör"
              >
                <div className={`font-bold truncate ${hasBg ? 'text-white' : 'text-kt-green-900'}`}>{u.fullName}</div>
                <div className={`text-[11px] ${hasBg ? 'text-white/75' : 'text-kt-gray-500'}`}>
                  {u.department || 'Departman belirtilmemiş'}
                </div>
              </Link>
              <div className={`relative z-10 hidden sm:flex items-center gap-3 text-[11px] shrink-0 ${hasBg ? 'text-white/85' : 'text-kt-gray-600'}`}>
                <span title="Onaylı randevu">📋 {u.approvedBookings}</span>
                <span title="Kullanım günü">📆 {u.utilizationDays}</span>
                <span title="Beğeni">❤️ {u.likes}</span>
                <span title="Yorum">💬 {u.comments}</span>
              </div>
              <div className="relative z-10 w-28 shrink-0">
                <div className={`text-right text-sm font-extrabold tabular-nums ${hasBg ? 'text-white' : 'text-kt-green-800'}`}>
                  {u.score.toFixed(0)}
                </div>
                <div className={`h-1.5 rounded-full overflow-hidden mt-1 ${hasBg ? 'bg-white/25' : 'bg-kt-gray-100'}`}>
                  <div
                    className="h-full bg-gradient-to-r from-kt-green-500 to-kt-gold-500"
                    style={{ width: `${Math.max(4, (u.score / maxUserScore) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {data.projects.length === 0 && (
            <div className="text-kt-gray-500 italic">Henüz Envanter'de etkileşim yok.</div>
          )}
          {data.projects.map((p, i) => (
            <div
              key={p.bookingId}
              className={`flex items-center gap-4 rounded-xl border p-3 ${rankCls(i)}`}
            >
              <div className="w-9 text-center text-xl font-extrabold text-kt-green-900 shrink-0">
                {medal(i)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-kt-green-900 truncate flex items-center gap-1.5">
                  {p.projectName}
                  {p.isHighlight && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-kt-gold-100 text-kt-gold-800 border border-kt-gold-200">
                      ⭐ Öne çıkan
                    </span>
                  )}
                </div>
                <Link to={`/u/${p.authorId}`} className="text-[11px] text-kt-gray-500 hover:text-kt-gold-700">
                  {p.authorFullName} · {p.roomCode}
                </Link>
              </div>
              <div className="flex items-center gap-3 text-xs text-kt-gray-600 shrink-0">
                <span title="Beğeni">❤️ {p.likes}</span>
                <span title="Yorum">💬 {p.comments}</span>
              </div>
              <div className="w-24 shrink-0">
                <div className="text-right text-sm font-extrabold text-kt-green-800 tabular-nums">
                  {p.score.toFixed(0)}
                </div>
                <div className="h-1.5 bg-kt-gray-100 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-gradient-to-r from-kt-violet-500 to-kt-gold-500"
                    style={{ width: `${Math.max(4, (p.score / maxProjectScore) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <p className="mt-6 text-[11px] text-kt-gray-400">
          Skor: onaylı randevu ×{data.scoring.bookings} + kullanım günü ×{data.scoring.utilizationDay} +
          beğeni ×{data.scoring.like} + yorum ×{data.scoring.comment}.
        </p>
      )}
    </AppShell>
  );
}
