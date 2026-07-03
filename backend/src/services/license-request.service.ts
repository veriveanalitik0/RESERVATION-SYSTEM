/**
 * Lisans / proje BAŞVURU iş akışı.
 *
 * Başvuru onaylandığında bir "proje"ye dönüşür ve 4 aşamalı yönetişim
 * yaşam döngüsüne girer (governance.service):
 *   application → development → stage → production → live
 *
 * Başvuru değerlendirme sonuçları (kılavuz §2.1):
 *   approve | reject | request_feedback | swat
 *
 * Form modeli (PNG "Başvuru Formu" + kılavuz alanları):
 *   - request_title / reason / expected_benefit / success_criteria
 *   - items (junction)   : talep edilen AI araç/lisans listesi (1+)
 *   - project_type       : 'poc' | 'integration' → governance_level
 *   - estimated_duration_days / data_to_use / technical_stack
 *   - duration_months    : lisans kullanım süresi
 *   - uses_external_api  : dış servis/API erişimi var mı
 *   - involves_real_data : gerçek banka verisi/üretim/AD-LDAP beyanı
 *                          (true ise OTOMATİK RED — kılavuz §5)
 *
 * Güvenlik (app_security.md):
 * - SQL parameterized (§3)
 * - IDOR: user sadece kendi taleplerini görür (§5)
 * - Admin review reviewed_by + reviewed_at ile audit-able (§8)
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun, dbTx } from '../db/schema';
import { HttpError } from '../middleware/error.middleware';
import { LICENSE_CATALOG, type LicenseInfo } from './license.service';
import {
  pushNotification,
  pushNotificationBulk,
} from './notification-center.service';
import {
  computeSla,
  governanceLevelForProjectType,
  onApplicationApproved,
  recordStageEvent,
  type SlaInfo,
} from './governance.service';
import type { GovernanceLevel, LifecycleStage } from './governance-data';

export type LicenseRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'feedback_requested';

export type ProjectType = 'poc' | 'integration';
export type ReviewTrack = 'standard' | 'swat';

/** involves_real_data=true → bu mesajla otomatik reddedilir (kılavuz §5). */
const AUTO_REJECT_FEEDBACK =
  'Otomatik red: Gerçek banka verisi, üretim sistemi veya AD/LDAP erişimi ' +
  'içeren başvurular AI Lab\'da yürütülemez (Vibe Coding Yönetişim Kılavuzu §5). ' +
  'Yalnızca sentetik veya kamuya açık veri ile yeniden başvurabilirsin.';

export interface LicenseRequestItem {
  licenseKey: string;
  licenseName: string;
  vendor: string | null;
  category: string | null;
}

