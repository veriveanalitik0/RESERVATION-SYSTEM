/**
 * Sıkça Sorulan Sorular sayfası — kullanıcı self-service yardım.
 *
 * Layout: split (Feature197 pattern) — solda kategori chip'leri + arama + accordion,
 * sağda sticky preview panel (aktif sorunun kategori glow'u + cevabı + ilgili
 * hızlı erişim CTA'ları). Mobilde tek kolon (preview panel gizlenir, cevap
 * accordion içinde açılır — md:hidden fallback).
 *
 * Bağımlılık olarak radix-accordion / framer-motion eklenmedi — saf React state
 * + Tailwind transition'lar yeterli. Mevcut tasarım sisteminden role-badge,
 * btn-pill, KpiCard pattern'leri kullanılıyor.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Calendar,
  KeyRound,
  User,
  ChevronDown,
  HelpCircle,
  Mail,
  ArrowRight,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';

type FaqCategory = 'Genel' | 'Randevu Alma' | 'Lisans Talepleri' | 'Hesap & Profil';
type Tone = 'cyan' | 'gold' | 'violet' | 'emerald';

interface FaqItem {
  id: string;
  category: FaqCategory;
  q: string;
  /** ReactNode — link/badge/list desteği için. */
  a: React.ReactNode;
  /** Ek arama anahtar kelimeleri. */
  keywords?: string[];
  /** Preview panel'de gösterilecek ilgili hızlı erişim linkleri. */
  related?: { to: string; label: string }[];
}

