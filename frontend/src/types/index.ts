// ============================================================
// PAYLAŞILAN DTO TİPLERİ (#6) — backend ile TEK kaynak (@klab/shared).
// Buradan re-export edilir ki mevcut `from '../types'` importları değişmesin.
// ============================================================
import type {
  SubjectKind,
  UserGovernanceRole,
  BookingStatus,
  LifecycleStage,
  Booking,
  WaitlistStatus,
  WaitlistEntry,
  AppointmentStatus,
  Appointment,
  Room,
  VisualStatus,
  VisualVariant,
  ShowcaseItem,
  ShowcaseTechnology,
  SimilarBooking,
  DuplicateMatch,
  Leaderboard,
  LeaderboardUser,
  LeaderboardProject,
  KioskRoom,
  KioskData,
  Book,
  BookLoan,
  BookLoanStatus,
} from '@klab/shared';

export type {
  SubjectKind,
  UserGovernanceRole,
  BookingStatus,
  LifecycleStage,
  Booking,
  WaitlistStatus,
  WaitlistEntry,
  AppointmentStatus,
  Appointment,
  Room,
  VisualStatus,
  VisualVariant,
  ShowcaseItem,
  ShowcaseTechnology,
  SimilarBooking,
  DuplicateMatch,
  Leaderboard,
  LeaderboardUser,
  LeaderboardProject,
  KioskRoom,
  KioskData,
  Book,
  BookLoan,
  BookLoanStatus,
};

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  /** Sadece user'lar için anlamlı; admin'ler için undefined. */
  governanceRole?: UserGovernanceRole | null;
  /**
   * EK-1 "Okudum, Kabul Ettim" beyanı onay zamanı. User-tabanlı hesaplarda
   * null ise login/register akışında bir kereye mahsus onay kartı gösterilir;
   * admin'ler için undefined (beyan kapsamı dışı).
   */
  consentAcceptedAt?: string | null;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: 'user';
  governanceRole?: UserGovernanceRole | null;
  department: string | null;
  title: string | null;
  manager: string | null;
  phone: string | null;
  bio: string | null;
  projectIdea: string | null;
  profilePhoto: string | null;
  /** Kullanıcının seçtiği profil arka plan görseli (leaderboard kartı + public profil). */
  profileBackgroundUrl: string | null;
  /** Sohbet ekranı arka plan teması (kullanıcının seçtiği görsel). */
  chatBackgroundUrl: string | null;
  status: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserListItem extends UserProfile {
  bookingCount: number;
  approvedBookingCount: number;
  pendingBookingCount: number;
  lastBookingAt: string | null;
}

export interface ProfileUpdatePayload {
  fullName?: string;
  department?: string;
  title?: string;
  manager?: string;
  phone?: string;
  bio?: string;
  projectIdea?: string;
}

export interface AdminUserUpdatePayload extends ProfileUpdatePayload {
  status?: 1 | 3;
  governanceRole?: UserGovernanceRole | null;
}

export interface AuthTokens {
  accessToken: string;
  /** Cookie-only moda geçişte kaldırılıyor — refresh artık HttpOnly cookie'de yaşar. */
  refreshToken?: string;
  expiresIn: number;
}

/** Bilinen oda tema anahtarları (Room.theme değerleri — API'de serbest string). */
export type RoomTheme = 'robot' | 'pc' | 'neural' | 'chatbot' | 'data' | 'brain' | 'code' | 'cloud' | 'vector' | 'agent';

// Room → @klab/shared (üstte re-export edildi).

/** Oda müsaitlik detayı — kart açılınca "müsait vakitler" göstergesi için. */
export interface RoomBusyRange {
  startDate: string;
  endDate: string;
  weekdays: number[];
}

export interface RoomAvailabilityDay {
  date: string;
  slots: Array<{ start: string; end: string }>;
}

export interface RoomAvailability {
  roomId: string;
  isAvailable: boolean;
  nextAvailableDate: string | null;
  availableWeekdays: number[];
  busyRanges: RoomBusyRange[];
  /** Bugünden itibaren rezerve edilebilir boş tarih aralıkları (dolu pencerelerden önce/arasında). */
  freeGaps: Array<{ startDate: string; endDate: string }>;
  /** Oda bugün müsaitse, gelecekteki en yakın dolu pencere (bilgi notu için). */
  nextOccupiedWindow: { startDate: string; endDate: string } | null;
  /** Oda bugün doluysa, doluluk bittikten sonraki en erken müsait tarih. */
  earliestAvailableAfter: string | null;
  appointments: RoomAvailabilityDay[];
  from: string;
  to: string;
}

