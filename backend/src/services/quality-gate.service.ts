/**
 * Kalite kapısı servisi — 6 yönetişim ajanının kapı sonuçları.
 *
 * Her proje 'development' aşamasına girdiğinde, yönetişim seviyesine
 * uygun kapı satırları 'pending' olarak oluşturulur. Sonuçlar admin
 * veya CI pipeline tarafından güncellenir. Tüm uygulanabilir kapılar
 * 'passed' olmadan proje 'stage' aşamasına geçemez.
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun, dbTx } from '../db/schema';
import {
  GATE_DEFINITIONS,
  applicableGates,
  type GateKey,
  type GovernanceLevel,
} from './governance-data';

export type GateStatus = 'pending' | 'passed' | 'failed';

export interface QualityGate {
  id: string;
  requestId: string;
  gateKey: GateKey;
  label: string;
  agent: string;
  threshold: number | null;
  thresholdUnit: string | null;
  referenceMd: string;
  status: GateStatus;
  score: number | null;
  detail: string | null;
  evaluatedAt: string | null;
}

interface GateRow {
  id: string;
  request_id: string;
  gate_key: GateKey;
  status: GateStatus;
  score: number | null;
  threshold: number | null;
  detail: string | null;
  evaluated_at: string | null;
}

function rowToGate(row: GateRow): QualityGate {
  const def = GATE_DEFINITIONS[row.gate_key];
  return {
    id: row.id,
    requestId: row.request_id,
    gateKey: row.gate_key,
    label: def?.label ?? row.gate_key,
    agent: def?.agent ?? '',
    threshold: row.threshold,
    thresholdUnit: def?.thresholdUnit ?? null,
    referenceMd: def?.referenceMd ?? '',
    status: row.status,
    score: row.score,
    detail: row.detail,
    evaluatedAt: row.evaluated_at,
  };
}

/**
 * Proje 'development' aşamasına girince uygulanabilir kapıları
 * 'pending' olarak oluşturur. Idempotent — var olan kapıya dokunmaz.
 */
export async function initGatesForRequest(requestId: string, level: GovernanceLevel): Promise<void> {
  await dbTx(async () => {
    for (const key of applicableGates(level)) {
      await dbRun(
        `INSERT OR IGNORE INTO quality_gates
           (id, request_id, gate_key, status, threshold)
         VALUES (?, ?, ?, 'pending', ?)`,
        [nanoid(), requestId, key, GATE_DEFINITIONS[key].threshold]
      );
    }
  });
}

export async function listGatesForRequest(requestId: string): Promise<QualityGate[]> {
  const rows = await dbAll('SELECT * FROM quality_gates WHERE request_id = ?', [requestId]) as GateRow[];
  return sortGates(rows.map(rowToGate));
}

/** Birden çok talep için kapıları tek sorguda yükler. */
export async function listGatesForRequests(requestIds: string[]): Promise<Map<string, QualityGate[]>> {
  const map = new Map<string, QualityGate[]>();
  if (requestIds.length === 0) return map;
  const placeholders = requestIds.map(() => '?').join(',');
  const rows = await dbAll(`SELECT * FROM quality_gates WHERE request_id IN (${placeholders})`, [...requestIds]) as GateRow[];
  for (const r of rows) {
    const list = map.get(r.request_id) ?? [];
    list.push(rowToGate(r));
    map.set(r.request_id, list);
  }
  for (const [k, v] of map) map.set(k, sortGates(v));
  return map;
}

/** Kapıları tanım sırasına göre sıralar (build → security). */
function sortGates(gates: QualityGate[]): QualityGate[] {
  const order = Object.keys(GATE_DEFINITIONS) as GateKey[];
  return [...gates].sort((a, b) => order.indexOf(a.gateKey) - order.indexOf(b.gateKey));
}

export interface GateResultInput {
  status: GateStatus;
  score?: number | null;
  detail?: string | null;
}

/**
 * Bir kapının sonucunu günceller (admin / CI pipeline).
 * Kapı satırı yoksa oluşturur.
 */
export async function setGateResult(
  requestId: string,
  gateKey: GateKey,
  input: GateResultInput
): Promise<QualityGate> {
  const def = GATE_DEFINITIONS[gateKey];
  // Tek upsert: check-then-insert yarışında (CI + admin eşzamanlı) ikinci
  // INSERT UNIQUE(request_id, gate_key) ihlaliyle 500 veriyordu.
  await dbRun(`INSERT INTO quality_gates
       (id, request_id, gate_key, status, score, threshold, detail, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (request_id, gate_key) DO UPDATE SET
       status = EXCLUDED.status,
       score = EXCLUDED.score,
       detail = EXCLUDED.detail,
       evaluated_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`, [nanoid(),
    requestId,
    gateKey,
    input.status,
    input.score ?? null,
    def?.threshold ?? null,
    input.detail?.trim() || null]);

  const row = await dbOne('SELECT * FROM quality_gates WHERE request_id = ? AND gate_key = ?', [requestId, gateKey]) as GateRow;
  return rowToGate(row);
}

/**
 * Verilen yönetişim seviyesindeki TÜM uygulanabilir kapılar 'passed' mı?
 * (development → stage geçiş koşulu.)
 */
export async function allGatesPassed(requestId: string, level: GovernanceLevel): Promise<boolean> {
  const required = applicableGates(level);
  const gates = await listGatesForRequest(requestId);
  return required.every(
    (key) => gates.find((g) => g.gateKey === key)?.status === 'passed'
  );
}