const FAQ: FaqItem[] = [
  /* ============ GENEL ============ */
  {
    id: 'sistem-nedir',
    category: 'Genel',
    q: 'Bu sistem nasıl çalışıyor?',
    a: (
      <>
        <p className="mb-2">
          Kuveyt Türk AI Lab'ın self-service portalı. Üç ana iş akışı sağlar:
        </p>
        <ul className="list-disc pl-5 space-y-1 mb-2">
          <li><strong>AI Lab oda randevusu</strong> — projen için 1, 2 veya 3 ay süreyle bir oda talep edersin.</li>
          <li><strong>Yazılım lisansı talebi</strong> — Cursor, Claude, Copilot vb. araçlar için lisans istersin.</li>
          <li><strong>Bekleme listesi</strong> — dolu odalar için sıraya girersin, oda boşalınca öne atılırsın.</li>
        </ul>
        <p>
          Tüm talepler admin tarafından <strong>onaylanır / reddedilir / revize istenir</strong>. Tüm aksiyonlar audit log'a kaydedilir (banka uyumluluğu için).
        </p>
      </>
    ),
    keywords: ['nasıl', 'kullanım'],
    related: [
      { to: '/rooms', label: 'Odalar' },
      { to: '/licenses', label: 'Lisanslarım' },
      { to: '/waitlist', label: 'Sıramda' },
    ],
  },
  {
    id: 'talep-tipleri',
    category: 'Genel',
    q: 'Hangi tür talepler oluşturabilirim?',
    a: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>
          <Link to="/rooms" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Odalar</Link> →
          AI Lab odası için randevu alma (proje + ekip için fiziksel/sanal alan).
        </li>
        <li>
          <Link to="/licenses" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Lisanslarım</Link> →
          Yazılım/AI aracı lisansı talebi (Cursor, Claude, Copilot vb.).
        </li>
        <li>
          <Link to="/waitlist" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Sıramda</Link> →
          Dolu odaların bekleme listesine kayıt.
        </li>
      </ul>
    ),
    related: [
      { to: '/rooms', label: 'Odalar' },
      { to: '/licenses', label: 'Lisanslarım' },
    ],
  },

  /* ============ ODA KİRALAMA ============ */
  {
    id: 'oda-randevu',
    category: 'Randevu Alma',
    q: 'Nasıl bir AI Lab odası için randevu alırım?',
    a: (
      <ol className="list-decimal pl-5 space-y-1.5">
        <li>
          <Link to="/rooms" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Odalar</Link> menüsünden müsait bir odaya tıkla.
        </li>
        <li>"Randevu Al" butonuna bas — modal açılır.</li>
        <li>Periyot (1/2/3 ay), başlangıç tarihi, proje adı + açıklaması, ihtiyaç duyulan teknolojiler ve ekibin yardım beklentisini doldur.</li>
        <li>Talebi gönder. Admin onayından sonra oda senin olur ve <Link to="/bookings" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Taleplerim</Link>'de görünür.</li>
      </ol>
    ),
    keywords: ['randevu', 'rezervasyon'],
    related: [
      { to: '/rooms', label: 'Odaları gör' },
      { to: '/bookings', label: 'Taleplerim' },
    ],
  },
  {
    id: 'periyot',
    category: 'Randevu Alma',
    q: 'Periyotlar (1, 2, 3 ay) ne anlama geliyor?',
    a: (
      <>
        <p className="mb-2">Randevu süresinin uzunluğu. Üç seçenek var:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>1 ay</strong> — kısa süreli prototip / POC çalışmaları.</li>
          <li><strong>2 ay</strong> — orta vadeli pilot projeler.</li>
          <li><strong>3 ay</strong> — uzun süreli ürün geliştirme.</li>
        </ul>
        <p className="mt-2">3 aydan uzun süreye ihtiyacın varsa <strong>peş peşe iki talep</strong> oluşturup ilki bittiğinde ikincisi devreye girebilir.</p>
      </>
    ),
    related: [{ to: '/rooms', label: 'Randevu al' }],
  },
  {
    id: 'bekleme-listesi',
    category: 'Randevu Alma',
    q: 'Bekleme listesi (Sıramda) nasıl çalışıyor?',
    a: (
      <>
        <p className="mb-2">
          İstediğin oda <strong>doluysa</strong>, kart üzerinde "Sıraya gir" butonu çıkar. Sıraya girdiğinde:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Oda boşalınca <strong>FIFO</strong> (sıralama) sırasına göre haberdar edilirsin (in-app bildirim + e-posta).</li>
          <li>Sırandaki konumunu <Link to="/waitlist" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Sıramda</Link> sayfasından takip edersin.</li>
          <li>Sıran geldiğinde sınırlı süre içinde randevu oluşturmazsan sıra bir sonrakine geçer.</li>
        </ul>
      </>
    ),
    keywords: ['waitlist', 'kuyruk', 'sıra'],
    related: [
      { to: '/waitlist', label: 'Sıramda' },
      { to: '/rooms', label: 'Odalar' },
    ],
  },

  /* ============ LİSANS TALEPLERİ ============ */
  {
    id: 'lisans-talep',
    category: 'Lisans Talepleri',
    q: 'Yazılım lisansı nasıl talep ederim?',
    a: (
      <ol className="list-decimal pl-5 space-y-1.5">
        <li>
          <Link to="/licenses" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Lisanslarım</Link> menüsüne git.
        </li>
        <li>Dropdown'dan istediğin aracı seç (Cursor, Claude, Copilot, vb.) ya da listede yoksa <strong>"Diğer (elle yaz)"</strong> seçeneğini kullan.</li>
        <li>Süre (1 / 3 / 6 ay veya 1 yıl) ve gerekçeni (min 20 karakter — neden ihtiyacın olduğunu kısaca anlat) yaz.</li>
        <li>"Talebi Gönder" — admin onayından sonra IT ekibi lisansı sana atayacak.</li>
      </ol>
    ),
    keywords: ['license', 'cursor', 'claude', 'copilot'],
    related: [{ to: '/licenses', label: 'Lisans talep et' }],
  },
  {
    id: 'mevcut-yazilimlar',
    category: 'Lisans Talepleri',
    q: 'Hangi yazılımlar için lisans talep edebilirim?',
    a: (
      <>
        <p className="mb-2">Popüler araçlar dropdown'da hazır:</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm mb-2">
          <span>• Claude / Claude Code</span>
          <span>• Cursor</span>
          <span>• GitHub Copilot</span>
          <span>• ChatGPT Plus / OpenAI API</span>
          <span>• Gemini Advanced</span>
          <span>• JetBrains paketi</span>
          <span>• AWS Bedrock</span>
          <span>• Azure OpenAI</span>
          <span>• Vercel Pro</span>
        </div>
        <p>
          Listede olmayan bir araç için <strong>"Diğer (elle yaz)"</strong> seçeneğini kullanıp yazılım adını + sağlayıcısını girebilirsin (ör. Antigravity, Replit, Windsurf, Figma vb.).
        </p>
      </>
    ),
    keywords: ['araçlar', 'tools'],
    related: [{ to: '/licenses', label: 'Lisanslarım' }],
  },

  /* ============ TALEP İŞ AKIŞI ============ */
  {
    id: 'onay-suresi',
    category: 'Lisans Talepleri',
    q: 'Talebim ne kadar sürede onaylanır?',
    a: (
      <>
        <p className="mb-2">
          Admin onay sürecini hedef olarak <strong>1-2 iş günü</strong> içinde tamamlamayı planlar. Yoğun dönemlerde 3-5 güne uzayabilir.
        </p>
        <p>
          Durum takibi için <Link to="/bookings" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Taleplerim</Link> (oda) veya <Link to="/licenses" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Lisanslarım</Link> (yazılım) sayfasına bak. Durumlar:
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><span className="badge-pending">Beklemede</span> — admin henüz incelemedi</li>
          <li><span className="badge-feedback">Revize İsteniyor</span> — admin senden ek bilgi istiyor</li>
          <li><span className="badge-approved">Onaylandı</span> — talebin kabul edildi</li>
          <li><span className="badge-rejected">Reddedildi</span> — gerekçe ile birlikte ret</li>
        </ul>
      </>
    ),
    keywords: ['durum', 'status', 'onay', 'bekleme'],
    related: [
      { to: '/bookings', label: 'Taleplerim' },
      { to: '/licenses', label: 'Lisanslarım' },
    ],
  },
  {
    id: 'revize-istendi',
    category: 'Lisans Talepleri',
    q: '"Revize iste" ne demek? Reddedildi ne yapmalıyım?',
    a: (
      <>
        <p className="mb-2">
          <strong>Revize İsteniyor:</strong> Admin senden ek bilgi/açıklama bekliyor. Talep kartında admin notunu okuyup yeniden gönder. Genellikle gerekçenin daha somut olması, alternatif değerlendirme veya KVKK/uyumluluk konuları için sorulur.
        </p>
        <p>
          <strong>Reddedildi:</strong> Karar admin notuyla birlikte gelir. Reddedilen talep <strong>düzenlenemez</strong>; yeniden değerlendirme istiyorsan <strong>yeni bir talep</strong> oluşturup admin notundaki noktaları adresleyen güncellenmiş bir gerekçe yazabilirsin.
        </p>
      </>
    ),
    keywords: ['feedback', 'reddedildi', 'rejected'],
    related: [
      { to: '/bookings', label: 'Taleplerim' },
      { to: '/licenses', label: 'Lisanslarım' },
    ],
  },

  /* ============ HESAP & PROFİL ============ */
  {
    id: 'profil-guncelleme',
    category: 'Hesap & Profil',
    q: 'Profilimi (departman, ünvan, fotoğraf) nasıl güncellerim?',
    a: (
      <>
        <p className="mb-2">
          <Link to="/profile" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Profilim</Link> sayfasından:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Ad-soyad, departman, ünvan, telefon, kısa biyografi</li>
          <li>Profil fotoğrafı yükleme/değiştirme</li>
          <li>Şifre değiştirme (mevcut şifreyle)</li>
        </ul>
        <p className="mt-2">
          KVKK kapsamında <strong>verilerinin tamamını dışa aktarabilir</strong> (JSON olarak indirme) veya <strong>hesabını tamamen silebilirsin</strong>. Detay için <Link to="/privacy" className="text-kt-green-700 font-semibold hover:text-kt-gold-600">Gizlilik Ayarları</Link>.
        </p>
      </>
    ),
    keywords: ['profile', 'avatar', 'kvkk', 'gizlilik'],
    related: [
      { to: '/profile', label: 'Profilim' },
      { to: '/privacy', label: 'Gizlilik' },
    ],
  },
];