/** Admin "Odalar" görünümü — bir odadaki aktif booking. */
export interface RoomOccupant {
  bookingId: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  projectName: string;
  period: '1w' | '2w' | '1m' | null;
  periodMonths: number | null;
  startDate: string;
  endDate: string;
  status: 'approved' | 'pending' | 'feedback_requested';
  showcaseImageUrl: string | null;
}

export interface RoomWithOccupancy extends Room {
  bookings: RoomOccupant[];
  approvedCount: number;
  pendingCount: number;
}



export interface AdminStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  feedback_requested: number;
}

export interface CreateBookingPayload {
  roomId: string;
  /** Süre seçeneği: 1 hafta / 2 hafta / 1 ay. */
  period: '1w' | '2w' | '1m';
  /** Haftanın seçili günleri (1=Pzt..7=Paz). Verilmezse tüm hafta (ara gün seçimi flag'i kapalı). */
  weekdays?: number[];
  startDate: string;
  /** Manuel (esnek/kısa) bitiş tarihi. Verilmezse start + periyot türetilir. */
  endDate?: string;
  projectName: string;
  projectDescription: string;
  helpNeeded: string;
  technologies: string[];
}

export interface ReviewBookingPayload {
  action: 'approve' | 'reject' | 'request_feedback';
  feedback?: string;
}

export interface ApiError {
  error: string;
  code?: string;
  issues?: Array<{ path: string; message: string }>;
}

/* ============================================================
 * WAITLIST
 * ============================================================ */


export interface JoinWaitlistPayload {
  roomId: string;
  /** Süre seçeneği: 1 hafta / 2 hafta / 1 ay. */
  period: '1w' | '2w' | '1m';
  desiredStartDate: string;
  /** Manuel (periyottan kısa) bitiş tarihi. Verilmezse start + periyot türetilir. */
  desiredEndDate?: string;
  projectName: string;
  projectDescription: string;
  helpNeeded: string;
  technologies: string[];
  /** Haftanın seçili günleri (1=Pzt..7=Paz). Verilmezse tüm hafta. */
  weekdays?: number[];
}

/* ============================================================
 * ANALYTICS
 * ============================================================ */

export interface DailyBookingPoint {
  date: string;
  created: number;
  approved: number;
  rejected: number;
}

export interface RoomUsage {
  roomId: string;
  roomCode: string;
  roomName: string;
  totalBookings: number;
  approvedBookings: number;
  utilizationDays: number;
}

export interface TechnologyCount {
  technology: string;
  count: number;
}

export interface StatusBreakdown {
  status: string;
  count: number;
}

export interface PeriodDistribution {
  periodMonths: number;
  count: number;
}

export interface TopUser {
  userId: string;
  fullName: string;
  email: string;
  bookingCount: number;
  approvedCount: number;
}

export interface AnalyticsResponse {
  generatedAt: string;
  dailyBookings: DailyBookingPoint[];
  roomUsage: RoomUsage[];
  topTechnologies: TechnologyCount[];
  statusBreakdown: StatusBreakdown[];
  periodDistribution: PeriodDistribution[];
  topUsers: TopUser[];
  totals: {
    bookings: number;
    users: number;
    approved: number;
    pending: number;
    rejected: number;
    feedbackRequested: number;
    activeWaitlist: number;
  };
}

/* ============================================================
 * ADMIN USER SEARCH
 * ============================================================ */

export interface AdminUserSearchFilters {
  q?: string;
  status?: 'all' | 'active' | 'disabled';
  department?: string;
  hasBookings?: 'any' | 'yes' | 'no';
}

/* ============================================================
 * MFA
 * ============================================================ */

export interface MfaStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

export interface MfaEnrollResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}

/* ============================================================
 * SHOWCASE
 * ============================================================ */

// ShowcaseItem → @klab/shared (üstte re-export edildi).

/* ============================================================
 * SEMANTIC SEARCH
 * ============================================================ */

