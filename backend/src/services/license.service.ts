/**
 * Lisans analiz servisi.
 *
 * Kullanım amacı: Kullanıcıların `technologies` alanında belirttiği araçlar
 * (Cursor, Claude, GPT vb.) lisanslı yazılımlardır. Bu servis hangi lisansın
 * kim tarafından kullanıldığını + aylık tahmini maliyeti raporlar.
 *
 * Tahmini maliyetler: Public liste fiyatları (Mayıs 2026 itibarıyla).
 * Production'da bu rakamlar IT/Finance tarafından SoT kaynağıyla senkronize
 * edilmeli. Para birimi: USD (frontend tarafında ₺ çevirimi yapılabilir).
 *
 * Mantık:
 * - Lisanslı teknolojiler için sabit `LICENSE_CATALOG` map var.
 * - Bir user'ın aktif/pending/feedback booking'lerinden `technologies`
 *   listelerini topla → dedup → her bir lisanslı teknoloji için cost ekle.
 * - "Aktif" tanımı: status IN (approved, pending, feedback_requested) VE
 *   end_date >= bugün. Gelecekte başlayacak booking'ler de taahhüt edilmiş
 *   maliyet olarak rapora dahildir (bilinçli).
 *
 * Güvenlik:
 *  - SQL parameterized (app_security §3).
 *  - Sadece admin endpoint'ten erişilir.
 *  - Çıktıda PII (e-posta) sadece admin'e döner — public değil.
 */
import { dbAll } from '../db/schema';
import { ymdLocal } from '../utils/dates';

/**
 * Lisans kataloğu. Anahtar: küçük harfli + normalleştirilmiş teknoloji adı.
 * `tier`: 'paid' → maliyet hesaplanır; 'free' → 0; 'enterprise' → ortak/belirsiz.
 */
export interface LicenseInfo {
  /** Kanonik görüntü adı. */
  name: string;
  /** Aylık tahmini maliyet (USD). 0 ise ücretsiz. */
  monthlyUsd: number;
  /** Kategori — UI'da grup başlığı. */
  category: 'AI Assistant' | 'IDE' | 'Cloud' | 'API' | 'Framework' | 'Database';
  /** Tier. */
  tier: 'paid' | 'free' | 'enterprise';
  /** Sağlayıcı (gösterimi için). */
  vendor: string;
}

export const LICENSE_CATALOG: Record<string, LicenseInfo> = {
  cursor:         { name: 'Cursor',         monthlyUsd: 20, category: 'IDE',          tier: 'paid', vendor: 'Cursor' },
  claude:         { name: 'Claude',         monthlyUsd: 20, category: 'AI Assistant', tier: 'paid', vendor: 'Anthropic' },
  'claude code':  { name: 'Claude Code',    monthlyUsd: 20, category: 'AI Assistant', tier: 'paid', vendor: 'Anthropic' },
  gpt:            { name: 'ChatGPT Plus',   monthlyUsd: 20, category: 'AI Assistant', tier: 'paid', vendor: 'OpenAI' },
  openai:         { name: 'OpenAI API',     monthlyUsd: 30, category: 'API',          tier: 'paid', vendor: 'OpenAI' },
  gemini:         { name: 'Gemini Advanced',monthlyUsd: 20, category: 'AI Assistant', tier: 'paid', vendor: 'Google' },
  'github copilot':{ name: 'GitHub Copilot', monthlyUsd: 10, category: 'AI Assistant', tier: 'paid', vendor: 'GitHub' },
  copilot:        { name: 'GitHub Copilot', monthlyUsd: 10, category: 'AI Assistant', tier: 'paid', vendor: 'GitHub' },
  jetbrains:      { name: 'JetBrains All',  monthlyUsd: 69, category: 'IDE',          tier: 'paid', vendor: 'JetBrains' },
  intellij:       { name: 'IntelliJ IDEA',  monthlyUsd: 17, category: 'IDE',          tier: 'paid', vendor: 'JetBrains' },
  webstorm:       { name: 'WebStorm',       monthlyUsd: 16, category: 'IDE',          tier: 'paid', vendor: 'JetBrains' },
  pycharm:        { name: 'PyCharm Pro',    monthlyUsd: 12, category: 'IDE',          tier: 'paid', vendor: 'JetBrains' },
  'aws bedrock':  { name: 'AWS Bedrock',    monthlyUsd: 50, category: 'Cloud',        tier: 'paid', vendor: 'AWS' },
  bedrock:        { name: 'AWS Bedrock',    monthlyUsd: 50, category: 'Cloud',        tier: 'paid', vendor: 'AWS' },
  azure:          { name: 'Azure OpenAI',   monthlyUsd: 80, category: 'Cloud',        tier: 'paid', vendor: 'Microsoft' },
  vercel:         { name: 'Vercel Pro',     monthlyUsd: 20, category: 'Cloud',        tier: 'paid', vendor: 'Vercel' },
  // Açık kaynak / ücretsiz (kayıt için var, maliyet 0)
  langchain:      { name: 'LangChain',      monthlyUsd: 0,  category: 'Framework',    tier: 'free', vendor: 'OSS' },
  llamaindex:     { name: 'LlamaIndex',     monthlyUsd: 0,  category: 'Framework',    tier: 'free', vendor: 'OSS' },
  react:          { name: 'React',          monthlyUsd: 0,  category: 'Framework',    tier: 'free', vendor: 'OSS' },
  'next.js':      { name: 'Next.js',        monthlyUsd: 0,  category: 'Framework',    tier: 'free', vendor: 'OSS' },
  vue:            { name: 'Vue',            monthlyUsd: 0,  category: 'Framework',    tier: 'free', vendor: 'OSS' },
  'node.js':      { name: 'Node.js',        monthlyUsd: 0,  category: 'Framework',    tier: 'free', vendor: 'OSS' },
  python:         { name: 'Python',         monthlyUsd: 0,  category: 'Framework',    tier: 'free', vendor: 'OSS' },
  typescript:     { name: 'TypeScript',     monthlyUsd: 0,  category: 'Framework',    tier: 'free', vendor: 'OSS' },
  postgres:       { name: 'PostgreSQL',     monthlyUsd: 0,  category: 'Database',     tier: 'free', vendor: 'OSS' },
  postgresql:     { name: 'PostgreSQL',     monthlyUsd: 0,  category: 'Database',     tier: 'free', vendor: 'OSS' },
  sqlite:         { name: 'SQLite',         monthlyUsd: 0,  category: 'Database',     tier: 'free', vendor: 'OSS' },
  redis:          { name: 'Redis',          monthlyUsd: 0,  category: 'Database',     tier: 'free', vendor: 'OSS' },
  docker:         { name: 'Docker',         monthlyUsd: 0,  category: 'Cloud',        tier: 'free', vendor: 'OSS' },
  kubernetes:     { name: 'Kubernetes',     monthlyUsd: 0,  category: 'Cloud',        tier: 'free', vendor: 'OSS' },
};