const CATEGORY_META: Record<FaqCategory, { icon: LucideIcon; tone: Tone; summary: string }> = {
  Genel: {
    icon: BookOpen,
    tone: 'cyan',
    summary: 'Platform hakkında temel bilgiler ve self-service süreçler.',
  },
  'Randevu Alma': {
    icon: Calendar,
    tone: 'gold',
    summary: 'AI Lab odaları, periyotlar ve bekleme listesi kullanımı.',
  },
  'Lisans Talepleri': {
    icon: KeyRound,
    tone: 'violet',
    summary: 'Yazılım lisansları, talep akışı ve revize/red işleyişi.',
  },
  'Hesap & Profil': {
    icon: User,
    tone: 'emerald',
    summary: 'Profil bilgileri, gizlilik tercihleri ve KVKK aksiyonları.',
  },
};

/** Tone başına: pill çip aktif/idle, preview panel glow ve aksent. */
const TONE_STYLES: Record<
  Tone,
  {
    chipActive: string;
    chipIdle: string;
    iconBg: string;
    iconColor: string;
    panelGlow: string;
    accentBar: string;
    dot: string;
    relatedBtn: string;
  }
> = {
  cyan: {
    chipActive: 'btn-pill-primary',
    chipIdle:
      'bg-cyan-50 text-cyan-800 border border-cyan-200 hover:bg-cyan-100 hover:border-cyan-300',
    iconBg: 'bg-cyan-50',
    iconColor: 'text-cyan-700',
    panelGlow: 'border border-kt-gray-100 shadow-sm',
    accentBar: 'bg-cyan-500',
    dot: 'bg-cyan-500',
    relatedBtn:
      'bg-white text-cyan-700 border border-cyan-200 hover:bg-cyan-50 hover:border-cyan-300',
  },
  gold: {
    chipActive: 'btn-pill-warning',
    chipIdle:
      'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 hover:border-amber-300',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-700',
    panelGlow: 'border border-kt-gray-100 shadow-sm',
    accentBar: 'bg-amber-500',
    dot: 'bg-amber-500',
    relatedBtn:
      'bg-white text-amber-800 border border-amber-200 hover:bg-amber-50 hover:border-amber-300',
  },
  violet: {
    chipActive: 'btn-pill-info',
    chipIdle:
      'bg-violet-50 text-violet-800 border border-violet-200 hover:bg-violet-100 hover:border-violet-300',
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-700',
    panelGlow: 'border border-kt-gray-100 shadow-sm',
    accentBar: 'bg-violet-500',
    dot: 'bg-violet-500',
    relatedBtn:
      'bg-white text-violet-700 border border-violet-200 hover:bg-violet-50 hover:border-violet-300',
  },
  emerald: {
    chipActive: 'btn-pill-success',
    chipIdle:
      'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-700',
    panelGlow: 'border border-kt-gray-100 shadow-sm',
    accentBar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    relatedBtn:
      'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300',
  },
};