/* ============================================================
 * LİSANSLAR
 * ============================================================ */

export type LicenseTier = 'paid' | 'free' | 'enterprise';
export type LicenseCategory =
  | 'AI Assistant'
  | 'IDE'
  | 'Cloud'
  | 'API'
  | 'Framework'
  | 'Database';

export interface UserLicenseEntry {
  technology: string;
  name: string;
  category: LicenseCategory;
  monthlyUsd: number;
  tier: LicenseTier;
  vendor: string;
  bookingCount: number;
}

export interface UserLicenseUsage {
  userId: string;
  userFullName: string;
  userEmail: string;
  department: string | null;
  licenses: UserLicenseEntry[];
  totalMonthlyUsd: number;
  activeBookingCount: number;
}

export interface LicenseSummary {
  technology: string;
  name: string;
  category: LicenseCategory;
  tier: LicenseTier;
  monthlyUsd: number;
  vendor: string;
  userCount: number;
  bookingCount: number;
  totalMonthlyUsd: number;
  users: Array<{ id: string; fullName: string; email: string }>;
}

export interface LicenseReport {
  generatedAt: string;
  byUser: UserLicenseUsage[];
  bySoftware: LicenseSummary[];
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

// SimilarBooking + DuplicateMatch → @klab/shared (üstte re-export edildi).

/* ============================================================
 * GENEL SOHBET (rol-bağımsız chat)
 * ============================================================ */

/** Chat aktör tipi — danışman/arge users tablosunda yaşar → 'user'. */
export type ChatKind = 'user' | 'admin';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderKind: ChatKind;
  recipientId: string;
  recipientKind: ChatKind;
  body: string;
  read: boolean;
  createdAt: string;
  /** Görüntüleyene göre — mesajı ben mi attım? */
  mine: boolean;
}

export interface ChatContact {
  id: string;
  kind: ChatKind;
  fullName: string;
  /** "Yönetici" | "Analitik Danışman" | "YZ / Ar-Ge" | "Kullanıcı" */
  roleLabel: string;
  /** Kullanıcı profil fotoğrafı (base64 data URL). admin'lerde null. */
  profilePhoto: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
}

/* ============================================================
 * SHOWCASE ETKİLEŞİM
 * ============================================================ */

export interface LikeStatus {
  liked: boolean;
  count: number;
}

export interface ShowcaseComment {
  id: string;
  bookingId: string;
  userId: string;
  userFullName: string;
  userProfilePhoto: string | null;
  body: string;
  createdAt: string;
}

export type ShowcaseEngagement = Record<string, { likes: number; comments: number }>;

/* ============================================================
 * PUBLIC PROFİL
 * ============================================================ */

export interface PublicProfile {
  id: string;
  fullName: string;
  department: string | null;
  title: string | null;
  bio: string | null;
  projectIdea: string | null;
  profilePhoto: string | null;
  profileBackgroundUrl: string | null;
  joinedAt: string;
  projects: Array<{
    id: string;
    projectName: string;
    projectDescription: string;
    technologies: string[];
    roomCode: string;
    roomName: string;
    startDate: string;
    endDate: string;
    isHighlight: boolean;
    likeCount: number;
    commentCount: number;
    approvedAt: string | null;
    showcaseImageUrl: string | null;
  }>;
  stats: {
    projectCount: number;
    totalLikes: number;
    totalComments: number;
  };
}


/* ============================================================
 * LİSANS TALEPLERİ — request/approval iş akışı
 * (license analytics LicenseReport'tan AYRI — bu user'ın admin'den
 *  istediği lisans için)
 * ============================================================ */

export type LicenseRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'feedback_requested';

export type ProjectType = 'poc' | 'integration';
export type ReviewTrack = 'standard' | 'swat';

/* ============================================================
 * YÖNETİŞİM — yaşam döngüsü (AI Lab Vibe Coding Kılavuzu v2.1)
 * ============================================================ */



export type GovernanceLevel = 'basic' | 'full';
export type GovernanceRole = 'analitik_danisman' | 'lab_muhendisi' | 'yz_arge';
export type GateKey =
  | 'build'
  | 'code_review'
  | 'architecture'
  | 'framework'
  | 'security';