function normalize(tech: string): string {
  return tech.trim().toLowerCase();
}

/**
 * Bir teknoloji adından LicenseInfo döner.
 * Bilinmeyen teknoloji için null döner (cost = 0 sayılır).
 */
export function lookupLicense(tech: string): LicenseInfo | null {
  return LICENSE_CATALOG[normalize(tech)] ?? null;
}

export interface UserLicenseUsage {
  userId: string;
  userFullName: string;
  userEmail: string;
  department: string | null;
  /** Kullanılan farklı lisanslar (dedup). */
  licenses: Array<{
    technology: string;
    name: string;
    category: string;
    monthlyUsd: number;
    tier: 'paid' | 'free' | 'enterprise';
    vendor: string;
    /** Bu lisansın geçtiği aktif booking sayısı. */
    bookingCount: number;
  }>;
  /** Aylık toplam tahmini maliyet (USD). */
  totalMonthlyUsd: number;
  /** Aktif / pending booking sayısı. */
  activeBookingCount: number;
}

export interface LicenseSummary {
  technology: string;
  name: string;
  category: string;
  tier: 'paid' | 'free' | 'enterprise';
  monthlyUsd: number;
  vendor: string;
  /** Kaç farklı user bu lisansı talep etti? */
  userCount: number;
  /** Toplam aktif booking'lerde geçme sayısı. */
  bookingCount: number;
  /** Aylık toplam maliyet (userCount × monthlyUsd). */
  totalMonthlyUsd: number;
  /** Bu lisansı kullanan kullanıcı isim listesi (privacy: sadece admin). */
  users: Array<{ id: string; fullName: string; email: string }>;
}

export interface LicenseReport {
  generatedAt: string;
  /** Her user için lisans kullanım özeti. */
  byUser: UserLicenseUsage[];
  /** Her lisans için toplam kullanım. */
  bySoftware: LicenseSummary[];
  /** Tüm toplam metrikler. */
  totals: {
    totalUsers: number;
    paidLicenseUsers: number;
    totalMonthlyUsd: number;
    totalAnnualUsd: number;
    distinctLicensesUsed: number;
    paidLicenseCount: number;
    freeLicenseCount: number;
  };
}

interface BookingRow {
  user_id: string;
  user_full_name: string;
  user_email: string;
  department: string | null;
  technologies: string;
  status: string;
  start_date: string;
  end_date: string;
  booking_id: string;
}

/**
 * Aktif lisans kullanımını hesaplar.
 *
 * "Aktif" tanımı: status IN ('approved','pending','feedback_requested')
 * AND end_date >= bugün (geçmiş booking'ler lisans tutmaz).
 */