export interface LicenseRequest {
  id: string;
  userId: string;
  // PNG "Başvuru Formu" alanları
  requestTitle: string | null;
  reason: string; // Kullanım amacı
  expectedBenefit: string | null;
  successCriteria: string | null;
  projectType: ProjectType | null;
  estimatedDurationDays: number | null;
  dataToUse: string | null;
  technicalStack: string | null;
  items: LicenseRequestItem[];
  durationMonths: 1 | 3 | 6 | 12;
  // Geriye dönük: tek-lisans alanları (eski kayıtlar + ilk item ile sync)
  licenseKey: string;
  licenseName: string;
  vendor: string | null;
  category: string | null;
  // Review akışı
  status: LicenseRequestStatus;
  reviewTrack: ReviewTrack;
  adminFeedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  // Yönetişim yaşam döngüsü
  lifecycleStage: LifecycleStage;
  governanceLevel: GovernanceLevel;
  usesExternalApi: boolean | null;
  involvesRealData: boolean | null;
  stageEnteredAt: string | null;
  assignedEngineerId: string | null;
  /** O an beklenen SLA kontrol noktası (yoksa null). */
  sla: SlaInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseRequestWithUser extends LicenseRequest {
  userFullName: string;
  userEmail: string;
  userDepartment: string | null;
  reviewerName: string | null;
  assignedEngineerName: string | null;
}

interface DbRow {
  id: string;
  user_id: string;
  license_key: string;
  license_name: string;
  vendor: string | null;
  category: string | null;
  reason: string;
  duration_months: 1 | 3 | 6 | 12;
  request_title: string | null;
  expected_benefit: string | null;
  success_criteria: string | null;
  project_type: ProjectType | null;
  estimated_duration_days: number | null;
  data_to_use: string | null;
  technical_stack: string | null;
  status: LicenseRequestStatus;
  review_track: ReviewTrack;
  admin_feedback: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  lifecycle_stage: LifecycleStage;
  governance_level: GovernanceLevel;
  uses_external_api: number | null;
  involves_real_data: number | null;
  stage_entered_at: string | null;
  assigned_engineer_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DbRowWithUser extends DbRow {
  user_full_name: string;
  user_email: string;
  user_department: string | null;
  reviewer_name: string | null;
  assigned_engineer_name: string | null;
}

interface ItemRow {
  request_id: string;
  license_key: string;
  license_name: string;
  vendor: string | null;
  category: string | null;
  item_order: number;
}

async function loadItemsForRequests(requestIds: string[]): Promise<Map<string, LicenseRequestItem[]>> {
  const map = new Map<string, LicenseRequestItem[]>();
  if (requestIds.length === 0) return map;
  const placeholders = requestIds.map(() => '?').join(',');
  const rows = await dbAll(`SELECT request_id, license_key, license_name, vendor, category, item_order
       FROM license_request_items
       WHERE request_id IN (${placeholders})
       ORDER BY request_id, item_order ASC`, [...requestIds]) as ItemRow[];
  for (const r of rows) {
    const list = map.get(r.request_id) ?? [];
    list.push({
      licenseKey: r.license_key,
      licenseName: r.license_name,
      vendor: r.vendor,
      category: r.category,
    });
    map.set(r.request_id, list);
  }
  return map;
}

function intToBool(v: number | null): boolean | null {
  return v == null ? null : v === 1;
}

async function rowToLicenseRequest(row: DbRow, items: LicenseRequestItem[]): Promise<LicenseRequest> {
  return {
    id: row.id,
    userId: row.user_id,
    requestTitle: row.request_title,
    reason: row.reason,
    expectedBenefit: row.expected_benefit,
    successCriteria: row.success_criteria,
    projectType: row.project_type,
    estimatedDurationDays: row.estimated_duration_days,
    dataToUse: row.data_to_use,
    technicalStack: row.technical_stack,
    items,
    durationMonths: row.duration_months,
    licenseKey: row.license_key,
    licenseName: row.license_name,
    vendor: row.vendor,
    category: row.category,
    status: row.status,
    reviewTrack: row.review_track,
    adminFeedback: row.admin_feedback,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    lifecycleStage: row.lifecycle_stage,
    governanceLevel: row.governance_level,
    usesExternalApi: intToBool(row.uses_external_api),
    involvesRealData: intToBool(row.involves_real_data),
    stageEnteredAt: row.stage_entered_at,
    assignedEngineerId: row.assigned_engineer_id,
    sla: await computeSla({
      id: row.id,
      lifecycleStage: row.lifecycle_stage,
      status: row.status,
      reviewTrack: row.review_track,
      createdAt: row.created_at,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function rowToLicenseRequestWithUser(
  row: DbRowWithUser,
  items: LicenseRequestItem[]
): Promise<LicenseRequestWithUser> {
  return {
    ...await rowToLicenseRequest(row, items),
    userFullName: row.user_full_name,
    userEmail: row.user_email,
    userDepartment: row.user_department,
    reviewerName: row.reviewer_name,
    assignedEngineerName: row.assigned_engineer_name,
  };
}

/** Admin tarafı zenginleştirilmiş SELECT (user + reviewer + engineer join). */
const SELECT_ADMIN_REQUEST = `
  SELECT lr.*,
         u.full_name AS user_full_name,
         u.email AS user_email,
         u.department AS user_department,
         a.full_name AS reviewer_name,
         eng.full_name AS assigned_engineer_name
  FROM license_requests lr
  INNER JOIN users u ON u.id = lr.user_id
  LEFT JOIN admins a ON a.id = lr.reviewed_by
  LEFT JOIN admins eng ON eng.id = lr.assigned_engineer_id
`;

/* ============================================================
 * KATALOG ENDPOINT — popüler araçlar listesi (frontend dropdown)
 * ============================================================ */

export interface CatalogEntry {
  key: string;
  name: string;
  vendor: string;
  category: string;
  tier: 'paid' | 'free' | 'enterprise';
  monthlyUsd: number;
}

/**
 * UI'da gösterilecek katalog — sadece paid/enterprise + sık talep edilenler.
 * Bilinmeyen / custom için "Diğer" girdisini frontend ekler.
 */
export function getLicenseCatalog(): CatalogEntry[] {
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];

  // Önce paid + AI Assistant + IDE'leri öne çıkar (sık talep edilenler)
  const priority = ['claude', 'claude code', 'cursor', 'github copilot', 'gpt', 'openai', 'gemini'];
  for (const key of priority) {
    const info = LICENSE_CATALOG[key];
    if (info && !seen.has(info.name)) {
      seen.add(info.name);
      entries.push({
        key,
        name: info.name,
        vendor: info.vendor,
        category: info.category,
        tier: info.tier,
        monthlyUsd: info.monthlyUsd,
      });
    }
  }

  // Sonra geri kalan paid'ler
  for (const [key, info] of Object.entries(LICENSE_CATALOG) as Array<[string, LicenseInfo]>) {
    if (info.tier !== 'paid') continue;
    if (seen.has(info.name)) continue;
    seen.add(info.name);
    entries.push({
      key,
      name: info.name,
      vendor: info.vendor,
      category: info.category,
      tier: info.tier,
      monthlyUsd: info.monthlyUsd,
    });
  }

  return entries;
}

/* ============================================================
 * BÜTÇE ANALİZİ — onaylı/bekleyen lisans taleplerinin maliyeti
 * ============================================================ */

export interface LicenseBudgetReport {
  generatedAt: string;
  approvedMonthlyUsd: number;
  approvedAnnualUsd: number;
  approvedCommitmentUsd: number;
  approvedRequestCount: number;
  pendingMonthlyUsd: number;
  pendingRequestCount: number;
  byProjectType: Array<{
    projectType: 'poc' | 'integration' | 'unspecified';
    requestCount: number;
    monthlyUsd: number;
  }>;
  byTool: Array<{
    name: string;
    tier: string;
    unitMonthlyUsd: number;
    approvedCount: number;
    monthlyUsd: number;
  }>;
  unpricedItemCount: number;
}

/**
 * Lisans taleplerinden bütçe raporu üretir.
 * Maliyet katalog (LICENSE_CATALOG) aylık fiyatlarından hesaplanır;
 * custom / katalogda olmayan araçlar fiyatsız sayılır (unpricedItemCount).
 */
export async function getLicenseBudgetReport(): Promise<LicenseBudgetReport> {
  // Bütçe TÜM talepleri kapsamalı — sayfalama loop'u. (Önceki bug: argümansız
  // listAdminLicenseRequests default LIMIT 200 + approved'ları sona iten sıralama
  // → talep 200'ü geçince approvedMonthlyUsd olduğundan az/sıfır raporlanıyordu.)
  const all: LicenseRequestWithUser[] = [];
  const PAGE = 500;
  for (let offset = 0; ; offset += PAGE) {
    const batch = await listAdminLicenseRequests(undefined, { limit: PAGE, offset });
    all.push(...batch);
    if (batch.length < PAGE) break;
  }

  let approvedMonthlyUsd = 0;
  let approvedCommitmentUsd = 0;
  let approvedRequestCount = 0;
  let pendingMonthlyUsd = 0;
  let pendingRequestCount = 0;
  let unpricedItemCount = 0;

  const projectTypeAgg = new Map<
    'poc' | 'integration' | 'unspecified',
    { requestCount: number; monthlyUsd: number }
  >();
  const toolAgg = new Map<
    string,
    { name: string; tier: string; unitMonthlyUsd: number; approvedCount: number; monthlyUsd: number }
  >();

  for (const r of all) {
    let requestMonthly = 0;
    for (const it of r.items) {
      const info = LICENSE_CATALOG[it.licenseKey];
      if (info && info.monthlyUsd > 0) {
        requestMonthly += info.monthlyUsd;
        if (r.status === 'approved') {
          const existing = toolAgg.get(info.name) ?? {
            name: info.name,
            tier: info.tier,
            unitMonthlyUsd: info.monthlyUsd,
            approvedCount: 0,
            monthlyUsd: 0,
          };
          existing.approvedCount += 1;
          existing.monthlyUsd += info.monthlyUsd;
          toolAgg.set(info.name, existing);
        }
      } else {
        unpricedItemCount += 1;
      }
    }

    if (r.status === 'approved') {
      approvedMonthlyUsd += requestMonthly;
      approvedCommitmentUsd += requestMonthly * r.durationMonths;
      approvedRequestCount += 1;

      const pt = r.projectType ?? 'unspecified';
      const agg = projectTypeAgg.get(pt) ?? { requestCount: 0, monthlyUsd: 0 };
      agg.requestCount += 1;
      agg.monthlyUsd += requestMonthly;
      projectTypeAgg.set(pt, agg);
    } else if (r.status === 'pending' || r.status === 'feedback_requested') {
      pendingMonthlyUsd += requestMonthly;
      pendingRequestCount += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    approvedMonthlyUsd,
    approvedAnnualUsd: approvedMonthlyUsd * 12,
    approvedCommitmentUsd,
    approvedRequestCount,
    pendingMonthlyUsd,
    pendingRequestCount,
    byProjectType: (['poc', 'integration', 'unspecified'] as const)
      .map((pt) => ({
        projectType: pt,
        requestCount: projectTypeAgg.get(pt)?.requestCount ?? 0,
        monthlyUsd: projectTypeAgg.get(pt)?.monthlyUsd ?? 0,
      }))
      .filter((b) => b.requestCount > 0),
    byTool: [...toolAgg.values()].sort((a, b) => b.monthlyUsd - a.monthlyUsd),
    unpricedItemCount,
  };
}

/* ============================================================
 * USER — talep oluştur + kendi taleplerini listele
 * ============================================================ */

export interface CreateLicenseRequestInput {
  // Çekirdek (zorunlu) alanlar
  requestTitle: string;
  reason: string;
  items: Array<{
    licenseKey: string;
    licenseName: string;
    vendor?: string | null;
    category?: string | null;
  }>;
  durationMonths: 1 | 3 | 6 | 12;
  // Opsiyonel alanlar (sadeleştirilmiş form göndermeyebilir)
  expectedBenefit?: string | null;
  successCriteria?: string | null;
  projectType?: ProjectType | null;
  estimatedDurationDays?: number | null;
  dataToUse?: string | null;
  technicalStack?: string | null;
  /** Dış servis / API erişimi var mı (yönetişim kapsamı). */
  usesExternalApi?: boolean;
  /** Gerçek banka verisi / üretim / AD-LDAP beyanı — true ise otomatik red. */
  involvesRealData?: boolean;
}

/**
 * Item için defense-in-depth: katalogdan vendor/category fill et.
 */
function normalizeItem(
  raw: CreateLicenseRequestInput['items'][number]
): LicenseRequestItem {
  const key = raw.licenseKey.trim().toLowerCase();
  const fromCatalog = LICENSE_CATALOG[key];
  return {
    licenseKey: key,
    licenseName: fromCatalog?.name ?? raw.licenseName.trim(),
    vendor: fromCatalog?.vendor ?? raw.vendor?.trim() ?? null,
    category: fromCatalog?.category ?? raw.category?.trim() ?? null,
  };
}

export async function createLicenseRequest(
  userId: string,
  input: CreateLicenseRequestInput
): Promise<LicenseRequest> {
  const id = nanoid();

  const items = input.items.map(normalizeItem);
  const primary = items[0]!; // schema min(1) garantili

  // Proje türü opsiyonel — verilmezse 'poc' (basic governance).
  const governanceLevel = governanceLevelForProjectType(input.projectType ?? 'poc');
  // Kılavuz §5: gerçek veri beyanı → otomatik red (verilmezse false).
  const autoRejected = input.involvesRealData === true;
  const status: LicenseRequestStatus = autoRejected ? 'rejected' : 'pending';
  const adminFeedback = autoRejected ? AUTO_REJECT_FEEDBACK : null;
  const reviewedAt = autoRejected ? new Date().toISOString() : null;

  await dbTx(async () => {
    await dbRun(`INSERT INTO license_requests
         (id, user_id, license_key, license_name, vendor, category,
          reason, duration_months,
          request_title, expected_benefit, success_criteria,
          project_type, estimated_duration_days, data_to_use, technical_stack,
          uses_external_api, involves_real_data, governance_level,
          status, admin_feedback, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id,
      userId,
      primary.licenseKey,
      primary.licenseName,
      primary.vendor,
      primary.category,
      input.reason.trim(),
      input.durationMonths,
      input.requestTitle.trim(),
      input.expectedBenefit?.trim() || null,
      input.successCriteria?.trim() || null,
      input.projectType ?? null,
      input.estimatedDurationDays ?? null,
      input.dataToUse?.trim() || null,
      input.technicalStack?.trim() || null,
      input.usesExternalApi == null ? null : input.usesExternalApi ? 1 : 0,
      input.involvesRealData ? 1 : 0,
      governanceLevel,
      status,
      adminFeedback,
      reviewedAt]);

    for (const [idx, it] of items.entries()) {
      await dbRun(
        `INSERT INTO license_request_items
           (id, request_id, license_key, license_name, vendor, category, item_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), id, it.licenseKey, it.licenseName, it.vendor, it.category, idx]
      );
    }
  });

  if (autoRejected) {
    await recordStageEvent({
      requestId: id,
      fromStage: 'application',
      toStage: 'application',
      actorType: 'system',
      note: 'Otomatik red — gerçek veri / üretim erişimi beyanı (Kılavuz §5).',
    });
  }

  const row = await dbOne('SELECT * FROM license_requests WHERE id = ?', [id]) as DbRow;
  const itemMap = await loadItemsForRequests([id]);
  return await rowToLicenseRequest(row, itemMap.get(id) ?? []);
}

/**
 * Kullanıcı kendi başvurusunu günceller (IDOR korumalı).
 *
 * Sadece 'pending' veya 'feedback_requested' durumdaki başvurular düzenlenebilir.
 * 'feedback_requested' güncellenince statü 'pending'e döner.
 * Gerçek veri beyanı işaretlenirse güncelleme de otomatik reddedilir.
 */
export async function updateLicenseRequest(
  userId: string,
  requestId: string,
  input: CreateLicenseRequestInput
): Promise<LicenseRequest> {

  const existing = await dbOne('SELECT * FROM license_requests WHERE id = ?', [requestId]) as DbRow | undefined;

  if (!existing || existing.user_id !== userId) {
    throw new HttpError(404, 'Talep bulunamadı.', 'LICENSE_REQUEST_NOT_FOUND');
  }
  if (existing.status === 'approved' || existing.status === 'rejected') {
    throw new HttpError(
      400,
      'Sonuçlanmış bir başvuru düzenlenemez.',
      'LICENSE_REQUEST_FINALIZED'
    );
  }

  const items = input.items.map(normalizeItem);
  const primary = items[0]!;

  // Opsiyonel alanlar GÖNDERİLMEDİYSE (undefined) eski kaydın değerini KORU.
  // Sadeleştirilmiş form bu alanları artık göndermiyor; düz overwrite, eski
  // (sadeleştirme öncesi) başvuru düzenlenince geçmiş yönetişim verisini sessizce
  // silerdi. Açıkça gönderilen değer (boş '' dahil → optionalShortText undefined'a
  // map'ler) korunur; yalnız gerçekten verilen alan güncellenir.
  const expectedBenefit =
    input.expectedBenefit !== undefined ? input.expectedBenefit?.trim() || null : existing.expected_benefit;
  const successCriteria =
    input.successCriteria !== undefined ? input.successCriteria?.trim() || null : existing.success_criteria;
  const projectType = input.projectType !== undefined ? input.projectType : existing.project_type;
  const estimatedDurationDays =
    input.estimatedDurationDays !== undefined ? input.estimatedDurationDays ?? null : existing.estimated_duration_days;
  const dataToUse = input.dataToUse !== undefined ? input.dataToUse?.trim() || null : existing.data_to_use;
  const technicalStack =
    input.technicalStack !== undefined ? input.technicalStack?.trim() || null : existing.technical_stack;
  const usesExternalApi =
    input.usesExternalApi !== undefined ? (input.usesExternalApi ? 1 : 0) : existing.uses_external_api;
  const involvesRealDataVal =
    input.involvesRealData !== undefined ? (input.involvesRealData ? 1 : 0) : existing.involves_real_data;

  // Yönetişim seviyesi korunan/güncellenen proje türünden türetilir.
  const governanceLevel = governanceLevelForProjectType((projectType as ProjectType | null) ?? 'poc');
  // Yalnızca bu güncellemede AÇIKÇA gerçek-veri beyanı yapıldıysa otomatik red.
  const autoRejected = input.involvesRealData === true;
  const status: LicenseRequestStatus = autoRejected ? 'rejected' : 'pending';
  const adminFeedback = autoRejected ? AUTO_REJECT_FEEDBACK : existing.admin_feedback;
  const reviewedAt = autoRejected ? new Date().toISOString() : existing.reviewed_at;

  await dbTx(async () => {
    // TOCTOU guard: yukarıdaki SELECT ile bu UPDATE arasında statü değişmiş olabilir
    // (örn. admin paralel onayladı) → yalnız hâlâ düzenlenebilir statüde güncelle.
    const upd = await dbRun(`UPDATE license_requests SET
         license_key = ?, license_name = ?, vendor = ?, category = ?,
         reason = ?, duration_months = ?,
         request_title = ?, expected_benefit = ?, success_criteria = ?,
         project_type = ?, estimated_duration_days = ?, data_to_use = ?,
         technical_stack = ?,
         uses_external_api = ?, involves_real_data = ?, governance_level = ?,
         status = ?, admin_feedback = ?, reviewed_at = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('pending', 'feedback_requested')`, [primary.licenseKey,
      primary.licenseName,
      primary.vendor,
      primary.category,
      input.reason.trim(),
      input.durationMonths,
      input.requestTitle.trim(),
      expectedBenefit,
      successCriteria,
      projectType,
      estimatedDurationDays,
      dataToUse,
      technicalStack,
      usesExternalApi,
      involvesRealDataVal,
      governanceLevel,
      status,
      adminFeedback,
      reviewedAt,
      requestId]);
    if (upd.changes === 0) {
      throw new HttpError(409, 'Başvuru bu sırada sonuçlandı; düzenlenemedi.', 'LICENSE_REQUEST_CONFLICT');
    }

    await dbRun('DELETE FROM license_request_items WHERE request_id = ?', [requestId]);
    for (const [idx, it] of items.entries()) {
      await dbRun(
        `INSERT INTO license_request_items
           (id, request_id, license_key, license_name, vendor, category, item_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), requestId, it.licenseKey, it.licenseName, it.vendor, it.category, idx]
      );
    }
  });

  if (autoRejected) {
    await recordStageEvent({
      requestId,
      fromStage: 'application',
      toStage: 'application',
      actorType: 'system',
      note: 'Otomatik red — gerçek veri / üretim erişimi beyanı (Kılavuz §5).',
    });
  }

  const row = await dbOne('SELECT * FROM license_requests WHERE id = ?', [requestId]) as DbRow;
  const itemMap = await loadItemsForRequests([requestId]);
  return await rowToLicenseRequest(row, itemMap.get(requestId) ?? []);
}

/**
 * Yeni başvuruda aktif admin'lere in-app bildirim.
 */
export async function notifyAdminsLicenseRequested(
  request: LicenseRequest
): Promise<void> {
  const admins = await dbAll("SELECT id FROM admins WHERE status = 1", []) as Array<{ id: string }>;
  if (admins.length === 0) return;

  const submitter = await dbOne('SELECT full_name FROM users WHERE id = ?', [request.userId]) as { full_name: string } | undefined;
  const submitterName = submitter?.full_name ?? 'Bir kullanıcı';

  const tools = request.items.map((i) => i.licenseName).join(', ') || request.licenseName;
  const title = request.requestTitle ?? request.licenseName;

  pushNotificationBulk(admins.map((a) => a.id), 'admin', {
    category: 'license',
    title: 'Yeni başvuru',
    body: `${submitterName} — "${title}" (${tools})`,
    link: '/admin/licenses',
  });
}

export async function listUserLicenseRequests(userId: string): Promise<LicenseRequest[]> {
  const rows = await dbAll(`SELECT * FROM license_requests WHERE user_id = ? ORDER BY created_at DESC`, [userId]) as DbRow[];
  const itemMap = await loadItemsForRequests(rows.map((r) => r.id));
  return Promise.all(rows.map((r) => rowToLicenseRequest(r, itemMap.get(r.id) ?? [])));
}

/* ============================================================
 * ADMIN — tüm başvurular + review
 * ============================================================ */

export async function listAdminLicenseRequests(
  statusFilter?: LicenseRequestStatus,
  page?: { limit?: number; offset?: number }
): Promise<LicenseRequestWithUser[]> {
  const params: unknown[] = [];
  let where = '';
  if (statusFilter) {
    where = 'WHERE lr.status = ?';
    params.push(statusFilter);
  }
  params.push(Math.min(Math.max(page?.limit ?? 200, 1), 500));
  params.push(Math.max(page?.offset ?? 0, 0));

  const rows = await dbAll(`${SELECT_ADMIN_REQUEST}
       ${where}
       ORDER BY
         CASE lr.status
           WHEN 'pending' THEN 0
           WHEN 'feedback_requested' THEN 1
           ELSE 2
         END,
         lr.created_at DESC,
         lr.id DESC
       LIMIT ? OFFSET ?`, [...params]) as DbRowWithUser[];
  const itemMap = await loadItemsForRequests(rows.map((r) => r.id));
  return Promise.all(rows.map((r) => rowToLicenseRequestWithUser(r, itemMap.get(r.id) ?? [])));
}

/** Tek bir başvuruyu (admin görünümü) getirir. */
export async function getAdminLicenseRequestById(
  requestId: string
): Promise<LicenseRequestWithUser | undefined> {
  const row = await dbOne(`${SELECT_ADMIN_REQUEST} WHERE lr.id = ?`, [requestId]) as DbRowWithUser | undefined;
  if (!row) return undefined;
  const itemMap = await loadItemsForRequests([requestId]);
  return await rowToLicenseRequestWithUser(row, itemMap.get(requestId) ?? []);
}

/** Kullanıcının tek başvurusu (IDOR: sahibi olmalı). */
export async function getUserLicenseRequestById(
  userId: string,
  requestId: string
): Promise<LicenseRequest | undefined> {
  const row = await dbOne('SELECT * FROM license_requests WHERE id = ? AND user_id = ?', [requestId, userId]) as DbRow | undefined;
  if (!row) return undefined;
  const itemMap = await loadItemsForRequests([requestId]);
  return await rowToLicenseRequest(row, itemMap.get(requestId) ?? []);
}

export type ReviewAction = 'approve' | 'reject' | 'request_feedback' | 'swat';

export interface ReviewLicenseRequestInput {
  action: ReviewAction;
  adminFeedback?: string | null;
}

export async function reviewLicenseRequest(
  reviewerId: string,
  requestId: string,
  input: ReviewLicenseRequestInput,
  /** Review eden rol — admin ya da Analitik Danışman. Audit/timeline doğruluğu için. */
  actorType: 'admin' | 'danisman' = 'admin'
): Promise<LicenseRequestWithUser> {

  const existing = await dbOne('SELECT * FROM license_requests WHERE id = ?', [requestId]) as DbRow | undefined;

  if (!existing) {
    throw new HttpError(404, 'Talep bulunamadı.', 'LICENSE_REQUEST_NOT_FOUND');
  }
  if (existing.status === 'approved' || existing.status === 'rejected') {
    throw new HttpError(
      400,
      'Bu başvuru zaten sonuçlandırılmış.',
      'LICENSE_REQUEST_FINALIZED'
    );
  }

  /* --- SWAT: multidisipliner inceleme kuyruğuna yönlendir --- */
  if (input.action === 'swat') {
    await dbRun(`UPDATE license_requests SET
         review_track = 'swat',
         admin_feedback = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [input.adminFeedback?.trim() || existing.admin_feedback, requestId]);

    await recordStageEvent({
      requestId,
      fromStage: 'application',
      toStage: 'application',
      actorId: reviewerId,
      actorType,
      note: 'SWAT multidisipliner incelemeye yönlendirildi (SLA ≤ 5 iş günü).',
    });

    const swatResult = (await getAdminLicenseRequestById(requestId))!;
    pushNotification({
      recipientId: swatResult.userId,
      recipientType: 'user',
      category: 'license',
      title: 'Başvurun SWAT incelemesine alındı',
      body: `"${swatResult.requestTitle ?? swatResult.licenseName}" — multidisipliner uzman ekip değerlendirecek.`,
      link: '/licenses',
    });
    return swatResult;
  }

  /* --- approve / reject / request_feedback --- */
  const nextStatus: LicenseRequestStatus =
    input.action === 'approve'
      ? 'approved'
      : input.action === 'reject'
        ? 'rejected'
        : 'feedback_requested';

  // TOCTOU/eşzamanlı-inceleme guard: yalnız hâlâ pending/feedback statüsündeyse
  // sonuçlandır → paralel approve/reject "son-yazan-kazanır" desenkronizasyonunu önle
  // (status=rejected iken lifecycle=development gibi tutarsızlık oluşamaz).
  const reviewUpd = await dbRun(`UPDATE license_requests SET
       status = ?,
       admin_feedback = ?,
       reviewed_by = ?,
       reviewed_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('pending', 'feedback_requested')`, [nextStatus, input.adminFeedback?.trim() || null, reviewerId, requestId]);
  if (reviewUpd.changes === 0) {
    throw new HttpError(409, 'Bu başvuru bu sırada başka bir incelemeci tarafından sonuçlandırıldı.', 'LICENSE_REQUEST_CONFLICT');
  }

  // Onaylandıysa projeyi geliştirme aşamasına taşı (kalite kapıları oluşur).
  if (nextStatus === 'approved') {
    await onApplicationApproved(requestId, reviewerId, actorType);
  }

  const result = (await getAdminLicenseRequestById(requestId))!;
  const reqTitle = result.requestTitle ?? result.licenseName;

  // In-app bildirim — talep sahibine.
  const notifTitle =
    nextStatus === 'approved'
      ? 'Başvurun onaylandı'
      : nextStatus === 'rejected'
        ? 'Başvurun reddedildi'
        : 'Başvurun için düzeltme istendi';
  pushNotification({
    recipientId: result.userId,
    recipientType: 'user',
    category: 'license',
    title: notifTitle,
    body: `"${reqTitle}" — ${
      nextStatus === 'feedback_requested'
        ? 'panelinden düzenleyip yeniden gönderebilirsin.'
        : nextStatus === 'approved'
          ? 'proje geliştirme aşamasına geçti.'
          : 'detaylar için Lisanslarım sayfasına git.'
    }`,
    link: '/licenses',
  });

  return result;
}
