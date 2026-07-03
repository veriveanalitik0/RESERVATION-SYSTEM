/**
 * Vibe coding showcase — onaylanan projelerin public galerisi.
 *
 * Erişim:
 * - Giriş yapılmadan da erişilebilir (auth gerektirmez).
 * - User'ın kendi onaylı booking'i için Profilim'de "Galeride göster" toggle var.
 *
 * Görsel:
 * - Highlight'lar üstte (admin etiketler), filter chip'leri ile teknoloji filtre.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { AppShell } from '../components/AppShell';
import { ShowcaseCard } from '../components/ShowcaseCard';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { useViewerKind } from '../hooks/useViewerKind';
import { api } from '../services/api';
import type { ShowcaseEngagement, ShowcaseItem } from '../types';


export default function Showcase() {
  const auth = useAuth();
  const viewerKind = useViewerKind();
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [techs, setTechs] = useState<Array<{ technology: string; count: number }>>([]);
  const [engagement, setEngagement] = useState<ShowcaseEngagement>({});
  const [activeTech, setActiveTech] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // #3: tek istek — items + technologies + engagement birlikte gelir (3 → 1 round-trip).
      const feed = await api.showcaseFeed();
      setItems(feed.items);
      setTechs(feed.technologies);
      setEngagement(feed.engagement);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (activeTech && !it.technologies.includes(activeTech)) return false;
      if (!q) return true;
      return (
        it.projectName.toLowerCase().includes(q) ||
        it.projectDescription.toLowerCase().includes(q) ||
        it.authorFullName.toLowerCase().includes(q) ||
        it.technologies.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, query, activeTech]);

  const isLoggedIn = !!(auth.user || auth.admin || auth.danisman || auth.arge || auth.izleyici);
  const homeLink = auth.admin
    ? '/admin'
    : auth.danisman
      ? '/danisman'
      : auth.arge
        ? '/arge'
        : auth.izleyici
          ? '/izleyici'
          : auth.user
            ? '/rooms'
            : '/';

  // Envanter içeriği — hem AppShell hem public header altında aynı kullanılır.
  const content = (
    <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10">
        {/* Hero */}
        <section className="mb-10">
          <div className="text-xs uppercase tracking-widest text-kt-gold-700 font-bold mb-2">
            Vibe Coding Envanteri
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-kt-green-900 mb-3">
            AI Lab'da yapılan projeler
          </h1>
          <p className="text-kt-gray-600 max-w-2xl leading-relaxed">
            Kuveyt Türk AI Lab odalarında ekiplerimizin geliştirdiği projeler. Fikir
            arıyorsanız, benzer projeler yapan ekiplerle bağlantı kurmak istiyorsanız — buradan başlayın.
          </p>
        </section>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-kt-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              className="input pl-11"
              placeholder="Proje, ekip üyesi veya teknoloji ara..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={80}
            />
          </div>
          {activeTech && (
            <button
              onClick={() => setActiveTech(null)}
              className="px-4 py-2.5 rounded-xl bg-kt-gold-100 text-kt-gold-800 font-semibold text-sm border border-kt-gold-200 hover:bg-kt-gold-200 transition-colors flex items-center gap-2"
            >
              {activeTech}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Tag cloud */}
        {techs.length > 0 && !activeTech && (
          <div className="mb-6 flex flex-wrap gap-1.5">
            {techs.slice(0, 16).map((t) => (
              <button
                key={t.technology}
                onClick={() => setActiveTech(t.technology)}
                className="px-2.5 py-1 rounded-md bg-white border border-kt-gray-200 text-xs font-semibold text-kt-green-800 hover:bg-kt-green-50 hover:border-kt-green-300 transition-colors"
              >
                {t.technology}
                <span className="ml-1.5 text-kt-gold-700 font-bold">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Items */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-5 animate-pulse h-48" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="showcase"
            title={items.length === 0 ? 'Envanter henüz boş' : 'Eşleşen proje yok'}
            description={
              items.length === 0
                ? 'Onaylanan ilk projeler burada gösterilecek. Sen de bir oda için randevu alıp projeni paylaşabilirsin.'
                : 'Filtreleri değiştirip tekrar deneyin.'
            }
            tone="violet"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((item) => {
              const eng = engagement[item.id] ?? { likes: 0, comments: 0 };
              return (
                <ShowcaseCard
                  key={item.id}
                  item={item}
                  authorId={item.authorId}
                  likes={eng.likes}
                  comments={eng.comments}
                />
              );
            })}
          </div>
        )}
      </main>
  );

  // Giriş yapmış kullanıcılar AppShell içinde — sidebar/nav korunur, "Envanter"
  // aktif highlight ile gözükür. Anonim ziyaretçiler için public header korundu.
  // Giriş yapmış HER rol (user/admin/danışman/arge/izleyici) kendi AppShell'inde
  // görür — izleyici/danışman/arge artık public "Giriş Yap" görünümüne düşmez.
  if (isLoggedIn) {
    return <AppShell kind={viewerKind}>{content}</AppShell>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-ai-light relative">
      {/* Anonim ziyaretçi için minimal public header */}
      <header className="bg-white border-b border-kt-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to={homeLink} className="shrink-0">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <Link to={homeLink} className="btn-ghost text-sm">
                Panele dön →
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost text-sm">
                  Giriş Yap
                </Link>
                <Link to="/register" className="btn-primary text-sm">
                  Kayıt Ol
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      {content}
      <footer className="border-t border-kt-gray-100 bg-white py-4 text-center text-xs text-kt-gray-400">
        Kuveyt Türk AI Lab · Demo · {items.length} proje envanterde
      </footer>
    </div>
  );
}
