/**
 * Paylaşılan DTO tipleri (#6) — backend ile frontend ARASINDA tek kaynak.
 *
 * Buradaki tipler API sözleşmesini temsil eder; hem backend (servis/route dönüş
 * tipi) hem frontend (api.ts/bileşen prop) AYNI tanımı import eder → tekrar yok,
 * drift yok. Yalnız TİP (interface/type) içerir, runtime kod YOK → `import type`
 * ile erime; tsx/Vite runtime'ında tamamen silinir.
 *
 * Tüketim:
 *  - backend: `import type { ... } from '@klab/shared'` (tsconfig paths)
 *  - frontend: `import type { ... } from '@klab/shared'` (vite alias + tsconfig paths)
 */

/* ============ Görsel üretimi ============ */

export type VisualStatus = 'pending' | 'enhancing' | 'generating' | 'ready' | 'error';

export interface VisualVariant {
  seed: number;
  /** Saklandıysa iç (prompt'suz) URL, değilse dış sağlayıcı URL'i (fallback). */
  url: string;
  /** Baytlar sunucuda saklandı mı. */
  stored?: boolean;
  /** Saklanan dosya uzantısı (jpg/png/webp…). */
  ext?: string;
  created_at: number;
}

/* ============ Showcase / Envanter ============ */

export interface ShowcaseItem {
  id: string;
  projectName: string;
  projectDescription: string;
  technologies: string[];
  roomCode: string;
  roomName: string;
  district: string;
  neighborhood: string;
  theme: string;
  authorId: string;
  authorFullName: string;
  /** Yazarın profil fotoğrafı (base64 data URL) — yoksa null (baş harf gösterilir). */
  authorPhoto: string | null;
  /** Süre seçeneği (1w/2w/1m); miras kayıtlarda NULL (bkz. periodMonths). */
  period: BookingPeriod | null;
  periodMonths: number | null;
  startDate: string;
  endDate: string;
  isHighlight: boolean;
  approvedAt: string | null;
  /** Sahibinin atadığı arkaplan görseli (kendi ürettiği visual'den) — null olabilir. */
  showcaseImageUrl: string | null;
}

export interface ShowcaseTechnology {
  technology: string;
  count: number;
}

/* ============ Semantic search / eşleştirme (#4) ============ */

export interface SimilarBooking {
  bookingId: string;
  similarity: number;
  projectName: string;
  projectDescription: string;
  technologies: string[];
  status: string;
  roomCode: string;
  roomName: string;
  userFullName: string;
  /** İfşa edilen sonuçlarda sahip user id'si — "Bağlan" (/u/:id) için. Anonimde yok. */
  authorId?: string;
  isOwn?: boolean;
  anonymized?: boolean;
  createdAt: string;
}

/** Yeni booking'de otomatik duplicate-tespiti sonucu. */
export interface DuplicateMatch {
  bookingId: string;
  projectName: string;
  similarity: number;
  isOwn: boolean;
  authorFullName: string;
  roomCode: string;
}

/* ============ Leaderboard / Sıralama (#5a) ============ */

export interface LeaderboardUser {
  userId: string;
  fullName: string;
  department: string | null;
  /** Kullanıcının seçtiği profil arka plan görseli (kart arka planı). */
  profileBackgroundUrl: string | null;
  approvedBookings: number;
  utilizationDays: number;
  likes: number;
  comments: number;
  score: number;
}

export interface LeaderboardProject {
  bookingId: string;
  projectName: string;
  authorId: string;
  authorFullName: string;
  roomCode: string;
  roomName: string;
  isHighlight: boolean;
  likes: number;
  comments: number;
  score: number;
}

export interface Leaderboard {
  users: LeaderboardUser[];
  projects: LeaderboardProject[];
  generatedAt: string;
  scoring: { bookings: number; utilizationDay: number; like: number; comment: number };
}

/* ============ Kiosk — oda ekranı (#5b) ============ */

export interface KioskRoom {
  id: string;
  code: string;
  name: string;
  theme: string;
  equipment: string;
  roomType: 'pod' | 'experience' | 'tribune';
}

export interface KioskData {
  room: KioskRoom;
  latestVisual: { imageUrl: string; createdAt: string } | null;
}

/* ============================================================
 * ÇEKİRDEK DOMAIN TİPLERİ — backend DTO'ları ile frontend tipleri
 * arasındaki kopyala-yapıştır drift'ini kapatmak için TEK kaynak.
 * Backend: BookingDto/WaitlistEntryDto/AppointmentDto bu tiplere alias'tır.
 * Frontend: types/index.ts buradan re-export eder.
 * ============================================================ */

export type SubjectKind = 'user' | 'admin' | 'danisman' | 'arge' | 'izleyici';

