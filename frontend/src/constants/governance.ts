/**
 * Yönetişim referans sabitleri — AI Lab Vibe Coding Yönetişim Kılavuzu v2.1.
 *
 * Salt-gösterim içerik (MD standartları, RACI, güvenlik kuralları, aşama
 * meta verisi). Yönetişim MANTIĞI backend `governance-data.ts` dosyasındadır.
 */
import type { GovernanceRole, LifecycleStage, ProjectType } from '../types';

/* ============================================================
 * YAŞAM DÖNGÜSÜ AŞAMALARI
 * ============================================================ */

export const STAGE_ORDER: LifecycleStage[] = [
  'application',
  'development',
  'stage',
  'production',
  'live',
];

export interface StageMeta {
  key: LifecycleStage;
  label: string;
  icon: string;
  description: string;
  targetDuration: string;
}

export const STAGE_META: Record<LifecycleStage, StageMeta> = {
  application: {
    key: 'application',
    label: 'Başvuru',
    icon: '📋',
    description: 'Talep formu → Analitik Danışman ön değerlendirme.',
    targetDuration: '1 gün',
  },
  development: {
    key: 'development',
    label: 'Geliştirme',
    icon: '🛠',
    description: 'Vibe coding + 5 ajan kalite kapısı.',
    targetDuration: 'serbest',
  },
  stage: {
    key: 'stage',
    label: 'Test',
    icon: '🧪',
    description: 'Docker + K8s stage deploy + insan onayı.',
    targetDuration: '1–2 gün',
  },
  production: {
    key: 'production',
    label: 'Pre-Production',
    icon: '🚀',
    description: 'Deploy + post-deploy izleme + insan onayı.',
    targetDuration: 'aynı gün',
  },
  live: {
    key: 'live',
    label: 'Canlı',
    icon: '✅',
    description: 'Proje canlıda — tüm kapılar ve onaylar tamamlandı.',
    targetDuration: '—',
  },
};

