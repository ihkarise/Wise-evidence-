/**
 * Read queries for the admin editor, admin listings/review queue, and the
 * public research detail page (docs/26 §14, §18, §22).
 *
 * The SAME functions run under different roles: the admin surfaces call them
 * with a staff-scoped executor (RLS shows drafts), and the public detail page
 * calls them with the anon executor (RLS shows only PUBLISHED). The functions
 * hold no authorization of their own — RLS decides visibility — so the public
 * page genuinely exercises production RLS (docs/26 §22).
 */
import type { SqlExecutor } from "../executor.js";

export interface AuthorView {
  readonly displayName: string;
  readonly order: number;
}
export interface CriticismView {
  readonly id: string;
  readonly category: string;
  readonly origin: string;
  readonly text: string;
  readonly sourceReference: string | null;
  readonly sourceUrl: string | null;
}
export interface StudyDetail {
  readonly id: string;
  readonly title: string;
  readonly humanSummary: string | null;
  readonly lifecycleState: string;
  readonly publicationState: string;
  readonly isDemo: boolean;
  readonly subjectType: string;
  readonly studyTypeCode: string | null;
  readonly studyTypeLabel: string | null;
  readonly evidenceLevelLabel: string | null;
  readonly abstract: string | null;
  readonly publicationDate: string | null;
  readonly journalTitle: string | null;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly doi: string | null;
  readonly outcome: string | null;
  readonly outcomeConfidence: string | null;
  readonly outcomeExplanation: string | null;
  readonly qualitySummary: string | null;
  readonly authors: readonly AuthorView[];
  readonly conditions: readonly string[];
  readonly interventions: readonly string[];
  readonly criticism: readonly CriticismView[];
}

/**
 * Assemble a full study detail, or null if the executor's role cannot see it
 * (e.g. anon on a non-published study). One study, its primary publication, and
 * the independent classification dimensions — never collapsed into a score.
 */