/** Kullanıcı yönetişim rolü. NULL = sıradan kullanıcı. */
export type UserGovernanceRole = 'analitik_danisman' | 'yz_arge' | 'izleyici';

export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'feedback_requested' | 'cancelled';

/**
 * Rezervasyon süresi seçeneği: 1 hafta / 2 hafta / 1 ay.
 * (Eski kayıtlar periodMonths ile ay bazlıdır — period NULL olabilir.)
 */
export type BookingPeriod = '1w' | '2w' | '1m';

export type LifecycleStage = 'application' | 'development' | 'stage' | 'production' | 'live';

export interface Booking {
  id: string;
  userId: string;
  userEmail?: string;
  userFullName?: string;
  /** Talep sahibinin profil fotoğrafı (cache'lenebilir URL) — listelerde avatar. */
  userPhoto?: string | null;
  roomId: string;
  roomName: string;
  roomCode: string;
  /** Süre seçeneği (1w/2w/1m). Eski kayıtlarda NULL olabilir (bkz. periodMonths). */
  period: BookingPeriod | null;
  /** MİRAS: eski ay-bazlı süre. Yeni kayıtlarda NULL. */
  periodMonths: number | null;
  /** Periyodik randevu — haftanın seçili günleri (1=Pzt..7=Paz). Tüm hafta = [1..7]. */
  weekdays: number[];
  startDate: string;
  endDate: string;
  projectName: string;
  projectDescription: string;
  helpNeeded: string;
  technologies: string[];
  status: BookingStatus;
  adminFeedback: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Admin kararı (null=bekliyor, 'approved'/'rejected'). Tek onay merci admin'dir. */
  adminDecision: 'approved' | 'rejected' | null;
  /** MİRAS (çift onay dönemi): analitik kararı. Yeni akışta kullanılmaz, NULL kalır. */
  analystDecision: 'approved' | 'rejected' | null;
  lifecycleStage: LifecycleStage;
  stageEnteredAt: string;
  reviewTrack: 'standard' | 'swat';
  stageAdvanceRequestedAt: string | null;
  stageAdvanceNote: string | null;
  showcaseImageUrl: string | null;
  /** Kullanıcının kendi yazdığı ilerleme/çalışma notu (dashboard'da düzenlenir). */
  progressNote: string | null;
  progressUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WaitlistStatus = 'waiting' | 'promoted' | 'expired' | 'cancelled';

export interface WaitlistEntry {
  id: string;
  userId: string;
  userFullName?: string;
  userEmail?: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  /** Süre seçeneği (1w/2w/1m). Eski kayıtlarda NULL olabilir. */
  period: BookingPeriod | null;
  /** MİRAS: eski ay-bazlı süre. Yeni kayıtlarda NULL. */
  periodMonths: number | null;
  desiredStartDate: string;
  /**
   * İstenen bitiş tarihi. Kullanıcı manuel (periyottan kısa) seçtiyse o; aksi halde
   * desiredStartDate + period ile server'da türetilir.
   */
  desiredEndDate: string;
  projectName: string;
  projectDescription: string;
  helpNeeded: string;
  technologies: string[];
  /** Haftanın seçili günleri (1=Pzt..7=Paz) — promote edilen booking'e taşınır. */
  weekdays: number[];
  position: number;
  status: WaitlistStatus;
  promotedBookingId: string | null;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentStatus = 'scheduled' | 'cancelled' | 'completed';

export interface Appointment {
  id: string;
  bookingId: string;
  userId: string;
  userFullName?: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  roomEquipment: string;
  /** ISO 8601 datetime. */
  startAt: string;
  endAt: string;
  title: string;
  notes: string;
  status: AppointmentStatus;
  createdAt: string;
  updatedAt: string;
}

/* ============ Kütüphane (#kütüphane) — kitap envanteri + ödünç ============ */

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string | null;
  description: string | null;
  coverImageUrl: string | null;
  totalCopies: number;
  availableCopies: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Admin görünümünde: bu kitabın şu an ödünçte (active) kopya sayısı. */
  activeLoanCount?: number;
  /** Kullanıcı görünümünde: bu kullanıcının bu kitap için aktif ödüncü var mı. */
  borrowedByMe?: boolean;
}

export type BookLoanStatus = 'pending' | 'active' | 'returned' | 'overdue' | 'rejected';

export interface BookLoan {
  id: string;
  bookId: string;
  userId: string;
  /** Admin görünümünde doldurulur. */
  userFullName?: string;
  userEmail?: string;
  bookTitle: string;
  bookAuthor: string;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  status: BookLoanStatus;
  /** Talep edilen ödünç süresi (gün). */
  periodDays: number;
  /** Bekleyen süre-uzatma talebi (gün) — null = talep yok. */
  extensionRequestedDays: number | null;
  extensionRequestedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
