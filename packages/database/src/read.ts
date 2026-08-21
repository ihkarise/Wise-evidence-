import type { QueryExecutor } from './db.js';
import type {
  ClassificationDimension,
  CriticismCategory,
  CriticismOrigin,
} from './types.js';

/**
 * Read models for pages. These run under whatever RLS context the executor
 * carries: for the public research page the executor is the anon/public role, so
 * RLS returns PUBLISHED records only — drafts, AI results, reviews, corrections,
 * import candidates, and audit rows can never leak here.
 */

export interface PublicClassification {
  dimension: ClassificationDimension;
  value: string;
  judgement_confidence: string | null;
  explanation: string | null;
}

export interface PublicCriticism {
  category: CriticismCategory;
  origin: CriticismOrigin;
  body: string;
  source_reference: string | null;
}

export interface PublicResearchDetail {
  id: string;
  title: string;
  summary: string | null;
  study_type_code: string | null;
  subject: string | null;
  publication_title: string;
  abstract: string | null;
  publication_date: string | null;
  journal_name: string | null;
  source_url: string | null;
  doi: string | null;
  url: string | null;
  authors: string[];
  conditions: { slug: string; name: string }[];
  interventions: { slug: string; name: string }[];
  classifications: PublicClassification[];
  criticisms: PublicCriticism[];
}

/**
 * Compose the public detail for a study, or null if it is not publicly visible.
 * Only the primary published publication is used.
 */
export async function getPublishedStudyDetail(
  exec: QueryExecutor,
  studyId: string
): Promise<PublicResearchDetail | null> {
  const base = await exec.query<{
    id: string;
    canonical_title: string;
    summary: string | null;
    study_type_code: string | null;
    subject: string | null;
    publication_id: string;
    publication_title: string;
    abstract: string | null;
    publication_date: string | null;
    journal_name: string | null;
    source_url: string | null;
  }>(
    `select s.id, s.canonical_title, s.summary, s.study_type_code, s.subject,
            p.id as publication_id, p.title as publication_title, p.abstract, p.publication_date,
            j.display_name as journal_name, src.source_url
       from research_study s
       join publication p on p.study_id = s.id and p.is_primary = true
       left join journal j on j.id = p.journal_id
       left join research_source src on src.id = p.source_id
      where s.id = $1
      limit 1`,
    [studyId]
  );
  const row = base.rows[0];
  if (!row) return null;

  const [ids, authors, conditions, interventions, classifications, criticisms] = await Promise.all([
    exec.query<{ id_type: string; value_canonical: string }>(
      `select id_type, value_canonical from research_identifier where publication_id = $1`,
      [row.publication_id]
    ),
    exec.query<{ display_name: string }>(
      `select a.display_name from publication_author pa
         join author a on a.id = pa.author_id
        where pa.publication_id = $1 order by pa.author_position`,
      [row.publication_id]
    ),
    exec.query<{ slug: string; canonical_name: string }>(
      `select c.slug, c.canonical_name from study_condition sc
         join condition c on c.id = sc.condition_id where sc.study_id = $1`,
      [studyId]
    ),
    exec.query<{ slug: string; canonical_name: string }>(
      `select i.slug, i.canonical_name from study_intervention si
         join intervention i on i.id = si.intervention_id where si.study_id = $1`,
      [studyId]
    ),
    exec.query<PublicClassification>(
      `select dimension, value, judgement_confidence, explanation from classification where study_id = $1`,
      [studyId]
    ),
    exec.query<PublicCriticism>(
      `select category, origin, body, source_reference from criticism
        where study_id = $1 and status = 'active'`,
      [studyId]
    ),
  ]);

  const doi = ids.rows.find((r) => r.id_type === 'DOI')?.value_canonical ?? null;
  const url = ids.rows.find((r) => r.id_type === 'URL')?.value_canonical ?? null;

  return {
    id: row.id,
    title: row.canonical_title,
    summary: row.summary,
    study_type_code: row.study_type_code,
    subject: row.subject,
    publication_title: row.publication_title,
    abstract: row.abstract,
    publication_date: row.publication_date,
    journal_name: row.journal_name,
    source_url: row.source_url,
    doi,
    url,
    authors: authors.rows.map((r) => r.display_name),
    conditions: conditions.rows.map((r) => ({ slug: r.slug, name: r.canonical_name })),
    interventions: interventions.rows.map((r) => ({ slug: r.slug, name: r.canonical_name })),
    classifications: classifications.rows,
    criticisms: criticisms.rows,
  };
}

/** List studies awaiting review (staff context). */
export async function listReviewQueue(
  exec: QueryExecutor
): Promise<{ id: string; canonical_title: string; lifecycle_state: string }[]> {
  const { rows } = await exec.query<{ id: string; canonical_title: string; lifecycle_state: string }>(
    `select id, canonical_title, lifecycle_state from research_study
      where lifecycle_state = 'PENDING_REVIEW' order by updated_at desc`
  );
  return rows;
}
