/**
 * Public research explorer query layer (docs/14, docs/27 — Milestone 4).
 *
 * A server-side, PostgreSQL-only search/browse layer over PUBLISHED research.
 * It runs on the same narrow `SqlExecutor` boundary the rest of the service
 * layer uses, and holds NO authorization of its own: on the public web path it
 * is called with the ANON executor, so Row-Level Security is the authoritative
 * gate (only PUBLISHED studies and their published children are visible). As a
 * second, belt-and-braces guarantee — so the function is correct under ANY
 * executor role, including a privileged one in tests — every query also filters
 * `publication_state = 'PUBLISHED'` explicitly.
 *
 * Design invariants (docs/27 §2, master prompt §§ credibility core):
 *   - PostgreSQL FTS only. No AI, no embeddings, no vector DB, no external
 *     search service, no popularity/votes, no efficacy score.
 *   - Outcome, quality, confidence, criticism and evidence level stay SEPARATE.
 *     Nothing here combines them, ranks positive above negative, or weights a
 *     result by its reported outcome.
 *   - Exact canonical-DOI matching takes priority over full-text ranking
 *     (docs/14 §4), reusing `@wise-evidence/domain` `toCanonicalDoi()`.
 *   - Every user value is a bound parameter — user input is NEVER interpolated
 *     into SQL. Pagination is clamped; sort comes from a fixed whitelist.
 *
 * Framework-independent: imports only `@wise-evidence/domain` and local modules.
 */
import { toCanonicalDoi } from "@wise-evidence/domain";
import { OUTCOME_VALUES, QUALITY_SUMMARIES } from "../constants.js";
import type { SqlExecutor } from "../executor.js";

// --- public shapes -----------------------------------------------------------

