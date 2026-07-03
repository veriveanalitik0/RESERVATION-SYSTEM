/**
 * Yönetişim sabitleri — AI Lab Vibe Coding Yönetişim Kılavuzu v2.1.
 *
 * Bu dosya yönetişim MANTIĞININ tek kaynağıdır:
 *  - Yaşam döngüsü aşamaları ve geçiş sırası
 *  - Kalite kapısı tanımları + eşikleri + hangi yönetişim seviyesine uygulandığı
 *  - SLA süreleri
 *
 * MD standartları, RACI ve güvenlik kuralları gibi salt-gösterim referans
 * içeriği frontend `constants/governance.ts` dosyasındadır.
 */

/* ============================================================
 * YAŞAM DÖNGÜSÜ AŞAMALARI
 * ============================================================ */

export type LifecycleStage =
  | 'application'
  | 'development'
  | 'stage'
  | 'production'
  | 'live';

/** Aşamaların ilerleme sırası. */
export const STAGE_ORDER: LifecycleStage[] = [
  'application',
  'development',
  'stage',
  'production',
  'live',
];

// Görünen adlar (iç enum değerleri sabit): stage→Test, production→Pre-Production.
export const STAGE_LABEL: Record<LifecycleStage, string> = {
  application: 'Başvuru',
  development: 'Geliştirme',
  stage: 'Test',
  production: 'Pre-Production',
  live: 'Canlı',
};

/* ============================================================
 * YÖNETİŞİM SEVİYESİ
 * ============================================================ */

export type GovernanceLevel = 'basic' | 'full';

/** Proje türünden yönetişim seviyesi türetilir (kılavuz §3). */
export function governanceLevelForProjectType(
  projectType: 'poc' | 'integration'
): GovernanceLevel {
  return projectType === 'integration' ? 'full' : 'basic';
}

/* ============================================================
 * KALİTE KAPILARI — 6 yönetişim ajanı
 * ============================================================ */

export type GateKey =
  | 'build'
  | 'code_review'
  | 'architecture'
  | 'framework'
  | 'security';

export interface GateDefinition {
  key: GateKey;
  label: string;
  agent: string;
  /** Sayısal eşik (varsa). null ise geç/kal mantığı (CVE=0, build OK gibi). */
  threshold: number | null;
  /** Eşik birimi gösterimi. */
  thresholdUnit: string | null;
  referenceMd: string;
  /** Hangi yönetişim seviyelerinde uygulanır. */
  appliesTo: GovernanceLevel[];
}

export const GATE_DEFINITIONS: Record<GateKey, GateDefinition> = {
  build: {
    key: 'build',
    label: 'Build & Lint',
    agent: 'Bug Fix Agent',
    threshold: null,
    thresholdUnit: null,
    referenceMd: 'DIL-MD-001',
    appliesTo: ['basic', 'full'],
  },
  code_review: {
    key: 'code_review',
    label: 'Kod Kalitesi',
    agent: 'Code Review Agent',
    threshold: 70,
    thresholdUnit: '% test kapsamı',
    referenceMd: 'Kod İnceleme Rehberi',
    appliesTo: ['basic', 'full'],
  },
  architecture: {
    key: 'architecture',
    label: 'Mimari Uyum',
    agent: 'Architecture Agent',
    threshold: 85,
    thresholdUnit: '/ 100',
    referenceMd: 'OBA/BOA-MD-001',
    appliesTo: ['full'],
  },
  framework: {
    key: 'framework',
    label: 'Framework Uyumu',
    agent: 'Framework Agent',
    threshold: 90,
    thresholdUnit: '/ 100',
    referenceMd: 'OBA-FE/BE-MD-001',
    appliesTo: ['full'],
  },
  security: {
    key: 'security',
    label: 'Güvenlik Taraması',
    agent: 'Security Agent',
    threshold: null,
    thresholdUnit: null,
    referenceMd: 'GUV-MD-001 / BGV-MD-001',
    appliesTo: ['basic', 'full'],
  },
};

/** Verilen yönetişim seviyesine uygulanan kapı anahtarları (sıralı). */
export function applicableGates(level: GovernanceLevel): GateKey[] {
  return (Object.keys(GATE_DEFINITIONS) as GateKey[]).filter((k) =>
    GATE_DEFINITIONS[k].appliesTo.includes(level)
  );
}

/* ============================================================
 * SLA — hedef yanıt süreleri (saat)
 * ============================================================ */

export const SLA_HOURS = {
  /** Başvuru → Analitik Danışman ön değerlendirme. */
  application: 24,
  /** SWAT multidisipliner inceleme. */
  swat: 120,
  /** Stage insan onayı. */
  stage_approval: 4,
  /** Production insan onayı. */
  production_approval: 24,
} as const;

/* ============================================================
 * YÖNETİŞİM ROLLERİ
 * ============================================================ */

export type GovernanceRole = 'analitik_danisman' | 'lab_muhendisi' | 'yz_arge';

export const GOVERNANCE_ROLE_LABEL: Record<GovernanceRole, string> = {
  analitik_danisman: 'Analitik Danışman',
  lab_muhendisi: 'Lab Mühendisi',
  yz_arge: 'YZ / Ar-Ge Mühendisi',
};