export async function getLicenseReport(): Promise<LicenseReport> {
  const today = ymdLocal();

  const rows = await dbAll(`SELECT b.id AS booking_id, b.user_id, b.technologies, b.status,
              b.start_date, b.end_date,
              u.full_name AS user_full_name, u.email AS user_email, u.department
       FROM bookings b
       INNER JOIN users u ON u.id = b.user_id
       WHERE b.status IN ('approved', 'pending', 'feedback_requested')
         AND b.end_date >= ?
         AND u.status != 3
       ORDER BY u.full_name ASC`, [today]) as BookingRow[];

  // Per-user aggregation
  const userMap = new Map<string, UserLicenseUsage>();
  // Per-license aggregation
  const licMap = new Map<
    string,
    {
      info: LicenseInfo;
      key: string;
      userIds: Set<string>;
      bookingCount: number;
      users: Map<string, { id: string; fullName: string; email: string }>;
    }
  >();

  for (const row of rows) {
    // Technologies parse
    let techs: string[] = [];
    try {
      const parsed = JSON.parse(row.technologies) as unknown;
      if (Array.isArray(parsed))
        techs = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      continue;
    }

    // User accumulator
    let userEntry = userMap.get(row.user_id);
    if (!userEntry) {
      userEntry = {
        userId: row.user_id,
        userFullName: row.user_full_name,
        userEmail: row.user_email,
        department: row.department,
        licenses: [],
        totalMonthlyUsd: 0,
        activeBookingCount: 0,
      };
      userMap.set(row.user_id, userEntry);
    }
    userEntry.activeBookingCount += 1;

    // Her teknoloji için lisans lookup. DEDUP KANONİK İSİM üzerinden:
    // katalogda alias anahtarlar var ('copilot' + 'github copilot' aynı ürün) —
    // ham string ile dedup aynı lisansı iki kez sayıp bütçeyi şişiriyordu.
    const seenInBooking = new Set<string>();
    for (const techRaw of techs) {
      const info = lookupLicense(techRaw);
      if (!info) continue; // tanınmayan teknoloji → skip

      const key = normalize(info.name);
      if (seenInBooking.has(key)) continue;
      seenInBooking.add(key);

      // User entry'sinde bu lisans daha önce sayıldı mı? (kanonik isimle)
      const existing = userEntry.licenses.find((l) => normalize(l.name) === key);
      if (existing) {
        existing.bookingCount += 1;
      } else {
        userEntry.licenses.push({
          technology: techRaw,
          name: info.name,
          category: info.category,
          monthlyUsd: info.monthlyUsd,
          tier: info.tier,
          vendor: info.vendor,
          bookingCount: 1,
        });
        userEntry.totalMonthlyUsd += info.monthlyUsd;
      }

      // Per-license map
      let licEntry = licMap.get(key);
      if (!licEntry) {
        licEntry = {
          info,
          key,
          userIds: new Set(),
          bookingCount: 0,
          users: new Map(),
        };
        licMap.set(key, licEntry);
      }
      licEntry.bookingCount += 1;
      if (!licEntry.userIds.has(row.user_id)) {
        licEntry.userIds.add(row.user_id);
        licEntry.users.set(row.user_id, {
          id: row.user_id,
          fullName: row.user_full_name,
          email: row.user_email,
        });
      }
    }
  }

  const byUser = [...userMap.values()].sort(
    (a, b) => b.totalMonthlyUsd - a.totalMonthlyUsd
  );

  const bySoftware: LicenseSummary[] = [...licMap.values()]
    .map((l) => ({
      technology: l.key,
      name: l.info.name,
      category: l.info.category,
      tier: l.info.tier,
      monthlyUsd: l.info.monthlyUsd,
      vendor: l.info.vendor,
      userCount: l.userIds.size,
      bookingCount: l.bookingCount,
      totalMonthlyUsd: l.info.monthlyUsd * l.userIds.size,
      users: [...l.users.values()],
    }))
    .sort((a, b) => b.totalMonthlyUsd - a.totalMonthlyUsd || b.userCount - a.userCount);

  // Toplamlar
  const totalMonthlyUsd = bySoftware.reduce((s, l) => s + l.totalMonthlyUsd, 0);
  const paidLicenseUsers = byUser.filter((u) => u.totalMonthlyUsd > 0).length;
  const paidLicenseCount = bySoftware.filter((l) => l.tier === 'paid').length;
  const freeLicenseCount = bySoftware.filter((l) => l.tier === 'free').length;

  return {
    generatedAt: new Date().toISOString(),
    byUser,
    bySoftware,
    totals: {
      totalUsers: byUser.length,
      paidLicenseUsers,
      totalMonthlyUsd,
      totalAnnualUsd: totalMonthlyUsd * 12,
      distinctLicensesUsed: bySoftware.length,
      paidLicenseCount,
      freeLicenseCount,
    },
  };
}

/**
 * Bir kullanıcının kendi lisans kullanımını döner (self-service için).
 * IDOR: yalnız çağıran user için.
 */
export async function getUserLicenseUsage(userId: string): Promise<UserLicenseUsage | null> {
  const report = await getLicenseReport();
  return report.byUser.find((u) => u.userId === userId) ?? null;
}
