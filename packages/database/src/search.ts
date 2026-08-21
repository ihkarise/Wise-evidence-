import { normalizeDoi } from '@wise-evidence/domain';
import type { QueryExecutor } from './db.js';

/**
 * Public research explorer read layer (ADR-014). All queries run under the anon
 * RLS context, so PostgreSQL returns PUBLISHED research only — drafts, pending,
 * rejected, archived, AI, reviews, corrections, imports, and audit are never
 * reachable. Every value is parameterized; nothing is interpolated into SQL.
 * Ranking is deterministic — no AI, no popularity, no efficacy weighting.
 */

export type ResearchSort = 'relevance' | 'newest' | 'oldest' | 'title';

export interface ExplorerParams {
  q?: string;
  studyType?: string;
  evidenceLevel?: string;
  outcome?: string;
  quality?: string;
  condition?: string;
  intervention?: string;
  yearFrom?: number;
  yearTo?: number;
  sort?: ResearchSort;
  page?: number;
}

export interface ResearchCard {
  id: string;
  title: string;
  year: number | null;
  journal: string | null;
  authors: string[];
  study_type_code: string | null;
  evidence_level: string | null;
  outcome: string | null;
  quality: string | null;
  conditions: string[];
  interventions: string[];
  summary: string | null;
  doi: string | null;
  is_demo: boolean;
}