export async function getStudyDetail(
  db: SqlExecutor,
  studyId: string,
): Promise<StudyDetail | null> {
  const study = await first<{
    id: string;
    canonical_title: string;
    human_summary: string | null;
    lifecycle_state: string;
    publication_state: string;
    is_demo: boolean;
    subject_type: string;
    study_type_code: string | null;
    study_type_label: string | null;
    evidence_level_label: string | null;
  }>(
    db,
    `select s.id, s.canonical_title, s.human_summary, s.lifecycle_state, s.publication_state,
            s.is_demo, s.subject_type,
            st.code  as study_type_code,
            st.label as study_type_label,
            el.label as evidence_level_label
       from research_study s
       left join study_type st on st.id = s.study_type_id
       left join evidence_level el on el.id = st.evidence_level_id
      where s.id = $1`,
    [studyId],
  );
  if (!study) return null;

  const pub = await first<{
    id: string;
    abstract: string | null;
    publication_date: string | null;
    journal_title: string | null;
    source_name: string | null;
    source_url: string | null;
  }>(
    db,
    `select p.id, p.abstract, to_char(p.publication_date, 'YYYY-MM-DD') as publication_date,
            j.normalized_name as journal_title,
            rs.name as source_name, rs.url as source_url
       from publication p
       left join journal j on j.id = p.journal_id
       left join research_source rs on rs.id = p.source_id
      where p.study_id = $1 and p.is_primary = true
      limit 1`,
    [studyId],
  );

  const doiRow = pub
    ? await first<{ value_canonical: string }>(
        db,
        `select value_canonical from research_identifier
          where type = 'DOI' and (publication_id = $1 or study_id = $2)
          order by created_at asc limit 1`,
        [pub.id, studyId],
      )
    : null;

  const authors = pub
    ? (
        await rowsOf<{ display_name: string; author_order: number }>(
          db,
          `select a.display_name, pa.author_order
             from publication_author pa join author a on a.id = pa.author_id
            where pa.publication_id = $1
            order by pa.author_order asc`,
          [pub.id],
        )
      ).map((r) => ({ displayName: r.display_name, order: r.author_order }))
    : [];

  const outcome = await first<{
    final_value: string | null;
    confidence: string | null;
    explanation: string | null;
  }>(
    db,
    "select final_value, confidence, explanation from classification where study_id = $1 and dimension = 'OUTCOME'",
    [studyId],
  );
  const quality = await first<{ final_value: string | null }>(
    db,
    "select final_value from classification where study_id = $1 and dimension = 'QUALITY'",
    [studyId],
  );

  const conditions = (
    await rowsOf<{ canonical_name: string }>(
      db,
      `select c.canonical_name from study_condition sc join condition c on c.id = sc.condition_id
        where sc.study_id = $1 order by c.canonical_name`,
      [studyId],
    )
  ).map((r) => r.canonical_name);

  const interventions = (
    await rowsOf<{ canonical_name: string }>(
      db,
      `select i.canonical_name from study_intervention si join intervention i on i.id = si.intervention_id
        where si.study_id = $1 order by i.canonical_name`,
      [studyId],
    )
  ).map((r) => r.canonical_name);

  const criticism = (
    await rowsOf<{
      id: string;
      category: string;
      origin: string;
      text: string;
      source_reference: string | null;
      source_url: string | null;
    }>(
      db,
      `select id, category, origin, text, source_reference, source_url
         from criticism where study_id = $1 and status = 'ACTIVE' order by created_at asc`,
      [studyId],
    )
  ).map((r) => ({
    id: r.id,
    category: r.category,
    origin: r.origin,
    text: r.text,
    sourceReference: r.source_reference,
    sourceUrl: r.source_url,
  }));

  return {
    id: study.id,
    title: study.canonical_title,
    humanSummary: study.human_summary,
    lifecycleState: study.lifecycle_state,
    publicationState: study.publication_state,
    isDemo: study.is_demo,
    subjectType: study.subject_type,
    studyTypeCode: study.study_type_code,
    studyTypeLabel: study.study_type_label,
    evidenceLevelLabel: study.evidence_level_label,
    abstract: pub?.abstract ?? null,
    publicationDate: pub?.publication_date ?? null,
    journalTitle: pub?.journal_title ?? null,
    sourceName: pub?.source_name ?? null,
    sourceUrl: pub?.source_url ?? null,
    doi: doiRow?.value_canonical ?? null,
    outcome: outcome?.final_value ?? null,
    outcomeConfidence: outcome?.confidence ?? null,
    outcomeExplanation: outcome?.explanation ?? null,
    qualitySummary: quality?.final_value ?? null,
    authors,
    conditions,
    interventions,
    criticism,
  };
}

export interface StudyListItem {
  readonly id: string;
  readonly title: string;
  readonly lifecycleState: string;
  readonly publicationState: string;
  readonly isDemo: boolean;
  readonly updatedAt: string;
}

/**
 * Admin listing / review queue (docs/26 §18). With a staff executor this shows
 * drafts and pending items; filter by publication_state when given.
 */
export async function listStudies(
  db: SqlExecutor,
  filter?: { publicationState?: string },
): Promise<StudyListItem[]> {
  const rows = await rowsOf<{
    id: string;
    canonical_title: string;
    lifecycle_state: string;
    publication_state: string;
    is_demo: boolean;
    updated_at: string;
  }>(
    db,
    `select id, canonical_title, lifecycle_state, publication_state, is_demo, updated_at
       from research_study
      where ($1::text is null or publication_state = $1::publication_state)
      order by updated_at desc
      limit 200`,
    [filter?.publicationState ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.canonical_title,
    lifecycleState: r.lifecycle_state,
    publicationState: r.publication_state,
    isDemo: r.is_demo,
    updatedAt: r.updated_at,
  }));
}

// --- tiny helpers ------------------------------------------------------------

async function first<T>(db: SqlExecutor, sql: string, params: unknown[]): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] ?? null;
}
async function rowsOf<T>(db: SqlExecutor, sql: string, params: unknown[]): Promise<T[]> {
  const { rows } = await db.query<T>(sql, params);
  return rows;
}