export type GateStatus = 'pending' | 'passed' | 'failed';
export type ApprovalType = 'stage' | 'production';
export type ApprovalDecision = 'pending' | 'approved' | 'rejected';

export interface SlaInfo {
  checkpoint: string;
  deadline: string;
  slaHours: number;
  remainingHours: number;
  overdue: boolean;
}

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

export interface GovernanceBundle {
  request: LicenseRequest | LicenseRequestWithUser;
  gates: QualityGate[];
  approvals: HumanApproval[];
  stageEvents: StageEvent[];
}

export interface GovernanceDashboard {
  generatedAt: string;
  stageDistribution: Array<{ stage: LifecycleStage; count: number }>;
  activeProjects: number;
  liveProjects: number;
  swatQueueCount: number;
  pendingApprovals: number;
  slaBreaches: number;
  gateStats: { passed: number; failed: number; pending: number };
}

export interface GovernanceAdmin {
  id: string;
  fullName: string;
  role: string;
  governanceRole: GovernanceRole | null;
}

export interface LicenseRequestItem {
  licenseKey: string;
  licenseName: string;
  vendor: string | null;
  category: string | null;
}

export interface LicenseRequest {
  id: string;
  userId: string;
  // PNG "Başvuru Formu" alanları (eski kayıtlarda nullable)
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
  // Geriye dönük: tek-lisans alanları (ilk item ile aynı değer)
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

/* ============================================================
 * BİLDİRİM MERKEZİ — kalıcı in-app bildirimler
 * ============================================================ */

export type NotificationCategory =
  | 'booking'
  | 'license'
  | 'waitlist'
  | 'message'
  | 'system';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/* ============================================================
 * LİSANS BÜTÇE ANALİZİ
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

/* ============================================================
 * DONANIM TALEPLERİ
 * ============================================================ */

export type HardwareRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'feedback_requested';

export type EquipmentType =
  | 'mouse'
  | 'keyboard'
  | 'camera'
  | 'monitor'
  | 'headset'
  | 'other';

export type HardwareUrgency = 'low' | 'normal' | 'high';

export interface HardwareRequest {
  id: string;
  userId: string;
  equipmentType: EquipmentType;
  equipmentDetail: string | null;
  quantity: number;
  reason: string;
  urgency: HardwareUrgency;
  status: HardwareRequestStatus;
  adminFeedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareRequestWithUser extends HardwareRequest {
  userFullName: string;
  userEmail: string;
  userDepartment: string | null;
  reviewerName: string | null;
}

export interface CreateHardwareRequestPayload {
  equipmentType: EquipmentType;
  equipmentDetail?: string | null;
  quantity: number;
  reason: string;
  urgency: HardwareUrgency;
}

/* ============================================================
 * DESTEK TALEPLERİ
 * ============================================================ */

export type SupportRequestStatus = 'open' | 'resolved';

export interface SupportRequest {
  id: string;
  userId: string;
  description: string;
  status: SupportRequestStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportRequestWithUser extends SupportRequest {
  userFullName: string;
  userEmail: string;
  userDepartment: string | null;
}

// Leaderboard / Heatmap / Kiosk / VisualStatus / VisualVariant
// → @klab/shared (üstte re-export edildi).

/* ---- Görsel üretimi (gorsel_uretim entegrasyonu) ---- */

export interface Visual {
  id: string;
  userId: string;
  roomId: string | null;
  fikir: string;
  tema: string | null;
  promptEn: string | null;
  imageUrl: string | null;
  seed: number | null;
  status: VisualStatus;
  errorMessage: string | null;
  variantIndex: number;
  variants: VisualVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateVisualPayload {
  fikir: string;
  tema?: string;
  roomId?: string;
}

/* ===== Appointment (saatli) ısı-haritası (#5) ===== */
export interface ApptHeatmapSlot {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  title: string;
  user: string;
}
export interface ApptHeatmapDay {
  date: string;    // YYYY-MM-DD
  weekday: number; // 1=Pzt .. 7=Paz
  count: number;
  slots: ApptHeatmapSlot[];
}
export interface ApptHeatmapRoom {
  roomId: string;
  code: string;
  name: string;
  days: ApptHeatmapDay[];
  total: number;
}
export interface RoomApptHeatmap {
  from: string;
  to: string;
  maxCount: number;
  rooms: ApptHeatmapRoom[];
}
