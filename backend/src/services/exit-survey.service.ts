/**
 * Çıkış anketi — kullanıcı "Çıkış" dediğinde sorulan 5 soruluk kısa deneyim
 * anketi (bkz. migration 0011-exit-survey.sql).
 *
 * Oturum bazlıdır: her çıkışta yeni satır yazılır (kullanıcı başına tek kayıt
 * DEĞİL) → memnuniyet zaman içinde trend olarak izlenebilir.
 *
 * Zaman damgası: ADR-001 — created_at DEFAULT'u to_char(now(), ...) ile TEXT
 * 'YYYY-MM-DD HH:MM:SS' üretir; uygulama tarafında toISOString() YAZILMAZ.
 */
import { nanoid } from 'nanoid';
import { dbAll, dbOne, dbRun } from '../db/schema';
import type { SubjectKind } from '../types/auth.types';

/** 1..5 puanlanan sorular — kolon adlarıyla birebir. */
export const SURVEY_SCORE_FIELDS = [
  'overall',
  'workspace',
  'bookingEase',
  'support',
  'recommend',
] as const;

export type SurveyScoreField = (typeof SURVEY_SCORE_FIELDS)[number];

export interface ExitSurveyInput {
  overall?: number | null;
  workspace?: number | null;
  bookingEase?: number | null;
  support?: number | null;
  recommend?: number | null;
  comment?: string | null;
}

/**
 * Anket yanıtını kaydeder. Tüm puanlar opsiyoneldir — kullanıcı bir soruyu
 * boş bırakabilir. Hepsi boş VE yorum yoksa kayıt yazılmaz (gürültü olmasın);
 * bu durumda `saved: false` döner ve çağıran yine de çıkışa devam eder.
 */
export async function recordExitSurvey(
  subjectId: string,
  subjectKind: SubjectKind,
  input: ExitSurveyInput
): Promise<{ saved: boolean }> {
  // danisman/arge/izleyici users tablosunun satırlarıdır → 'user' olarak yazılır
  // (kolonun CHECK kısıtı yalnız 'user' | 'admin' kabul eder).
  const subjectType = subjectKind === 'admin' ? 'admin' : 'user';

  const comment = input.comment?.trim() || null;
  const scores = {
    overall: input.overall ?? null,
    workspace: input.workspace ?? null,
    booking_ease: input.bookingEase ?? null,
    support: input.support ?? null,
    recommend: input.recommend ?? null,
  };

  const hasAnswer = Object.values(scores).some((v) => v !== null) || comment !== null;
  if (!hasAnswer) return { saved: false };

  await dbRun(
    `INSERT INTO exit_surveys
       (id, subject_id, subject_type, overall, workspace, booking_ease, support, recommend, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      subjectId,
      subjectType,
      scores.overall,
      scores.workspace,
      scores.booking_ease,
      scores.support,
      scores.recommend,
      comment,
    ]
  );
  return { saved: true };
}

export interface ExitSurveySummary {
  total: number;
  averages: Record<SurveyScoreField, number | null>;
  /** overall dağılımı: puan → adet (1..5). */
  overallDistribution: Record<string, number>;
  recentComments: Array<{ comment: string; createdAt: string }>;
}

/**
 * Admin özeti — ortalamalar, overall dağılımı ve son yorumlar.
 * Yorumlar kimliksiz döner (kim yazdığı gösterilmez): dürüst geri bildirim
 * için anket pratikte anonim sunulur; subject_id yalnız DB'de denetim amacıyla
 * saklanır.
 */
export async function getExitSurveySummary(limitComments = 20): Promise<ExitSurveySummary> {
  const agg = (await dbOne(
    `SELECT COUNT(*) AS total,
            AVG(overall)      AS avg_overall,
            AVG(workspace)    AS avg_workspace,
            AVG(booking_ease) AS avg_booking_ease,
            AVG(support)      AS avg_support,
            AVG(recommend)    AS avg_recommend
       FROM exit_surveys`,
    []
  )) as Record<string, string | number | null>;

  const dist = (await dbAll(
    `SELECT overall AS score, COUNT(*) AS count
       FROM exit_surveys
      WHERE overall IS NOT NULL
      GROUP BY overall`,
    []
  )) as Array<{ score: number; count: number | string }>;

  const comments = (await dbAll(
    `SELECT comment, created_at
       FROM exit_surveys
      WHERE comment IS NOT NULL AND comment <> ''
      ORDER BY created_at DESC
      LIMIT ?`,
    [limitComments]
  )) as Array<{ comment: string; created_at: string }>;

  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100;

  return {
    total: Number(agg.total ?? 0),
    averages: {
      overall: num(agg.avg_overall),
      workspace: num(agg.avg_workspace),
      bookingEase: num(agg.avg_booking_ease),
      support: num(agg.avg_support),
      recommend: num(agg.avg_recommend),
    },
    overallDistribution: Object.fromEntries(
      dist.map((d) => [String(d.score), Number(d.count)])
    ),
    recentComments: comments.map((c) => ({ comment: c.comment, createdAt: c.created_at })),
  };
}
