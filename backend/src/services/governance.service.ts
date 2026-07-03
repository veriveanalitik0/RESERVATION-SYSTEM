/**
 * Yönetişim yaşam döngüsü servisi — AI Lab Vibe Coding Kılavuzu v2.1.
 *
 * Projenin 4 aşamalı yaşam döngüsünü yönetir:
 *   application → development → stage → production → live
 *
 * Geçiş kapıları:
 *   application  → development : başvuru onaylandı (reviewLicenseRequest)
 *   development  → stage       : tüm uygulanabilir kalite kapıları 'passed'
 *   stage        → production  : Stage insan onayı 'approved'
 *   production   → live        : Production insan onayı 'approved'
 *
 * Bağımlılık yönü: license-request.service → governance.service (tek yönlü).
 * Bu servis license-request.service'i import ETMEZ (döngü olmaması için).
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun, dbTx } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import {
  STAGE_ORDER,
  SLA_HOURS,
  governanceLevelForProjectType,
  type GovernanceLevel,
  type LifecycleStage,
} from './governance-data';
import { initGatesForRequest, allGatesPassed } from './quality-gate.service';
import {
  createPendingApproval,
  type ApprovalType,
} from './human-approval.service';

/* ============================================================
 * AŞAMA OLAYLARI (audit zaman çizelgesi)
 * ============================================================ */