/** Neutral sort options only (docs/27 §5). No "most effective"/popularity/votes. */
export const SEARCH_SORTS = ["relevance", "newest", "oldest", "title"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Server-enforced page-size bounds (docs/27 §6). The catalogue is never bulk-sent. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 10_000; // guards against absurd OFFSETs
const MAX_QUERY_LEN = 200;
const MAX_FILTER_LEN = 128;

/** Validated, clamped filter set. Absent keys mean "not filtered". */
export interface SearchFilters {
  readonly studyType?: string; // study_type.code
  readonly evidenceLevel?: string; // evidence_level.code
  readonly outcome?: string; // outcome_value (reported outcome — never "effectiveness")
  readonly quality?: string; // quality_summary (methodological rigor, independent)
  readonly condition?: string; // condition.slug
  readonly intervention?: string; // intervention.slug
  readonly year?: number; // publication year
}

/** A fully validated query — safe to hand straight to `searchPublishedResearch`. */
export interface SearchQuery {
  /** Free-text query (trimmed, length-capped); '' when browsing. */
  readonly q: string;
  /** Canonical DOI when `q` is DOI-shaped — drives exact-match priority. */
  readonly doiExact: string | null;
  readonly filters: SearchFilters;
  readonly sort: SearchSort;
  readonly page: number; // 1-based, clamped
  readonly pageSize: number; // clamped to [1, MAX_PAGE_SIZE]
}

/** A single research card (docs/27 §7, docs/03 §6). Public/published fields only. */
export interface ResearchCard {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly year: number | null;
  readonly journalTitle: string | null;
  readonly studyTypeCode: string | null;
  readonly studyTypeLabel: string | null;
  readonly evidenceLevelLabel: string | null;
  /** Reported outcome (stored enum value). SEPARATE from quality. */
  readonly outcome: string | null;
  /** Methodological quality summary. SEPARATE from outcome. */
  readonly qualitySummary: string | null;
  readonly conditions: readonly string[];
  readonly interventions: readonly string[];
  readonly doi: string | null;
  readonly humanSummary: string | null;
  readonly isDemo: boolean;
}

export interface SearchResult {
  readonly items: readonly ResearchCard[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

// --- parameter validation ----------------------------------------------------

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function trimFilter(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;
  return t.slice(0, MAX_FILTER_LEN);
}

/**
 * Validate and clamp an untrusted query-parameter map into a `SearchQuery`
 * (docs/27 §9). Every field is bounded; unknown enum values are dropped;
 * pagination is clamped; sort falls back to a safe default. The result carries
 * only values fit to be bound as SQL parameters — no SQL is built here.
 */
export function parseSearchParams(raw: Record<string, string | undefined>): SearchQuery {
  const q = (raw.q ?? "").trim().slice(0, MAX_QUERY_LEN);
  const doiExact = q.length > 0 ? toCanonicalDoi(q) : null;

  // Enum filters are validated against the canonical vocabularies; anything
  // else is dropped (treated as "not filtered") rather than trusted or cast.
  const outcomeRaw = trimFilter(raw.outcome)?.toUpperCase();
  const outcome =
    outcomeRaw && (OUTCOME_VALUES as readonly string[]).includes(outcomeRaw)
      ? outcomeRaw
      : undefined;
  const qualityRaw = trimFilter(raw.quality)?.toUpperCase();
  const quality =
    qualityRaw && (QUALITY_SUMMARIES as readonly string[]).includes(qualityRaw)
      ? qualityRaw
      : undefined;

  // Taxonomy filters pass through as bound parameters; an unknown code/slug
  // simply matches no rows (correct "filtered to nothing" behaviour), and can
  // never inject because it is only ever a parameter.
  const studyType = trimFilter(raw.studyType);
  const evidenceLevel = trimFilter(raw.evidenceLevel);
  const condition = trimFilter(raw.condition)?.toLowerCase();
  const intervention = trimFilter(raw.intervention)?.toLowerCase();

  let year: number | undefined;
  if (raw.year !== undefined && raw.year.trim().length > 0) {
    const y = Number.parseInt(raw.year, 10);
    if (Number.isFinite(y) && y >= 1000 && y <= 3000) year = y;
  }

  const sortRaw = raw.sort as SearchSort | undefined;
  const sort: SearchSort =
    sortRaw && (SEARCH_SORTS as readonly string[]).includes(sortRaw)
      ? sortRaw
      : q.length > 0
        ? "relevance"
        : "newest";

  const page = clampInt(raw.page, 1, MAX_PAGE, 1);
  const pageSize = clampInt(raw.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);

  return {
    q,
    doiExact,
    filters: { studyType, evidenceLevel, outcome, quality, condition, intervention, year },
    sort,
    page,
    pageSize,
  };
}

// --- SQL builder -------------------------------------------------------------

/** Accumulates bound parameters and hands back their `$n` placeholders. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Build the shared WHERE fragment (published-only + DOI/FTS + filters) into the
 * given Params bag. Every dynamic value is a bound parameter; only fixed column
 * and table names are ever concatenated.
 */
function buildWhere(p: Params, query: SearchQuery): string {
  const clauses: string[] = ["s.publication_state = 'PUBLISHED'"];

  if (query.doiExact) {
    // Exact canonical-DOI match takes priority (docs/14 §4): when the query is
    // DOI-shaped we match the identifier exactly and skip full-text ranking.
    const doi = p.add(query.doiExact);
    clauses.push(
      `exists (select 1 from research_identifier ri
                where ri.type = 'DOI' and ri.value_canonical = ${doi}
                  and (ri.study_id = s.id or ri.publication_id = p.id))`,
    );
  } else if (query.q.length > 0) {
    // Full-text over title+abstract (the stored, GIN-indexed tsvector) OR a
    // bounded metadata substring match across authors/journal/condition/
    // intervention (docs/14 §3). All parameterised.
    const tsq = p.add(query.q);
    const like = p.add(`%${query.q}%`);
    clauses.push(
      `(
         p.search_vector @@ websearch_to_tsquery('english', ${tsq})
         or exists (select 1 from publication_author pa join author a on a.id = pa.author_id
                     where pa.publication_id = p.id and a.display_name ilike ${like})
         or exists (select 1 from journal j where j.id = p.journal_id and j.normalized_name ilike ${like})
         or exists (select 1 from study_condition sc join condition c on c.id = sc.condition_id
                     where sc.study_id = s.id and c.canonical_name ilike ${like})
         or exists (select 1 from study_intervention si join intervention iv on iv.id = si.intervention_id
                     where si.study_id = s.id and iv.canonical_name ilike ${like})
       )`,
    );
  }

  const f = query.filters;
  if (f.studyType !== undefined) {
    clauses.push(`st.code = ${p.add(f.studyType)}`);
  }
  if (f.evidenceLevel !== undefined) {
    clauses.push(`el.code = ${p.add(f.evidenceLevel)}`);
  }
  if (f.outcome !== undefined) {
    // classification.final_value is stored as text; compare as text (no enum
    // cast), so an unexpected value can only ever match nothing.
    clauses.push(
      `exists (select 1 from classification oc where oc.study_id = s.id
                and oc.dimension = 'OUTCOME' and oc.final_value = ${p.add(f.outcome)})`,
    );
  }
  if (f.quality !== undefined) {
    clauses.push(
      `exists (select 1 from classification qc where qc.study_id = s.id
                and qc.dimension = 'QUALITY' and qc.final_value = ${p.add(f.quality)})`,
    );
  }
  if (f.condition !== undefined) {
    clauses.push(
      `exists (select 1 from study_condition sc join condition c on c.id = sc.condition_id
                where sc.study_id = s.id and c.slug = ${p.add(f.condition)})`,
    );
  }
  if (f.intervention !== undefined) {
    clauses.push(
      `exists (select 1 from study_intervention si join intervention iv on iv.id = si.intervention_id
                where si.study_id = s.id and iv.slug = ${p.add(f.intervention)})`,
    );
  }
  if (f.year !== undefined) {
    clauses.push(`extract(year from p.publication_date)::int = ${p.add(f.year)}`);
  }

  return clauses.join("\n      and ");
}

/**
 * The shared FROM: one row per PUBLISHED study via its single primary
 * publication. Joining `is_primary = true` guarantees a study reported in
 * several publications yields exactly ONE card (docs/27 §7, Study != Publication).
 */
const FROM = `
  from research_study s
  join publication p on p.study_id = s.id and p.is_primary = true
  left join study_type st on st.id = s.study_type_id
  left join evidence_level el on el.id = st.evidence_level_id
  left join journal jn on jn.id = p.journal_id`;

function orderBy(sort: SearchSort, relevanceExpr: string): string {
  switch (sort) {
    case "newest":
      return "order by p.publication_date desc nulls last, s.created_at desc, s.id asc";
    case "oldest":
      return "order by p.publication_date asc nulls last, s.created_at asc, s.id asc";
    case "title":
      return "order by lower(s.canonical_title) asc, s.id asc";
    case "relevance":
    default:
      return `order by ${relevanceExpr} desc, p.publication_date desc nulls last, s.id asc`;
  }
}

interface CardRow {
  id: string;
  canonical_title: string;
  human_summary: string | null;
  is_demo: boolean;
  year: number | null;
  journal_title: string | null;
  study_type_code: string | null;
  study_type_label: string | null;
  evidence_level_label: string | null;
  outcome: string | null;
  quality_summary: string | null;
  doi: string | null;
  authors: string[] | null;
  conditions: string[] | null;
  interventions: string[] | null;
}

/**
 * Search / browse PUBLISHED research (docs/27). Returns one page of cards plus
 * the total count for pagination. Selects only card fields, aggregates
 * authors/conditions/interventions inside the single page query (no N+1), and
 * relies on the existing indexes (GIN FTS, FK indexes, publication_state).
 */
export async function searchPublishedResearch(
  db: SqlExecutor,
  query: SearchQuery,
): Promise<SearchResult> {
  // --- total count (same WHERE, no aggregation/order) ---
  const cp = new Params();
  const countWhere = buildWhere(cp, query);
  const countRes = await db.query<{ n: string }>(
    `select count(*)::text n ${FROM} where ${countWhere}`,
    cp.values,
  );
  const total = Number(countRes.rows[0]?.n ?? "0");

  const page = query.page;
  const pageSize = query.pageSize;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Out-of-range page → no items, but report the true total (docs/27 §6).
  if (total === 0 || offset >= total) {
    return { items: [], total, page, pageSize, totalPages };
  }

  // --- page of cards ---
  const pp = new Params();
  const relevanceExpr = query.doiExact
    ? "1"
    : query.q.length > 0
      ? `ts_rank(p.search_vector, websearch_to_tsquery('english', ${pp.add(query.q)}))`
      : "0";
  const where = buildWhere(pp, query);
  const limit = pp.add(pageSize);
  const off = pp.add(offset);

  const sql = `
    select s.id, s.canonical_title, s.human_summary, s.is_demo,
           extract(year from p.publication_date)::int as year,
           jn.normalized_name as journal_title,
           st.code  as study_type_code,
           st.label as study_type_label,
           el.label as evidence_level_label,
           (select oc.final_value from classification oc
              where oc.study_id = s.id and oc.dimension = 'OUTCOME') as outcome,
           (select qc.final_value from classification qc
              where qc.study_id = s.id and qc.dimension = 'QUALITY') as quality_summary,
           (select ri.value_canonical from research_identifier ri
              where ri.type = 'DOI' and (ri.publication_id = p.id or ri.study_id = s.id)
              order by ri.created_at asc limit 1) as doi,
           coalesce((select array_agg(a.display_name order by pa.author_order)
                       from publication_author pa join author a on a.id = pa.author_id
                      where pa.publication_id = p.id), '{}') as authors,
           coalesce((select array_agg(c.canonical_name order by c.canonical_name)
                       from study_condition sc join condition c on c.id = sc.condition_id
                      where sc.study_id = s.id), '{}') as conditions,
           coalesce((select array_agg(iv.canonical_name order by iv.canonical_name)
                       from study_intervention si join intervention iv on iv.id = si.intervention_id
                      where si.study_id = s.id), '{}') as interventions
    ${FROM}
    where ${where}
    ${orderBy(query.sort, relevanceExpr)}
    limit ${limit} offset ${off}`;

  const res = await db.query<CardRow>(sql, pp.values);
  const items: ResearchCard[] = res.rows.map((r) => ({
    id: r.id,
    title: r.canonical_title,
    authors: r.authors ?? [],
    year: r.year,
    journalTitle: r.journal_title,
    studyTypeCode: r.study_type_code,
    studyTypeLabel: r.study_type_label,
    evidenceLevelLabel: r.evidence_level_label,
    outcome: r.outcome,
    qualitySummary: r.quality_summary,
    conditions: r.conditions ?? [],
    interventions: r.interventions ?? [],
    doi: r.doi,
    humanSummary: r.human_summary,
    isDemo: r.is_demo,
  }));

  return { items, total, page, pageSize, totalPages };
}

// --- filter options (from canonical reference data, never hardcoded) ---------

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}
export interface FilterOptions {
  readonly studyTypes: readonly FilterOption[];
  readonly evidenceLevels: readonly FilterOption[];
  readonly conditions: readonly FilterOption[];
  readonly interventions: readonly FilterOption[];
  readonly outcomes: readonly FilterOption[];
  readonly qualities: readonly FilterOption[];
  readonly years: readonly number[];
}

/**
 * Load the filter dropdown options from canonical database taxonomy/reference
 * data (docs/27 §4) — NOT a hardcoded UI list. Outcome/quality vocabularies are
 * the fixed enum vocabularies (labelling stays a UI concern). Years are the
 * distinct publication years actually present in PUBLISHED research.
 */
export async function getFilterOptions(db: SqlExecutor): Promise<FilterOptions> {
  const studyTypes = (
    await db.query<{ code: string; label: string }>(
      "select code, label from study_type order by hierarchy_position asc nulls last, label asc",
    )
  ).rows.map((r) => ({ value: r.code, label: r.label }));

  const evidenceLevels = (
    await db.query<{ code: string; label: string }>(
      "select code, label from evidence_level order by pyramid_rank asc",
    )
  ).rows.map((r) => ({ value: r.code, label: r.label }));

  const conditions = (
    await db.query<{ slug: string; canonical_name: string }>(
      "select slug, canonical_name from condition order by canonical_name asc",
    )
  ).rows.map((r) => ({ value: r.slug, label: r.canonical_name }));

  const interventions = (
    await db.query<{ slug: string; canonical_name: string }>(
      "select slug, canonical_name from intervention order by canonical_name asc",
    )
  ).rows.map((r) => ({ value: r.slug, label: r.canonical_name }));

  const years = (
    await db.query<{ year: number }>(
      `select distinct extract(year from p.publication_date)::int as year
         from research_study s
         join publication p on p.study_id = s.id and p.is_primary = true
        where s.publication_state = 'PUBLISHED' and p.publication_date is not null
        order by year desc`,
    )
  ).rows.map((r) => r.year);

  return {
    studyTypes,
    evidenceLevels,
    conditions,
    interventions,
    outcomes: OUTCOME_VALUES.filter((v) => v !== "UNCLASSIFIED").map((v) => ({
      value: v,
      label: v,
    })),
    qualities: QUALITY_SUMMARIES.map((v) => ({ value: v, label: v })),
    years,
  };
}
