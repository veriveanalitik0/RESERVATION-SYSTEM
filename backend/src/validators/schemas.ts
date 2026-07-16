/**
 * Zod doğrulama şemaları.
 *
 * Güvenlik:
 * - app_security.md §3: Whitelist tabanlı server-side doğrulama (tip + uzunluk + format).
 * - app_security.md §4: Parola politikası: min 12 karakter, karmaşıklık zorunlu.
 */
import { z } from 'zod';
import { periodEndDate } from '../utils/dates';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(254)
  .email('Geçersiz e-posta adresi.');

export const passwordSchema = z
  .string()
  .min(12, 'Parola en az 12 karakter olmalı.')
  .max(128, 'Parola en fazla 128 karakter olabilir.')
  .refine((p) => /[A-Z]/.test(p), 'Parolada en az bir büyük harf olmalı.')
  .refine((p) => /[a-z]/.test(p), 'Parolada en az bir küçük harf olmalı.')
  .refine((p) => /[0-9]/.test(p), 'Parolada en az bir rakam olmalı.')
  .refine(
    (p) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p),
    'Parolada en az bir özel karakter olmalı.'
  );

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

/** Parola sıfırlama talebi — sadece e-posta. */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/** Parola sıfırlama — token + yeni parola (politika uygulanır). */
export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(16).max(128),
    password: passwordSchema,
    passwordConfirm: z.string().min(1).max(128),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Parolalar eşleşmiyor.',
    path: ['passwordConfirm'],
  });

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Admin: bir kullanıcının parolasını sıfırlar (parola politikası uygulanır). */
export const adminResetUserPasswordSchema = z.object({
  password: passwordSchema,
});

/** Admin kendi parolasını değiştirir. */
export const changeAdminPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

/** Admin: bir booking'i başka odaya taşır. */
export const reassignRoomSchema = z.object({
  roomId: z.string().trim().min(8).max(40),
});

/** Admin: bir booking'in user'ını değiştirir. */
export const reassignUserSchema = z.object({
  userId: z.string().trim().min(8).max(40),
});