export interface StageEvent {
  id: string;
  requestId: string;
  fromStage: string | null;
  toStage: string;
  actorId: string | null;
  actorType: 'user' | 'admin' | 'system' | null;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

interface StageEventRow {
  id: string;
  request_id: string;
  from_stage: string | null;
  to_stage: string;
  actor_id: string | null;
  actor_type: 'user' | 'admin' | 'system' | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

const SELECT_STAGE_EVENT = `
  SELECT e.*, COALESCE(ad.full_name, us.full_name) AS actor_name
  FROM project_stage_events e
  LEFT JOIN admins ad ON ad.id = e.actor_id
  LEFT JOIN users us ON us.id = e.actor_id
`;

function rowToStageEvent(row: StageEventRow): StageEvent {
  return {
    id: row.id,
    requestId: row.request_id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    actorId: row.actor_id,
    actorType: row.actor_type,
    actorName: row.actor_name,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Yaşam döngüsü geçiş aktörünün tipi — audit zaman çizelgesi için. */
export type StageActorType = 'user' | 'admin' | 'danisman' | 'arge' | 'system';

/** Bir yaşam döngüsü geçişini audit zaman çizelgesine kaydeder. */
export async function recordStageEvent(args: {
  requestId: string;
  fromStage: string | null;
  toStage: string;
  actorId?: string | null;
  actorType?: StageActorType;
  note?: string | null;
}): Promise<void> {
  await dbRun(`INSERT INTO project_stage_events
       (id, request_id, from_stage, to_stage, actor_id, actor_type, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, [nanoid(),
    args.requestId,
    args.fromStage,
    args.toStage,
    args.actorId ?? null,
    args.actorType ?? 'system',
    args.note?.trim() || null]);
}

export async function listStageEvents(requestId: string): Promise<StageEvent[]> {
  const rows = await dbAll(`${SELECT_STAGE_EVENT} WHERE e.request_id = ? ORDER BY e.created_at ASC`, [requestId]) as StageEventRow[];
  return rows.map(rowToStageEvent);
}

export async function listStageEventsForRequests(
  requestIds: string[]
): Promise<Map<string, StageEvent[]>> {
  const map = new Map<string, StageEvent[]>();
  if (requestIds.length === 0) return map;
  const placeholders = requestIds.map(() => '?').join(',');
  const rows = await dbAll(`${SELECT_STAGE_EVENT} WHERE e.request_id IN (${placeholders})
       ORDER BY e.created_at ASC`, [...requestIds]) as StageEventRow[];
  for (const r of rows) {
    const list = map.get(r.request_id) ?? [];
    list.push(rowToStageEvent(r));
    map.set(r.request_id, list);
  }
  return map;
}

/* ============================================================
 * SLA HESABI
 * ============================================================ */

export interface SlaInfo {
  checkpoint: string;
  deadline: string;
  slaHours: number;
  remainingHours: number;
  overdue: boolean;
}

interface SlaSubject {
  id: string;
  lifecycleStage: LifecycleStage;
  status: string;
  reviewTrack: 'standard' | 'swat';
  createdAt: string;
}

function buildSla(checkpoint: string, startIso: string, slaHours: number): SlaInfo {
  const deadlineMs = new Date(startIso).getTime() + slaHours * 3600_000;
  const remainingHours = (deadlineMs - Date.now()) / 3600_000;
  return {
    checkpoint,
    deadline: new Date(deadlineMs).toISOString(),
    slaHours,
    remainingHours: Math.round(remainingHours * 10) / 10,
    overdue: remainingHours < 0,
  };
}

/**
 * Talebin o an beklediği SLA kontrol noktasını hesaplar.
 * Aktif bir bekleme yoksa null döner.
 */
export async function computeSla(subject: SlaSubject): Promise<SlaInfo | null> {
  // Başvuru aşaması — değerlendirme bekliyor.
  if (
    subject.lifecycleStage === 'application' &&
    (subject.status === 'pending' || subject.status === 'feedback_requested')
  ) {
    if (subject.reviewTrack === 'swat') {
      return buildSla('SWAT İnceleme', subject.createdAt, SLA_HOURS.swat);
    }
    return buildSla('Başvuru Değerlendirme', subject.createdAt, SLA_HOURS.application);
  }

  // Stage / Production — bekleyen insan onayı varsa onun SLA'sı.
  if (subject.lifecycleStage === 'stage' || subject.lifecycleStage === 'production') {
    const type: ApprovalType = subject.lifecycleStage === 'stage' ? 'stage' : 'production';
    const pending = await dbOne(`SELECT created_at FROM human_approvals
         WHERE request_id = ? AND approval_type = ? AND decision = 'pending'`, [subject.id, type]) as { created_at: string } | undefined;
    if (pending) {
      const hours =
        type === 'stage' ? SLA_HOURS.stage_approval : SLA_HOURS.production_approval;
      const label = type === 'stage' ? 'Stage Onayı' : 'Production Onayı';
      return buildSla(label, pending.created_at, hours);
    }
  }

  return null;
}

/* ============================================================
 * YAŞAM DÖNGÜSÜ GEÇİŞLERİ
 * ============================================================ */

interface RequestLifecycleRow {
  id: string;
  lifecycle_stage: LifecycleStage;
  governance_level: GovernanceLevel;
  status: string;
  project_type: 'poc' | 'integration' | null;
}

async function loadLifecycleRow(requestId: string): Promise<RequestLifecycleRow> {
  const row = await dbOne(`SELECT id, lifecycle_stage, governance_level, status, project_type
       FROM license_requests WHERE id = ?`, [requestId]) as RequestLifecycleRow | undefined;
  if (!row) {
    throw new HttpError(404, 'Talep bulunamadı.', 'LICENSE_REQUEST_NOT_FOUND');
  }
  return row;
}

/**
 * Başvuru onaylandığında çağrılır (reviewLicenseRequest → approve).
 * Projeyi 'development' aşamasına taşır, kalite kapılarını oluşturur.
 */
export async function onApplicationApproved(
  requestId: string,
  actorId: string,
  actorType: StageActorType = 'admin'
): Promise<void> {
  const row = await loadLifecycleRow(requestId);
  if (row.lifecycle_stage !== 'application') return; // idempotent

  await dbRun(`UPDATE license_requests
     SET lifecycle_stage = 'development', stage_entered_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [requestId]);

  await initGatesForRequest(requestId, row.governance_level);
  await recordStageEvent({
    requestId,
    fromStage: 'application',
    toStage: 'development',
    actorId,
    actorType,
    note: 'Başvuru onaylandı — geliştirme aşamasına geçildi.',
  });
}

export interface AdvanceResult {
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
}

/**
 * Projeyi bir sonraki yaşam döngüsü aşamasına ilerletir.
 * Geçiş kapısı sağlanmazsa HttpError fırlatır.
 */
export async function advanceLifecycle(
  requestId: string,
  actorId: string,
  note?: string | null
): Promise<AdvanceResult> {
  const row = await loadLifecycleRow(requestId);
  const current = row.lifecycle_stage;

  if (current === 'application') {
    throw new HttpError(
      400,
      'Başvuru henüz onaylanmadı — önce değerlendirme tamamlanmalı.',
      'STAGE_NOT_ADVANCEABLE'
    );
  }
  if (current === 'live') {
    throw new HttpError(400, 'Proje zaten canlıda.', 'STAGE_NOT_ADVANCEABLE');
  }

  const idx = STAGE_ORDER.indexOf(current);
  const next = STAGE_ORDER[idx + 1]!;

  // Geçiş kapısı kontrolü
  if (current === 'development') {
    if (!await allGatesPassed(requestId, row.governance_level)) {
      throw new HttpError(
        400,
        'Tüm kalite kapıları yeşil olmadan Stage aşamasına geçilemez.',
        'GATES_NOT_PASSED'
      );
    }
  } else if (current === 'stage') {
    const stageApproval = await dbOne(`SELECT decision FROM human_approvals
         WHERE request_id = ? AND approval_type = 'stage'
         ORDER BY created_at DESC LIMIT 1`, [requestId]) as { decision: string } | undefined;
    if (stageApproval?.decision !== 'approved') {
      throw new HttpError(
        400,
        'Stage insan onayı alınmadan Production aşamasına geçilemez.',
        'STAGE_APPROVAL_REQUIRED'
      );
    }
  } else if (current === 'production') {
    const prodApproval = await dbOne(`SELECT decision FROM human_approvals
         WHERE request_id = ? AND approval_type = 'production'
         ORDER BY created_at DESC LIMIT 1`, [requestId]) as { decision: string } | undefined;
    if (prodApproval?.decision !== 'approved') {
      throw new HttpError(
        400,
        'Production insan onayı alınmadan canlıya geçilemez.',
        'PRODUCTION_APPROVAL_REQUIRED'
      );
    }
  }
  await dbTx(async () => {
    await dbRun(`UPDATE license_requests
       SET lifecycle_stage = ?, stage_entered_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [next, requestId]);

    // Yeni aşama insan onayı gerektiriyorsa bekleyen onayı aç.
    if (next === 'stage') await createPendingApproval(requestId, 'stage');
    if (next === 'production') await createPendingApproval(requestId, 'production');

    await recordStageEvent({
      requestId,
      fromStage: current,
      toStage: next,
      actorId,
      actorType: 'admin',
      note: note?.trim() || null,
    });
  });

  return { fromStage: current, toStage: next };
}

/**
 * Lab Mühendisi atar (kılavuz: ortam ataması).
 */
export async function assignEngineer(requestId: string, engineerId: string): Promise<void> {
  await loadLifecycleRow(requestId); // varlık kontrolü
  await dbRun(`UPDATE license_requests
     SET assigned_engineer_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [engineerId, requestId]);
}

/**
 * Proje türünü PoC → Kuruma Entegre yükseltir (kılavuz §3 "Tür yükseltme").
 * Yönetişim seviyesi 'full' olur; geliştirme aşamasındaysa eksik kapılar eklenir.
 */
export async function upgradeProjectType(requestId: string, actorId: string): Promise<void> {
  const row = await loadLifecycleRow(requestId);
  if (row.project_type === 'integration') {
    throw new HttpError(
      400,
      'Proje zaten Kuruma Entegre türünde.',
      'ALREADY_INTEGRATION'
    );
  }

  await dbRun(`UPDATE license_requests
     SET project_type = 'integration', governance_level = 'full',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`, [requestId]);

  // Geliştirme aşamasında ise yeni (mimari/framework) kapıları ekle.
  if (row.lifecycle_stage !== 'application') {
    await initGatesForRequest(requestId, 'full');
  }

  await recordStageEvent({
    requestId,
    fromStage: row.lifecycle_stage,
    toStage: row.lifecycle_stage,
    actorId,
    actorType: 'admin',
    note: 'Proje türü "Kuruma Entegre" olarak yükseltildi — tam yönetişim uygulanır.',
  });
}

/* ============================================================
 * YÖNETİŞİM DASHBOARD — toplu metrikler
 * ============================================================ */

export interface GovernanceDashboard {
  generatedAt: string;
  /** Yaşam döngüsü aşamalarına göre proje dağılımı. */
  stageDistribution: Array<{ stage: LifecycleStage; count: number }>;
  /** Geliştirme/Stage/Production'daki aktif proje sayısı. */
  activeProjects: number;
  /** Canlıdaki proje sayısı. */
  liveProjects: number;
  /** SWAT incelemesinde bekleyen başvuru sayısı. */
  swatQueueCount: number;
  /** Bekleyen insan onayı (Stage + Production) sayısı. */
  pendingApprovals: number;
  /** SLA süresi aşılmış başvuru/proje sayısı. */
  slaBreaches: number;
  /** Kalite kapısı durum dağılımı. */
  gateStats: { passed: number; failed: number; pending: number };
}

export async function getGovernanceDashboard(): Promise<GovernanceDashboard> {

  const stageRows = await dbAll(`SELECT lifecycle_stage AS stage, COUNT(*) AS count
       FROM license_requests GROUP BY lifecycle_stage`, []) as Array<{ stage: LifecycleStage; count: number }>;
  const stageMap = new Map(stageRows.map((r) => [r.stage, r.count]));
  const stageDistribution = STAGE_ORDER.map((stage) => ({
    stage,
    count: stageMap.get(stage) ?? 0,
  }));

  const activeProjects =
    (stageMap.get('development') ?? 0) +
    (stageMap.get('stage') ?? 0) +
    (stageMap.get('production') ?? 0);
  const liveProjects = stageMap.get('live') ?? 0;

  const swatQueueCount = (
    await dbOne(`SELECT COUNT(*) AS c FROM license_requests
         WHERE review_track = 'swat' AND status = 'pending'`, []) as { c: number }
  ).c;

  const pendingApprovals = (
    await dbOne(`SELECT COUNT(*) AS c FROM human_approvals WHERE decision = 'pending'`, []) as { c: number }
  ).c;

  const gateRows = await dbAll(`SELECT status, COUNT(*) AS c FROM quality_gates GROUP BY status`, []) as Array<{ status: 'pending' | 'passed' | 'failed'; c: number }>;
  const gateStats = { passed: 0, failed: 0, pending: 0 };
  for (const g of gateRows) gateStats[g.status] = g.c;

  // SLA ihlalleri — her başvuru için aktif SLA hesaplanır.
  const slaSubjects = await dbAll(`SELECT id, lifecycle_stage, status, review_track, created_at
       FROM license_requests`, []) as Array<{
    id: string;
    lifecycle_stage: LifecycleStage;
    status: string;
    review_track: 'standard' | 'swat';
    created_at: string;
  }>;
  let slaBreaches = 0;
  for (const s of slaSubjects) {
    const sla = await computeSla({
      id: s.id,
      lifecycleStage: s.lifecycle_stage,
      status: s.status,
      reviewTrack: s.review_track,
      createdAt: s.created_at,
    });
    if (sla?.overdue) slaBreaches += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    stageDistribution,
    activeProjects,
    liveProjects,
    swatQueueCount,
    pendingApprovals,
    slaBreaches,
    gateStats,
  };
}

/** Proje türünden yönetişim seviyesi (createLicenseRequest için). */
export { governanceLevelForProjectType };
