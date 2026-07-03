/**
 * İnsan onay servisi — Stage ve Production onay noktaları (kılavuz §7).
 *
 * Proje 'stage' aşamasına girince bir 'stage' onayı, 'production' aşamasına
 * girince bir 'production' onayı bekleyen (pending) olarak oluşturulur.
 * YZ/Ar-Ge Mühendisi kararı verir; karar olmadan bir sonraki aşamaya geçilemez.
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';

export type ApprovalType = 'stage' | 'production';
export type ApprovalDecision = 'pending' | 'approved' | 'rejected';

export interface HumanApproval {
  id: string;
  requestId: string;
  approvalType: ApprovalType;
  decision: ApprovalDecision;
  approverId: string | null;
  approverName: string | null;
  releaseNote: string | null;
  riskAssessment: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface ApprovalRow {
  id: string;
  request_id: string;
  approval_type: ApprovalType;
  decision: ApprovalDecision;
  approver_id: string | null;
  approver_name: string | null;
  release_note: string | null;
  risk_assessment: string | null;
  decided_at: string | null;
  created_at: string;
}

function rowToApproval(row: ApprovalRow): HumanApproval {
  return {
    id: row.id,
    requestId: row.request_id,
    approvalType: row.approval_type,
    decision: row.decision,
    approverId: row.approver_id,
    approverName: row.approver_name,
    releaseNote: row.release_note,
    riskAssessment: row.risk_assessment,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

const SELECT_WITH_APPROVER = `
  SELECT ha.*, a.full_name AS approver_name
  FROM human_approvals ha
  LEFT JOIN admins a ON a.id = ha.approver_id
`;

/**
 * Bekleyen bir onay oluşturur. Aynı tip için zaten bekleyen onay varsa
 * yenisini açmaz (idempotent).
 */
export async function createPendingApproval(requestId: string, type: ApprovalType): Promise<void> {
  const existing = await dbOne(`SELECT id FROM human_approvals
       WHERE request_id = ? AND approval_type = ? AND decision = 'pending'`, [requestId, type]);
  if (existing) return;
  // ON CONFLICT DO NOTHING: kısmi unique index (uq_human_approvals_pending)
  // eşzamanlı çağrıların ikinci INSERT'ini sessizce yutar (yarış DB'de kapanır).
  await dbRun(`INSERT INTO human_approvals (id, request_id, approval_type, decision)
     VALUES (?, ?, ?, 'pending')
     ON CONFLICT DO NOTHING`, [nanoid(), requestId, type]);
}

export async function listApprovalsForRequest(requestId: string): Promise<HumanApproval[]> {
  const rows = await dbAll(`${SELECT_WITH_APPROVER} WHERE ha.request_id = ? ORDER BY ha.created_at ASC`, [requestId]) as ApprovalRow[];
  return rows.map(rowToApproval);
}

/** Birden çok talep için onayları tek sorguda yükler. */
export async function listApprovalsForRequests(
  requestIds: string[]
): Promise<Map<string, HumanApproval[]>> {
  const map = new Map<string, HumanApproval[]>();
  if (requestIds.length === 0) return map;
  const placeholders = requestIds.map(() => '?').join(',');
  const rows = await dbAll(`${SELECT_WITH_APPROVER} WHERE ha.request_id IN (${placeholders})
       ORDER BY ha.created_at ASC`, [...requestIds]) as ApprovalRow[];
  for (const r of rows) {
    const list = map.get(r.request_id) ?? [];
    list.push(rowToApproval(r));
    map.set(r.request_id, list);
  }
  return map;
}

/** Belirli tipteki bekleyen onayı döner (yoksa undefined). */
export async function getPendingApproval(
  requestId: string,
  type: ApprovalType
): Promise<HumanApproval | undefined> {
  const row = await dbOne(`${SELECT_WITH_APPROVER}
       WHERE ha.request_id = ? AND ha.approval_type = ? AND ha.decision = 'pending'`, [requestId, type]) as ApprovalRow | undefined;
  return row ? rowToApproval(row) : undefined;
}

export interface DecideApprovalInput {
  decision: 'approved' | 'rejected';
  releaseNote?: string | null;
  riskAssessment?: string | null;
}

/**
 * Bekleyen onaya karar verir. Bekleyen onay yoksa veya zaten karara
 * bağlanmışsa hata fırlatır.
 */
export async function decideApproval(
  requestId: string,
  type: ApprovalType,
  approverId: string,
  input: DecideApprovalInput
): Promise<HumanApproval> {
  const pending = await dbOne(`SELECT id FROM human_approvals
       WHERE request_id = ? AND approval_type = ? AND decision = 'pending'`, [requestId, type]) as { id: string } | undefined;

  if (!pending) {
    throw new HttpError(
      400,
      'Bu aşama için bekleyen bir onay yok.',
      'NO_PENDING_APPROVAL'
    );
  }

  // Guard: yalnız hâlâ 'pending' olan satır karara bağlanır — iki onaylayıcı
  // yarışırsa ikincisi ilkinin kararını sessizce EZMESİN (audit bütünlüğü).
  const res = await dbRun(`UPDATE human_approvals SET
       decision = ?, approver_id = ?,
       release_note = ?, risk_assessment = ?,
       decided_at = CURRENT_TIMESTAMP
     WHERE id = ? AND decision = 'pending'`, [input.decision,
    approverId,
    input.releaseNote?.trim() || null,
    input.riskAssessment?.trim() || null,
    pending.id]);
  if (res.changes === 0) {
    throw new HttpError(409, 'Bu onay az önce başka bir yetkili tarafından karara bağlandı.', 'APPROVAL_ALREADY_DECIDED');
  }

  // RED kararı durum makinesini kilitlemesin: proje bir önceki aşamaya
  // döndürülür; ekip düzeltir, advanceLifecycle yeniden pending onay açar.
  // (Önceden: reject sonrası yeni onay açacak hiçbir yol yoktu — talep
  // sonsuza dek o aşamada kilitleniyordu.)
  if (input.decision === 'rejected') {
    const fallbackStage = type === 'stage' ? 'development' : 'stage';
    await dbRun(`UPDATE license_requests
       SET lifecycle_stage = ?, stage_entered_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [fallbackStage, requestId]);
    await dbRun(`INSERT INTO project_stage_events
         (id, request_id, from_stage, to_stage, actor_id, actor_type, note)
       VALUES (?, ?, ?, ?, ?, 'admin', ?)`, [nanoid(),
      requestId,
      type === 'stage' ? 'stage' : 'production',
      fallbackStage,
      approverId,
      `${type === 'stage' ? 'Stage' : 'Production'} onayı reddedildi — önceki aşamaya döndürüldü.`]);
  }

  const row = await dbOne(`${SELECT_WITH_APPROVER} WHERE ha.id = ?`, [pending.id]) as ApprovalRow;
  return rowToApproval(row);
}