const CATEGORIES: FaqCategory[] = ['Genel', 'Randevu Alma', 'Lisans Talepleri', 'Hesap & Profil'];

type CategoryFilter = 'Tümü' | FaqCategory;

export default function UserFAQ() {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('Tümü');
  const [openId, setOpenId] = useState<string>(FAQ[0].id);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ.filter((item) => {
      if (categoryFilter !== 'Tümü' && item.category !== categoryFilter) return false;
      if (!q) return true;
      if (item.q.toLowerCase().includes(q)) return true;
      if (item.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query, categoryFilter]);

  const grouped = useMemo(() => {
    const map = new Map<FaqCategory, FaqItem[]>();
    for (const cat of CATEGORIES) map.set(cat, []);
    for (const item of filtered) {
      map.get(item.category)?.push(item);
    }
    return map;
  }, [filtered]);

  const activeItem = useMemo(
    () => filtered.find((f) => f.id === openId) ?? filtered[0] ?? null,
    [filtered, openId]
  );

  // Filtre değişince açık item kaybolduysa ilk eşleşene düş (render dışında).
  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((f) => f.id === openId)) {
      setOpenId(filtered[0].id);
    }
  }, [filtered, openId]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryFilter, number>();
    counts.set('Tümü', FAQ.length);
    for (const cat of CATEGORIES) {
      counts.set(cat, FAQ.filter((f) => f.category === cat).length);
    }
    return counts;
  }, []);

  return (
    <AppShell kind="user">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* ========== HEADER ========== */}
        <header className="mb-8">
          <div className="role-badge-cyan">
            <span className="role-badge-dot bg-cyan-400" />
            Yardım Merkezi
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-kt-green-900 mb-2">
            Sıkça Sorulan Sorular
          </h1>
          <p className="text-kt-gray-600 max-w-2xl">
            Sistem nasıl çalışır, randevu/lisans nasıl alınır, talep süreçleri nasıl işler — kategoriden seçin veya arayın.
          </p>
        </header>

        {/* ========== KATEGORİ FİLTRE + ARAMA ========== */}
        <div className="mb-6 flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            {(['Tümü', ...CATEGORIES] as CategoryFilter[]).map((cat) => {
              const isActive = categoryFilter === cat;
              const tone = cat === 'Tümü' ? 'cyan' : CATEGORY_META[cat].tone;
              const t = TONE_STYLES[tone];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={
                    isActive
                      ? `${t.chipActive} btn-pill-xs`
                      : `btn-pill btn-pill-xs ${t.chipIdle}`
                  }
                >
                  {isActive && <span className="btn-pill-shimmer" />}
                  <span className="relative z-10">
                    {cat} ({categoryCounts.get(cat) ?? 0})
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full lg:w-80">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-kt-gray-400"
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="search"
              className="input pl-11"
              placeholder="Soru ara (lisans, randevu, sıra, gizlilik)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={80}
            />
          </div>
        </div>

        {/* ========== ANA İÇERİK (split layout) ========== */}
        {filtered.length === 0 ? (
          <EmptyState
            icon="search"
            tone="cyan"
            title={`"${query}" için eşleşen soru bulunamadı`}
            description="Farklı bir kelime deneyin veya farklı bir kategori seçin."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 items-start">
            {/* ===== SOL: kategori bazlı accordion ===== */}
            <div className="space-y-6 min-w-0">
              {CATEGORIES.map((cat) => {
                const items = grouped.get(cat) ?? [];
                if (items.length === 0) return null;
                const meta = CATEGORY_META[cat];
                const t = TONE_STYLES[meta.tone];
                const Icon = meta.icon;
                return (
                  <section key={cat}>
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.iconBg} ${t.iconColor}`}
                      >
                        <Icon size={14} strokeWidth={2.5} />
                      </span>
                      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-kt-gray-500">
                        {cat}
                      </h2>
                      <span className="text-[11px] font-semibold text-kt-gray-400">
                        ({items.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((item) => {
                        const isOpen = openId === item.id;
                        return (
                          <article
                            key={item.id}
                            className={`relative overflow-hidden rounded-2xl bg-white border transition-all duration-200 ${
                              isOpen
                                ? 'border-kt-gray-200 shadow-sm'
                                : 'border-kt-gray-100 hover:border-kt-gray-200'
                            }`}
                          >
                            {/* Sol kenar accent bar — aktifken görünür */}
                            <span
                              aria-hidden="true"
                              className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full transition-opacity duration-200 ${t.accentBar} ${
                                isOpen ? 'opacity-100' : 'opacity-0'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => setOpenId(isOpen ? '' : item.id)}
                              className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 group"
                              aria-expanded={isOpen}
                            >
                              <span
                                className={`text-[15px] font-semibold transition-colors ${
                                  isOpen
                                    ? 'text-kt-green-900'
                                    : 'text-kt-gray-700 group-hover:text-kt-green-900'
                                }`}
                              >
                                {item.q}
                              </span>
                              <ChevronDown
                                className={`w-4 h-4 shrink-0 text-kt-gray-400 transition-transform duration-300 ${
                                  isOpen ? 'rotate-180 text-kt-green-700' : ''
                                }`}
                                strokeWidth={2.5}
                              />
                            </button>
                            {/* Mobilde accordion içeriği — md ekrandan büyükte sağ panel zaten cevabı gösteriyor */}
                            {isOpen && (
                              <div className="md:hidden px-5 pb-5 pt-1 text-sm text-kt-gray-700 leading-relaxed border-t border-kt-gray-100 animate-fade-in">
                                {item.a}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            {/* ===== SAĞ: sticky preview panel (md+ ekranlarda) ===== */}
            <aside className="hidden md:block sticky top-24 self-start min-w-0">
              {activeItem && <PreviewPanel item={activeItem} />}
            </aside>
          </div>
        )}

        {/* ========== FOOTER CTA ========== */}
        <div className="mt-12 relative overflow-hidden rounded-2xl bg-gradient-to-br from-kt-green-950 via-kt-green-900 to-kt-green-950 p-6 md:p-8 text-center">
          <div className="absolute inset-0 bg-neural-grid-dark opacity-30 pointer-events-none" />
          <div className="absolute -top-16 left-1/3 w-72 h-32 bg-kt-gold-400/15 rounded-full blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-kt-gold-400/20 text-kt-gold-300 mb-3">
              <Sparkles size={20} />
            </div>
            <h3 className="text-lg md:text-xl font-bold text-white mb-1">
              Sorunuzun cevabını bulamadınız mı?
            </h3>
            <p className="text-white/70 text-sm mb-4">
              AI Lab ekibi her zaman yardımcı olmaya hazır.
            </p>
            <a
              href="mailto:ai.lab@klab.test"
              className="btn-pill-gold btn-pill-sm inline-flex"
            >
              <span className="btn-pill-shimmer" />
              <span className="relative z-10 flex items-center gap-2">
                <Mail size={14} />
                ai.lab@klab.test
              </span>
            </a>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ============================================================
 * PREVIEW PANEL — sağda sticky kart (md+).
 * Aktif sorunun kategori glow'unu + cevabını + ilgili linklerini gösterir.
 * ============================================================ */
function PreviewPanel({ item }: { item: FaqItem }) {
  const meta = CATEGORY_META[item.category];
  const t = TONE_STYLES[meta.tone];
  const Icon = meta.icon;

  return (
    <div
      key={item.id}
      className={`relative overflow-hidden rounded-2xl bg-white animate-fade-in ${t.panelGlow}`}
    >
      {/* Üst aksan şeridi — sade tek renk */}
      <div className={`h-1 w-full ${t.accentBar}`} />

      <div className="relative p-6">
        {/* Kategori başlığı */}
        <div className="flex items-center gap-2.5 mb-4">
          <span
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.iconBg} ${t.iconColor}`}
          >
            <Icon size={18} strokeWidth={2.25} />
          </span>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-kt-gray-500 truncate">
              {item.category}
            </span>
          </div>
        </div>

        {/* Soru başlığı */}
        <h3 className="text-xl font-bold text-kt-green-900 mb-3 leading-tight">
          {item.q}
        </h3>

        {/* Kategori özeti (her kart için aynı kategori summary — orientation) */}
        <p className="text-xs text-kt-gray-500 italic mb-4 pb-4 border-b border-kt-gray-100">
          {meta.summary}
        </p>

        {/* Cevap içeriği */}
        <div className="text-sm text-kt-gray-700 leading-relaxed">{item.a}</div>

        {/* Hızlı erişim CTA'ları */}
        {item.related && item.related.length > 0 && (
          <div className="mt-5 pt-5 border-t border-kt-gray-100">
            <div className="flex items-center gap-1.5 mb-3">
              <HelpCircle size={12} className="text-kt-gray-400" />
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-kt-gray-500">
                İlgili sayfalar
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {item.related.map((r) => (
                <Link
                  key={r.to}
                  to={r.to}
                  className={`btn-pill btn-pill-xs ${t.relatedBtn} no-underline`}
                >
                  <span className="relative z-10 flex items-center gap-1.5">
                    {r.label}
                    <ArrowRight size={12} strokeWidth={2.5} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