export interface SearchResult {
  cards: ResearchCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Facets {
  studyTypes: { code: string; label: string }[];
  evidenceLevels: { code: string; label: string }[];
  outcomes: string[];
  qualities: string[];
  conditions: { slug: string; name: string }[];
  interventions: { slug: string; name: string }[];
  yearMin: number | null;
  yearMax: number | null;
}

export const PAGE_SIZE = 20;
const OUTCOME_VALUES = ['STRONG_POSITIVE', 'POSITIVE', 'LEANING_POSITIVE', 'NEUTRAL_INCONCLUSIVE', 'LEANING_NEGATIVE', 'NEGATIVE', 'STRONG_NEGATIVE'];
const QUALITY_VALUES = ['ADEQUATE', 'UNCLEAR', 'INADEQUATE', 'NOT_APPLICABLE'];
const SORTS: ResearchSort[] = ['relevance', 'newest', 'oldest', 'title'];

/**
 * Validate and normalize raw query-string values into typed ExplorerParams.
 * Unknown enum values are dropped; years/page are coerced and clamped. Slug/code
 * values are passed through (used only as bound parameters, so a bogus value is
 * safe and simply matches nothing).
 */
export function normalizeExplorerParams(raw: Record<string, string | undefined | null>): ExplorerParams {
  const str = (v: string | undefined | null) => {
    const t = (v ?? '').trim();
    return t === '' ? undefined : t.slice(0, 200);
  };
  const year = (v: string | undefined | null) => {
    const n = Number.parseInt((v ?? '').trim(), 10);
    return Number.isFinite(n) && n >= 1500 && n <= 2200 ? n : undefined;
  };
  const oneOf = (v: string | undefined | null, allowed: string[]) => {
    const t = (v ?? '').trim().toUpperCase();
    return allowed.includes(t) ? t : undefined;
  };
  const page = Math.max(1, Number.parseInt((raw.page ?? '1').trim(), 10) || 1);
  const sortRaw = (raw.sort ?? '').trim().toLowerCase();
  const sort = (SORTS as string[]).includes(sortRaw) ? (sortRaw as ResearchSort) : undefined;

  return {
    q: str(raw.q),
    studyType: str(raw.studyType),
    evidenceLevel: str(raw.evidenceLevel),
    outcome: oneOf(raw.outcome, OUTCOME_VALUES),
    quality: oneOf(raw.quality, QUALITY_VALUES),
    condition: str(raw.condition),
    intervention: str(raw.intervention),
    yearFrom: year(raw.yearFrom),
    yearTo: year(raw.yearTo),
    sort,
    page,
  };
}

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** Shared FROM + WHERE for the primary published publication of each study. */
function buildFilters(p: Params, params: ExplorerParams): string {
  const where: string[] = [];
  if (params.studyType) where.push(`s.study_type_code = ${p.add(params.studyType)}`);
  if (params.outcome) where.push(`exists (select 1 from classification c where c.study_id = s.id and c.dimension = 'OUTCOME' and c.value = ${p.add(params.outcome)})`);
  if (params.quality) where.push(`exists (select 1 from classification c where c.study_id = s.id and c.dimension = 'QUALITY' and c.value = ${p.add(params.quality)})`);
  if (params.evidenceLevel) where.push(`exists (select 1 from classification c where c.study_id = s.id and c.dimension = 'EVIDENCE_LEVEL' and c.value = ${p.add(params.evidenceLevel)})`);
  if (params.condition) where.push(`exists (select 1 from study_condition sc join condition c on c.id = sc.condition_id where sc.study_id = s.id and c.slug = ${p.add(params.condition)})`);
  if (params.intervention) where.push(`exists (select 1 from study_intervention si join intervention i on i.id = si.intervention_id where si.study_id = s.id and i.slug = ${p.add(params.intervention)})`);
  if (params.yearFrom !== undefined) where.push(`extract(year from p.publication_date) >= ${p.add(params.yearFrom)}`);
  if (params.yearTo !== undefined) where.push(`extract(year from p.publication_date) <= ${p.add(params.yearTo)}`);
  return where.length ? `and ${where.join(' and ')}` : '';
}

const DOCUMENT_SQL = `to_tsvector('english',
  coalesce(s.canonical_title,'') || ' ' || coalesce(s.summary,'') || ' ' ||
  coalesce(p.title,'') || ' ' || coalesce(p.abstract,'') || ' ' ||
  coalesce(j.display_name,'') || ' ' ||
  coalesce((select string_agg(a.display_name, ' ') from publication_author pa join author a on a.id = pa.author_id where pa.publication_id = p.id), '') || ' ' ||
  coalesce((select string_agg(c.canonical_name, ' ') from study_condition sc join condition c on c.id = sc.condition_id where sc.study_id = s.id), '') || ' ' ||
  coalesce((select string_agg(i.canonical_name, ' ') from study_intervention si join intervention i on i.id = si.intervention_id where si.study_id = s.id), '')
)`;

const BASE_FROM = `from research_study s
  join publication p on p.study_id = s.id and p.is_primary = true and p.publication_state = 'PUBLISHED'
  left join journal j on j.id = p.journal_id
 where s.lifecycle_state = 'PUBLISHED'`;

/** Search + filter + sort + paginate PUBLISHED research. */
export async function searchPublishedResearch(exec: QueryExecutor, params: ExplorerParams): Promise<SearchResult> {
  const page = Math.max(1, params.page ?? 1);
  const p = new Params();
  const filters = buildFilters(p, params);

  // Text match (optional). DOI-aware: if q is a DOI, boost/allow exact-id match.
  let matchClause = '';
  let rankExpr = '0::float';
  if (params.q) {
    const qp = p.add(params.q);
    const doi = normalizeDoi(params.q);
    let doiMatch = 'false';
    let doiBoost = '0';
    if (doi.ok) {
      const dp = p.add(doi.doi);
      doiMatch = `exists (select 1 from research_identifier ri where ri.publication_id = p.id and ri.id_type = 'DOI' and ri.value_canonical = ${dp})`;
      doiBoost = `(case when ${doiMatch} then 100 else 0 end)`;
    }
    matchClause = `and (${DOCUMENT_SQL} @@ websearch_to_tsquery('english', ${qp})${doi.ok ? ` or ${doiMatch}` : ''})`;
    rankExpr = `(${doiBoost} + (case when lower(s.canonical_title) = lower(${qp}) then 50 else 0 end) + ts_rank(${DOCUMENT_SQL}, websearch_to_tsquery('english', ${qp})))`;
  }

  // Ordering.
  const effectiveSort = params.sort ?? (params.q ? 'relevance' : 'newest');
  const orderBy =
    effectiveSort === 'relevance' && params.q
      ? `${rankExpr} desc, p.publication_date desc nulls last`
      : effectiveSort === 'oldest'
        ? `p.publication_date asc nulls last, lower(s.canonical_title) asc`
        : effectiveSort === 'title'
          ? `lower(s.canonical_title) asc`
          : `p.publication_date desc nulls last, lower(s.canonical_title) asc`;

  const limit = p.add(PAGE_SIZE);
  const offset = p.add((page - 1) * PAGE_SIZE);

  const sql = `
    select s.id, s.canonical_title as title, s.summary, s.study_type_code, s.is_demo,
           extract(year from p.publication_date)::int as year,
           j.display_name as journal,
           coalesce((select array_agg(a.display_name order by pa.author_position)
                       from publication_author pa join author a on a.id = pa.author_id
                      where pa.publication_id = p.id), '{}') as authors,
           coalesce((select array_agg(c.canonical_name)
                       from study_condition sc join condition c on c.id = sc.condition_id
                      where sc.study_id = s.id), '{}') as conditions,
           coalesce((select array_agg(i.canonical_name)
                       from study_intervention si join intervention i on i.id = si.intervention_id
                      where si.study_id = s.id), '{}') as interventions,
           (select value from classification c where c.study_id = s.id and c.dimension = 'OUTCOME') as outcome,
           (select value from classification c where c.study_id = s.id and c.dimension = 'QUALITY') as quality,
           (select value from classification c where c.study_id = s.id and c.dimension = 'EVIDENCE_LEVEL') as evidence_level,
           (select value_canonical from research_identifier ri where ri.publication_id = p.id and ri.id_type = 'DOI' limit 1) as doi
      ${BASE_FROM}
      ${filters}
      ${matchClause}
     order by ${orderBy}
     limit ${limit} offset ${offset}`;

  const countP = new Params();
  const countFilters = buildFilters(countP, params);
  let countMatch = '';
  if (params.q) {
    const qp = countP.add(params.q);
    const doi = normalizeDoi(params.q);
    if (doi.ok) {
      const dp = countP.add(doi.doi);
      countMatch = `and (${DOCUMENT_SQL} @@ websearch_to_tsquery('english', ${qp}) or exists (select 1 from research_identifier ri where ri.publication_id = p.id and ri.id_type = 'DOI' and ri.value_canonical = ${dp}))`;
    } else {
      countMatch = `and (${DOCUMENT_SQL} @@ websearch_to_tsquery('english', ${qp}))`;
    }
  }
  const countSql = `select count(*)::int as n ${BASE_FROM} ${countFilters} ${countMatch}`;

  const [rows, count] = await Promise.all([
    exec.query<ResearchCard & { year: number | null }>(sql, p.values),
    exec.query<{ n: number }>(countSql, countP.values),
  ]);

  return {
    cards: rows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      year: r.year,
      journal: r.journal,
      authors: r.authors ?? [],
      study_type_code: r.study_type_code,
      evidence_level: r.evidence_level,
      outcome: r.outcome,
      quality: r.quality,
      conditions: r.conditions ?? [],
      interventions: r.interventions ?? [],
      summary: r.summary,
      doi: r.doi,
      is_demo: r.is_demo,
    })),
    total: count.rows[0]?.n ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

