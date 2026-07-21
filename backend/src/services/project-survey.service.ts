/**
 * Proje sonu anketi — kullanıcının laboratuvarda yürüttüğü projeyi kendi
 * cümleleriyle anlattığı 3 soruluk açık uçlu anket (bkz. migration
 * 0012-project-survey.sql).
 *
 * Gösterim bazlıdır: her gösterimde yeni satır yazılır (kullanıcı başına tek
 * kayıt DEĞİL) → aynı kişi zamanla birden fazla proje anlatabilir. ŞİMDİLİK
 * çıkış akışında sunuluyor; İLERİDE proje tamamlanma akışına taşınacak.
 *
 * Zaman damgası: ADR-001 — created_at DEFAULT'u to_char(now(), ...) ile TEXT
 * 'YYYY-MM-DD HH:MM:SS' üretir; uygulama tarafında toISOString() YAZILMAZ.
 */
import { nanoid } from 'nanoid';
import { dbRun } from '../db/schema';
import type { SubjectKind } from '../types/auth.types';

export interface ProjectSurveyInput {
  projectWork?: string | null;
  labFeedback?: string | null;
  improvement?: string | null;
}

/**
 * Anket yanıtını kaydeder. Tüm alanlar opsiyoneldir — kullanıcı bir soruyu
 * boş bırakabilir. Trim sonrası hepsi boşsa kayıt yazılmaz (gürültü olmasın);
 * bu durumda `saved: false` döner ve çağıran yine de çıkışa devam eder.
 */
export async function recordProjectSurvey(
  subjectId: string,
  subjectKind: SubjectKind,
  input: ProjectSurveyInput
): Promise<{ saved: boolean }> {
  // danisman/arge/izleyici users tablosunun satırlarıdır → 'user' olarak yazılır
  // (kolonun CHECK kısıtı yalnız 'user' | 'admin' kabul eder).
  const subjectType = subjectKind === 'admin' ? 'admin' : 'user';

  const projectWork = input.projectWork?.trim() || null;
  const labFeedback = input.labFeedback?.trim() || null;
  const improvement = input.improvement?.trim() || null;

  const hasAnswer = projectWork !== null || labFeedback !== null || improvement !== null;
  if (!hasAnswer) return { saved: false };

  await dbRun(
    `INSERT INTO project_surveys
       (id, subject_id, subject_type, project_work, lab_feedback, improvement)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nanoid(), subjectId, subjectType, projectWork, labFeedback, improvement]
  );
  return { saved: true };
}