/** Aşamanın yaşam döngüsündeki sıra indeksi (0 tabanlı). */
export function stageIndex(stage: LifecycleStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/* ============================================================
 * YÖNETİŞİM ROLLERİ
 * ============================================================ */

export const GOVERNANCE_ROLE_LABEL: Record<GovernanceRole, string> = {
  analitik_danisman: 'Analitik Danışman',
  lab_muhendisi: 'Lab Mühendisi',
  yz_arge: 'YZ / Ar-Ge Mühendisi',
};

/* ============================================================
 * MD STANDARTLARI — değiştirilemez referanslar (kılavuz §4.1)
 * ============================================================ */

export interface MdStandard {
  code: string;
  title: string;
  scope: string;
}

export const MD_STANDARDS: MdStandard[] = [
  {
    code: 'OBA/BOA-MD-001',
    title: 'Kurumsal Mimari',
    scope:
      'Servis sınırları, mikroservis ayrışımı, entegrasyon kalıpları, frontend & backend katman yapısı.',
  },
  {
    code: 'GUV-MD-001',
    title: 'Uygulama Güvenliği',
    scope: 'Güvenli kod standartları, SAST, secret yönetimi, container hardening.',
  },
  {
    code: 'BGV-MD-001',
    title: 'Bilgi Güvenliği',
    scope: 'Veri sınıflandırma, erişim, loglama, DLP ve dışa veri çıkış kısıtları.',
  },
  {
    code: 'DIL-MD-001',
    title: 'Dil & Sürüm',
    scope: '.NET, Python, Node.js için kurumca izin verilen dil ve sürüm matrisi.',
  },
  {
    code: 'VTB-MD-001',
    title: 'Veritabanı',
    scope: 'Desteklenen DB, cache (Redis) ve mesajlaşma (Kafka/RabbitMQ) teknolojileri.',
  },
];

/* ============================================================
 * GÜVENLİK KURALLARI — değiştirilemez (kılavuz §5)
 * ============================================================ */

export interface SecurityRule {
  severity: 'critical' | 'warning';
  rule: string;
  detail: string;
}

export const SECURITY_RULES: SecurityRule[] = [
  {
    severity: 'critical',
    rule: 'Gerçek banka verisi kullanılamaz',
    detail: 'Yalnızca sentetik veya kamuya açık veri; ihlal → Lab erişimi askıya alınır.',
  },
  {
    severity: 'critical',
    rule: 'Secret koda gömülemez',
    detail: 'Vault veya env variable zorunlu; Security Agent her PR’da tarar.',
  },
  {
    severity: 'critical',
    rule: 'Kritik CVE ile deploy yapılamaz',
    detail: 'Container imajında kritik zafiyet varsa Release Governor dağıtımı durdurur.',
  },
  {
    severity: 'warning',
    rule: 'Minimum yetki prensibi',
    detail: 'Uygulama yalnızca ihtiyaç duyduğu kaynaklara erişir; dış servis Lab Mühendisi onayı ister.',
  },
  {
    severity: 'warning',
    rule: 'Loglar kişisel/hassas veri içeremez',
    detail: 'Structured JSON log zorunlu; kişisel tanımlayıcı, hesap no loglarda yer alamaz.',
  },
  {
    severity: 'warning',
    rule: 'İzolasyon kuralı',
    detail: 'AI Lab, banka iç sistemlerine, AD/LDAP ve üretim DB’lerine doğrudan bağlanamaz.',
  },
];

/* ============================================================
 * RACI MATRİSİ (kılavuz §7)
 * ============================================================ */

export type RaciValue = 'R/A' | 'R' | 'A' | 'C' | 'I' | '—';

export const RACI_ROLES = [
  'Talep Sahibi',
  'Lab Mühendisi',
  'YZ/Ar-Ge Müh.',
  'Analitik Danışman',
  'Ajan',
] as const;

export interface RaciRow {
  activity: string;
  values: [RaciValue, RaciValue, RaciValue, RaciValue, RaciValue];
}

export const RACI_MATRIX: RaciRow[] = [
  { activity: 'Fikir başvurusu', values: ['R/A', 'C', 'I', 'C', '—'] },
  { activity: 'Başvuru değerlendirme', values: ['I', 'C', 'C', 'R/A', '—'] },
  { activity: 'Ortam & lisans atama', values: ['I', 'R/A', 'C', 'C', '—'] },
  { activity: 'Teknik danışmanlık', values: ['C', 'R/A', 'C', 'I', '—'] },
  { activity: 'Ajan kalite denetimleri', values: ['I', 'I', 'I', 'I', 'R/A'] },
  { activity: 'Stage onayı', values: ['I', 'C', 'R/A', 'I', 'C'] },
  { activity: 'Production onayı', values: ['I', 'I', 'R/A', 'I', 'C'] },
  { activity: 'Rollback kararı', values: ['I', 'C', 'R/A', 'I', 'C'] },
];

export const RACI_LEGEND: Record<string, string> = {
  R: 'Responsible — Yapan',
  A: 'Accountable — Hesap Veren',
  C: 'Consulted — Danışılan',
  I: 'Informed — Bilgilendirilen',
};

/* ============================================================
 * KALİTE KAPISI SİHİRBAZI — "Bana hangi kapılar uygulanır?"
 * ============================================================ */

export interface GatePlanItem {
  label: string;
  agent: string;
  applies: boolean;
}

/**
 * Proje türü + dış servis erişimine göre uygulanacak kalite kapısı planı.
 */
export function gatePlan(projectType: ProjectType, usesExternalApi: boolean): {
  governanceLevel: 'basic' | 'full';
  gates: GatePlanItem[];
  notes: string[];
} {
  const full = projectType === 'integration';
  const gates: GatePlanItem[] = [
    { label: 'Build & Lint', agent: 'Bug Fix Agent', applies: true },
    { label: 'Kod Kalitesi (test ≥ %70)', agent: 'Code Review Agent', applies: true },
    { label: 'Mimari Uyum (≥ 85/100)', agent: 'Architecture Agent', applies: full },
    { label: 'Framework Uyumu (≥ 90/100)', agent: 'Framework Agent', applies: full },
    { label: 'Güvenlik Taraması (CVE = 0)', agent: 'Security Agent', applies: true },
  ];
  const notes: string[] = [];
  notes.push(
    full
      ? 'Kuruma Entegre: tam pipeline + OBA/BOA mimari uyumu + DIL/VTB standartları zorunlu.'
      : 'Deneysel (PoC): temel güvenlik + kalite kontrolü. Prod’a taşımadan tür yükseltmesi gerekir.'
  );
  if (usesExternalApi) {
    notes.push(
      'Dış servis/API erişimi: güvenlik taraması derinleştirilir; erişim Lab Mühendisi onayı gerektirir.'
    );
  }
  return { governanceLevel: full ? 'full' : 'basic', gates, notes };
}