/** Kullanıcı: yeni randevu (appointment) oluşturma. */
export const createAppointmentSchema = z.object({
  bookingId: z.string().trim().min(8).max(40),
  startAt: z.string().trim().min(10).max(40), // ISO datetime
  endAt: z.string().trim().min(10).max(40),
  title: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

/** Admin: booking review-track (SWAT/standard) ayarı. */
export const setReviewTrackSchema = z.object({
  track: z.union([z.literal('standard'), z.literal('swat')]),
});

/** Kullanıcı: aşama ilerletme talebi (opsiyonel gerekçe). */
export const stageAdvanceRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/** Admin: stage advance talebini reddetme (opsiyonel admin notu). */
export const rejectStageAdvanceSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/** Admin: waitlist sırası değiştirme. */
export const waitlistMoveSchema = z.object({
  move: z.union([z.literal('up'), z.literal('down'), z.literal('top')]),
});

/**
 * Kullanıcı kayıt şeması.
 * - Parola politikası uygulanır (min 12 + karmaşıklık)
 * - Ad-soyad whitelist tabanlı (sadece harfler, boşluk, kısa çizgi)
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  passwordConfirm: z.string().min(1).max(128),
  fullName: z
    .string()
    .trim()
    .min(3, 'Ad-soyad en az 3 karakter olmalı.')
    .max(80, 'Ad-soyad en fazla 80 karakter olabilir.')
    .regex(
      /^[A-Za-zÇĞİıÖŞÜçğıöşü' -]+$/,
      'Ad-soyad yalnızca harf, boşluk ve tire içerebilir.'
    ),
  // SECURITY (C2): governanceRole REGISTER üzerinden ATANAMAZ. Aksi halde
  // herhangi biri kendisini Ar-Ge mühendisi olarak kaydedip /governance/arge
  // endpoint'lerine erişebilir (privilege escalation). Atama yalnız admin
  // tarafından PUT /admin/users/:id/governance-role ile yapılır.
  // Zod .strict() kullanmadığımız için extra field'lar otomatik ignore edilir
  // — bu schema'da yer almaması zaten yeterli savunma.
}).refine((d) => d.password === d.passwordConfirm, {
  message: 'Parolalar eşleşmiyor.',
  path: ['passwordConfirm'],
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Profile update — kullanıcının kendi profilini güncelleyebileceği alanlar.
 * E-posta ve parola buradan güncellenmez (ayrı endpoint'ler).
 */
const optionalShortText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

export const profileUpdateSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, 'Ad-soyad en az 3 karakter olmalı.')
    .max(80)
    .regex(/^[A-Za-zÇĞİıÖŞÜçğıöşü' -]+$/, 'Ad-soyad yalnızca harf içerebilir.')
    .optional(),
  department: optionalShortText(80),
  title: optionalShortText(80),
  manager: optionalShortText(80),
  phone: z
    .string()
    .trim()
    .regex(/^[\d+\-() ]*$/, 'Telefon yalnızca rakam ve +-() içerebilir.')
    .max(24)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  bio: optionalShortText(500),
  projectIdea: optionalShortText(1000),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Admin tarafından user düzenleme.
 * Admin daha geniş alanları değiştirebilir; role/email/parola değiştirme bu endpoint'te yok.
 * status: 1 (aktif), 3 (devre dışı/soft deleted)
 */
export const adminUserUpdateSchema = profileUpdateSchema.extend({
  status: z.union([z.literal(1), z.literal(3)]).optional(),
  // governanceRole BİLİNÇLİ olarak burada YOK: rol atamanın tek yolu, özel audit
  // olayı ('user.governance_role_changed', eski→yeni rol detaylı) yazan
  // PUT /users/:id/governance-role ucudur. Genel güncelleme ucu rol değişimini
  // yalnız generic 'user.update' audit'iyle yapabiliyordu (sessiz yetki değişimi
  // yolu) — kapatıldı.
});

export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;

/**
 * Admin: kullanıcıya yönetişim rolü atama/kaldırma.
 * null = rolü kaldır, kullanıcıyı normal kullanıcıya döndür.
 */
export const adminSetGovernanceRoleSchema = z.object({
  governanceRole: z.union([
    z.literal('analitik_danisman'),
    z.literal('yz_arge'),
    z.literal('izleyici'),
    z.null(),
  ]),
});

export type AdminSetGovernanceRoleInput = z.infer<typeof adminSetGovernanceRoleSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});

const safeText = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} en az ${min} karakter olmalı.`)
    .max(max, `${label} en fazla ${max} karakter olabilir.`);

export const createBookingSchema = z.object({
  roomId: z.string().min(8).max(40),
  // Süre seçeneği: 1 hafta / 2 hafta / 1 ay.
  period: z.enum(['1w', '2w', '1m']),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih formatı YYYY-MM-DD olmalı.'),
  // Esnek/kısa süreli randevu: manuel bitiş tarihi. Verilmezse start + periyot
  // türetilir; verilirse periyot preset'inden bağımsız (kısa veya özel süre).
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih formatı YYYY-MM-DD olmalı.')
    .optional(),
  projectName: safeText(3, 120, 'Proje adı'),
  projectDescription: safeText(20, 2000, 'Proje açıklaması'),
  helpNeeded: safeText(10, 2000, 'Yardım talebi'),
  technologies: z
    .array(z.string().trim().min(1).max(40))
    .min(1, 'En az bir teknoloji seçin.')
    .max(20, 'En fazla 20 teknoloji seçilebilir.'),
  // Periyodik randevu: haftanın hangi günleri (1=Pzt..7=Paz). Verilmezse tüm hafta.
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1, 'En az bir gün seçin.')
    .max(7)
    .optional(),
}).refine(
  (d) => !d.endDate || d.endDate >= d.startDate,
  { message: 'Bitiş tarihi başlangıçtan önce olamaz.', path: ['endDate'] }
);

// Kullanıcı dashboard'u — ilerleme notu (boş string = notu temizle).
export const bookingProgressSchema = z.object({
  progressNote: z.string().trim().max(2000, 'İlerleme notu en fazla 2000 karakter olabilir.'),
});

// Görsel üretimi (gorsel_uretim entegrasyonu).
export const createVisualSchema = z.object({
  fikir: safeText(5, 400, 'Fikir'),
  tema: z.string().trim().max(200).optional(),
  roomId: z.string().min(8).max(40).optional(),
});

// Proje kartına görsel arkaplan atama (null = kaldır).
export const setShowcaseImageSchema = z.object({
  visualId: z.string().min(8).max(40).nullable(),
});

export const reviewBookingSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'request_feedback']),
    feedback: z.string().trim().max(2000).optional(),
  })
  .refine(
    (v) => (v.action === 'request_feedback' ? !!v.feedback && v.feedback.length >= 10 : true),
    {
      message: "'request_feedback' seçildiğinde en az 10 karakterlik feedback zorunludur.",
      path: ['feedback'],
    }
  );

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type ReviewBookingInput = z.infer<typeof reviewBookingSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/* ============================================================
 * Waitlist
 * ============================================================ */

export const joinWaitlistSchema = z.object({
  roomId: z.string().min(8).max(40),
  // Süre seçeneği: 1 hafta / 2 hafta / 1 ay.
  period: z.enum(['1w', '2w', '1m']),
  desiredStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih formatı YYYY-MM-DD olmalı.'),
  // Manuel (periyottan kısa) bitiş tarihi. Verilmezse start + periyot türetilir.
  desiredEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih formatı YYYY-MM-DD olmalı.')
    .optional(),
  projectName: safeText(3, 120, 'Proje adı'),
  projectDescription: safeText(20, 2000, 'Proje açıklaması'),
  helpNeeded: safeText(10, 2000, 'Yardım talebi'),
  technologies: z
    .array(z.string().trim().min(1).max(40))
    .min(1, 'En az bir teknoloji seçin.')
    .max(20, 'En fazla 20 teknoloji seçilebilir.'),
  // Haftanın hangi günleri (1=Pzt..7=Paz) — booking ile aynı semantik.
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1, 'En az bir gün seçin.')
    .max(7)
    .optional(),
})
  .refine(
    (d) => !d.desiredEndDate || d.desiredEndDate >= d.desiredStartDate,
    { message: 'Bitiş tarihi başlangıçtan önce olamaz.', path: ['desiredEndDate'] }
  )
  .refine(
    (d) => !d.desiredEndDate || d.desiredEndDate <= periodEndDate(d.desiredStartDate, d.period),
    { message: 'Bitiş tarihi periyodun ötesine geçemez.', path: ['desiredEndDate'] }
  );

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

/* ============================================================
 * Admin user search
 * ============================================================ */

export const adminUserSearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.union([z.literal('all'), z.literal('active'), z.literal('disabled')]).optional(),
  department: z.string().trim().max(80).optional(),
  hasBookings: z.union([z.literal('any'), z.literal('yes'), z.literal('no')]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type AdminUserSearchInput = z.infer<typeof adminUserSearchSchema>;

/* ============================================================
 * Admin MFA
 * ============================================================ */

export const mfaVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, '6 haneli kod giriniz.'),
});

export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

/* ============================================================
 * Lisans talebi
 * ============================================================ */

/**
 * License key: küçük harf + boşluk + nokta + tire + alfanümerik
 * (LICENSE_CATALOG anahtarları örn. 'github copilot', 'next.js' gibi).
 * 'custom' özel değeri — kullanıcı serbest yazdığında.
 */
const licenseKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9.\- ]+$/, 'Lisans tanımlayıcısı geçersiz karakter içeriyor.');

/**
 * Talep edilen tek bir AI aracı / lisansı.
 * Form 1+ tane gönderir (çoklu seçim) — junction tablosuna yazılır.
 */
const licenseRequestItemSchema = z.object({
  licenseKey: licenseKeySchema,
  licenseName: z.string().trim().min(2).max(80),
  vendor: z.string().trim().max(60).nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
});

/**
 * Sadeleştirilmiş başvuru formu (talep): yalnızca çekirdek alanlar ZORUNLU —
 * Talep Adı (ad), Kullanım Amacı (amaç), AI Araç/Lisans (araç) ve Süre.
 * Diğer alanlar (beklenen fayda, başarı kriteri, proje türü, kullanılacak veri,
 * dış API, gerçek veri beyanı, teknik yığın, tahmini süre) OPSİYONELDİR; form
 * göndermezse server null/varsayılan yazar. DB kolonları zaten nullable.
 */
export const createLicenseRequestSchema = z.object({
  // Talep adı — zorunlu, kısa başlık
  requestTitle: z
    .string()
    .trim()
    .min(5, 'Talep adı en az 5 karakter olmalı.')
    .max(120, 'Talep adı en fazla 120 karakter olabilir.'),

  // Kullanım amacı — mevcut `reason` kolonuna yazılır (zorunlu)
  reason: z
    .string()
    .trim()
    .min(20, 'Kullanım amacı en az 20 karakter olmalı.')
    .max(1000, 'Kullanım amacı en fazla 1000 karakter olabilir.'),

  // AI Araç / Lisans Talebi — zorunlu, çoklu seçim
  items: z
    .array(licenseRequestItemSchema)
    .min(1, 'En az bir AI aracı / lisans seçilmeli.')
    .max(10, 'En fazla 10 AI aracı seçilebilir.'),

  // Lisans kullanım süresi (ay) — zorunlu
  durationMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),

  /* --- Opsiyonel alanlar (form göndermeyebilir) --- */

  // Beklenen fayda (opsiyonel)
  expectedBenefit: optionalShortText(1000),

  // Başarı kriteri (opsiyonel)
  successCriteria: optionalShortText(1000),

  // Proje türü (opsiyonel — verilmezse 'poc' kabul edilir → governance 'basic')
  projectType: z.union([z.literal('poc'), z.literal('integration')]).optional(),

  // Tahmini süre — gün (opsiyonel)
  estimatedDurationDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .nullable()
    .optional(),

  // Kullanılacak veri (opsiyonel)
  dataToUse: optionalShortText(500),

  // Teknik yığın (opsiyonel)
  technicalStack: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),

  // Yönetişim — dış servis/API erişimi var mı (opsiyonel)
  usesExternalApi: z.boolean().optional(),

  // Yönetişim §5 — gerçek banka verisi / üretim / AD-LDAP beyanı (opsiyonel).
  // true ise başvuru otomatik reddedilir; verilmezse false kabul edilir.
  involvesRealData: z.boolean().optional(),
});

export type CreateLicenseRequestInput = z.infer<typeof createLicenseRequestSchema>;
export type LicenseRequestItemInput = z.infer<typeof licenseRequestItemSchema>;

export const reviewLicenseRequestSchema = z.object({
  action: z.union([
    z.literal('approve'),
    z.literal('reject'),
    z.literal('request_feedback'),
    z.literal('swat'),
  ]),
  adminFeedback: z.string().trim().max(1000).nullable().optional(),
});

export type ReviewLicenseRequestInput = z.infer<typeof reviewLicenseRequestSchema>;

/* ============================================================
 * YÖNETİŞİM — yaşam döngüsü, kalite kapıları, onaylar
 * ============================================================ */

/** Kalite kapısı sonucu (admin / CI pipeline). */
export const gateResultSchema = z.object({
  gateKey: z.union([
    z.literal('build'),
    z.literal('code_review'),
    z.literal('architecture'),
    z.literal('framework'),
    z.literal('security'),
  ]),
  status: z.union([z.literal('pending'), z.literal('passed'), z.literal('failed')]),
  score: z.number().int().min(0).max(100).nullable().optional(),
  detail: z.string().trim().max(500).nullable().optional(),
});

export type GateResultInput = z.infer<typeof gateResultSchema>;

/** Yaşam döngüsü ilerletme (development→stage→production→live). */
export const advanceLifecycleSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});

/** Stage / Production insan onayı kararı. */
export const decideApprovalSchema = z.object({
  approvalType: z.union([z.literal('stage'), z.literal('production')]),
  decision: z.union([z.literal('approved'), z.literal('rejected')]),
  releaseNote: z.string().trim().max(1000).nullable().optional(),
  riskAssessment: z.string().trim().max(1000).nullable().optional(),
});

export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;

/** Lab Mühendisi ataması. */
export const assignEngineerSchema = z.object({
  engineerId: z.string().trim().min(8).max(40),
});

export const adminLicenseRequestsFilterSchema = z.object({
  status: z
    .union([
      z.literal('pending'),
      z.literal('approved'),
      z.literal('rejected'),
      z.literal('feedback_requested'),
    ])
    .optional(),
});

export type AdminLicenseRequestsFilter = z.infer<typeof adminLicenseRequestsFilterSchema>;

/* ============================================================
 * Donanım talebi
 * ============================================================ */

export const createHardwareRequestSchema = z.object({
  equipmentType: z.union([
    z.literal('mouse'),
    z.literal('keyboard'),
    z.literal('camera'),
    z.literal('monitor'),
    z.literal('headset'),
    z.literal('other'),
  ]),
  // 'other' türü için açıklama veya diğer türler için ek detay (model vb.).
  equipmentDetail: z.string().trim().max(200).nullable().optional(),
  quantity: z.number().int().min(1, 'En az 1 adet.').max(20, 'En fazla 20 adet.'),
  reason: safeText(10, 1000, 'Gerekçe'),
  urgency: z.union([z.literal('low'), z.literal('normal'), z.literal('high')]),
});

export type CreateHardwareRequestInput = z.infer<typeof createHardwareRequestSchema>;

export const reviewHardwareRequestSchema = z.object({
  action: z.union([
    z.literal('approve'),
    z.literal('reject'),
    z.literal('request_feedback'),
  ]),
  adminFeedback: z.string().trim().max(1000).nullable().optional(),
});

export type ReviewHardwareRequestInput = z.infer<typeof reviewHardwareRequestSchema>;

export const hardwareRequestsFilterSchema = z.object({
  status: z
    .union([
      z.literal('pending'),
      z.literal('approved'),
      z.literal('rejected'),
      z.literal('feedback_requested'),
    ])
    .optional(),
});

/* ============================================================
 * Destek talebi
 * ============================================================ */

export const createSupportRequestSchema = z.object({
  description: safeText(10, 1000, 'Destek açıklaması'),
});

export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>;

export const supportRequestsFilterSchema = z.object({
  status: z.union([z.literal('open'), z.literal('resolved')]).optional(),
});

/* ============================================================
 * Kütüphane (kitap + ödünç)
 * ============================================================ */

export const createBookSchema = z.object({
  title: safeText(1, 200, 'Kitap adı'),
  author: safeText(1, 120, 'Yazar'),
  isbn: optionalShortText(20),
  category: optionalShortText(60),
  description: optionalShortText(2000),
  coverImageUrl: optionalShortText(500),
  // Toplam kopya sayısı; 0 = geçici olarak ödünç verilemez (envanter dışı).
  totalCopies: z.number().int().min(0).max(999),
});

export const updateBookSchema = createBookSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** Ödünç süresi (gün) — varsayılan 14. */
export const borrowBookSchema = z.object({
  periodDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
});

/** Süre uzatma talebi (gün). */
export const requestExtensionSchema = z.object({
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
});

export type CreateBookInput = z.infer<typeof createBookSchema>;
export type UpdateBookInput = z.infer<typeof updateBookSchema>;
export type BorrowBookInput = z.infer<typeof borrowBookSchema>;
export type RequestExtensionInput = z.infer<typeof requestExtensionSchema>;