/** Facet options present among PUBLISHED research (for the filter controls). */
export async function getPublishedResearchFacets(exec: QueryExecutor): Promise<Facets> {
  const [studyTypes, evidenceLevels, outcomes, qualities, conditions, interventions, years] = await Promise.all([
    exec.query<{ code: string; label: string }>(
      `select distinct st.code, st.label from research_study s
         join study_type st on st.code = s.study_type_code
        where s.lifecycle_state = 'PUBLISHED' order by st.label`
    ),
    exec.query<{ code: string; label: string }>(
      `select distinct el.code, el.label from classification c
         join evidence_level el on el.code = c.value
        where c.dimension = 'EVIDENCE_LEVEL' order by el.label`
    ),
    exec.query<{ value: string }>(`select distinct value from classification where dimension = 'OUTCOME'`),
    exec.query<{ value: string }>(`select distinct value from classification where dimension = 'QUALITY'`),
    exec.query<{ slug: string; name: string }>(
      `select distinct c.slug, c.canonical_name as name from study_condition sc
         join condition c on c.id = sc.condition_id
         join research_study s on s.id = sc.study_id
        where s.lifecycle_state = 'PUBLISHED' order by c.canonical_name`
    ),
    exec.query<{ slug: string; name: string }>(
      `select distinct i.slug, i.canonical_name as name from study_intervention si
         join intervention i on i.id = si.intervention_id
         join research_study s on s.id = si.study_id
        where s.lifecycle_state = 'PUBLISHED' order by i.canonical_name`
    ),
    exec.query<{ ymin: number | null; ymax: number | null }>(
      `select min(extract(year from p.publication_date))::int as ymin,
              max(extract(year from p.publication_date))::int as ymax
         from publication p join research_study s on s.id = p.study_id
        where p.publication_state = 'PUBLISHED'`
    ),
  ]);

  const orderOut = (vals: string[]) => OUTCOME_VALUES.filter((v) => vals.includes(v));
  return {
    studyTypes: studyTypes.rows,
    evidenceLevels: evidenceLevels.rows,
    outcomes: orderOut(outcomes.rows.map((r) => r.value)),
    qualities: QUALITY_VALUES.filter((v) => qualities.rows.some((r) => r.value === v)),
    conditions: conditions.rows,
    interventions: interventions.rows,
    yearMin: years.rows[0]?.ymin ?? null,
    yearMax: years.rows[0]?.ymax ?? null,
  };
}
