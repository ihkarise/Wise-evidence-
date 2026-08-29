/**
 * Evidence-visualization aggregation layer (docs/28, docs/06–09 — Milestone 5).
 *
 * A server-side, PostgreSQL-only layer that produces DESCRIPTIVE COUNTS of the
 * PUBLISHED catalogue for the `/evidence` and `/statistics` pages. It runs on the
 * same narrow `SqlExecutor` boundary the rest of the service layer uses and holds
 * NO authorization of its own: on the public web path it is called with the ANON
 * executor, so Row-Level Security is the authoritative gate (only PUBLISHED
 * studies and their published children, only human-reviewed classifications, only
 * ACTIVE criticism are visible). As a second, belt-and-braces guarantee — so each
 * function is correct under ANY executor role, including a privileged one in
 * tests — every query ALSO filters `publication_state = 'PUBLISHED'` explicitly.
 *
 * Non-negotiable methodology (docs/28 §1, ADR-016):
 *   - `ResearchStudy` is the ONLY counting unit. Every count is
 *     `count(distinct research_study.id)`; a study reported in several
 *     publications counts ONCE. Publication joins never inflate a study count.
 *   - The evidence pyramid is a NAVIGATION/ORGANIZATION device. Band membership
 *     is derived only from `study_type → evidence_level` and ordered by the
 *     taxonomy's `pyramid_rank`. Position encodes nothing about outcome, quality,
 *     criticism, truth, efficacy, or superiority. Outcome is NEVER folded into a
 *     band, and studies are NEVER weighted by their outcome.
 *   - Outcome, quality, and criticism are SEPARATE distributions on separate
 *     axes. There is NO cross-tabulation and NO combined/efficacy/balance/
 *     positive-minus-negative/weighted score of any kind, anywhere.
 *   - Missing data is explicit: a published study with no visible human-reviewed
 *     value is counted as UNCLASSIFIED / UNASSESSED, never silently mapped to a
 *     neutral or any scientific value.
 *   - Criticism is counted by DISTINCT STUDY, never by row (so one heavily
 *     annotated study cannot dominate), and is never converted into a negative
 *     outcome.
 *
 * Framework-independent: imports only local constants; no Astro/React/Supabase/AI.
 */
import {
  OUTCOME_VALUES,
  QUALITY_SUMMARIES,
  CRITICISM_CATEGORIES,
  CRITICISM_ORIGINS,
} from "./constants.js";
import type { SqlExecutor } from "./executor.js";

// --- public shapes -----------------------------------------------------------

/**
 * Sentinel bucket keys for "no visible human-reviewed value". These are NOT
 * scientific categories — they mean "not yet assessed" (docs/28 §1.8–1.9). They
 * are distinct from any stored enum value so the UI can style them apart.
 */
export const OUTCOME_UNCLASSIFIED = "UNCLASSIFIED" as const;
export const QUALITY_UNASSESSED = "UNASSESSED" as const;
export const EVIDENCE_UNCLASSIFIED = "UNCLASSIFIED" as const;

/** A single descriptive count. `studyCount` is always a distinct-study count. */
export interface CountBucket {
  readonly value: string;
  readonly studyCount: number;
}

/** One evidence-pyramid band. `rank` is the taxonomy pyramid_rank (navigation
 * ordering only, never certainty); the synthetic UNCLASSIFIED band has rank null. */
export interface EvidenceBand {
  readonly code: string;
  readonly label: string;
  readonly rank: number | null;
  readonly studyCount: number;
  /** True for the synthetic band of published studies with no assigned study type. */
  readonly isUnclassified: boolean;
}

/** A distribution plus its published-study denominator. Buckets sum to `total`. */
export interface DistributionResult {
  readonly buckets: readonly CountBucket[];
  readonly total: number;
}

/** Criticism shown on TWO independent axes (category, origin) — never crossed
 * with outcome, and counted by distinct study (docs/28 §1.10–1.11). */
export interface CriticismDistribution {
  readonly byCategory: readonly CountBucket[];
  readonly byOrigin: readonly CountBucket[];
  readonly studiesWithCriticism: number;
  readonly studiesWithNoCriticism: number;
  readonly total: number;
}

/** Headline counts: N studies across M publications (docs/28 §1.5). The two are
 * shown separately and a publication count is NEVER used as an evidence metric. */
export interface CatalogueOverview {
  readonly publishedStudies: number;
  readonly publishedPublications: number;
}

// --- helpers -----------------------------------------------------------------

/** The published-study base predicate: RLS is authoritative, this is defense in
 * depth so the functions are correct under any executor role (docs/28 §1.16). */
const PUBLISHED = "s.publication_state = 'PUBLISHED'";

async function scalar(db: SqlExecutor, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? "0");
}

/**
 * Zero-fill a set of `{value → count}` rows against a fixed, ordered vocabulary,
 * then append an explicit "missing" bucket for rows whose value is null/absent.
 * Guarantees every documented category appears (even at 0) and that the buckets
 * sum to the number of distinct studies (docs/28 §1.7–1.9).
 */
function zeroFill(
  order: readonly string[],
  rows: readonly { value: string | null; n: string }[],
  missingKey: string,
): CountBucket[] {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const r of rows) {
    if (r.value === null || r.value === missingKey || !order.includes(r.value)) {
      // A null final_value (unreviewed / RLS-hidden), an explicit UNCLASSIFIED
      // enum, or any value outside the documented vocabulary => "missing".
      missing += Number(r.n);
    } else {
      counts.set(r.value, (counts.get(r.value) ?? 0) + Number(r.n));
    }
  }
  const buckets = order.map((value) => ({ value, studyCount: counts.get(value) ?? 0 }));
  buckets.push({ value: missingKey, studyCount: missing });
  return buckets;
}

// --- catalogue overview ------------------------------------------------------

/**
 * The headline "N published studies across M published publications". The two
 * counts are independent: publications are counted for descriptive context only
 * and never used as an evidence metric (docs/28 §1.5).
 */
export async function getCatalogueOverview(db: SqlExecutor): Promise<CatalogueOverview> {
  const publishedStudies = await scalar(
    db,
    `select count(*)::text n from research_study s where ${PUBLISHED}`,
  );
  const publishedPublications = await scalar(
    db,
    `select count(*)::text n
       from publication p
       join research_study s on s.id = p.study_id
      where ${PUBLISHED}`,
  );
  return { publishedStudies, publishedPublications };
}

// --- evidence pyramid --------------------------------------------------------

/**
 * The evidence pyramid as a count of distinct PUBLISHED studies per evidence
 * band, ordered by the taxonomy `pyramid_rank` (navigation ordering only).
 *
 * All taxonomy bands are returned even at count 0 (zero-fill via the left join
 * from `evidence_level`), and a synthetic UNCLASSIFIED band collects published
 * studies that have no assigned study type (and thus no evidence level) — those
 * are never silently discarded (docs/28 §1.1, §5). `count(distinct s.id)`
 * collapses the several study types that share one band (e.g. the three
 * OBSERVATIONAL types) and guarantees each study is counted once.
 */
export async function getEvidencePyramid(db: SqlExecutor): Promise<EvidenceBand[]> {
  const banded = await db.query<{ code: string; label: string; rank: number; n: string }>(
    `select el.code, el.label, el.pyramid_rank as rank,
            count(distinct s.id)::text as n
       from evidence_level el
       left join study_type st on st.evidence_level_id = el.id
       left join research_study s on s.study_type_id = st.id and ${PUBLISHED}
      group by el.code, el.label, el.pyramid_rank
      order by el.pyramid_rank asc`,
  );

  const unclassified = await scalar(
    db,
    `select count(distinct s.id)::text n
       from research_study s
       left join study_type st on st.id = s.study_type_id
      where ${PUBLISHED}
        and (s.study_type_id is null or st.evidence_level_id is null)`,
  );

  const bands: EvidenceBand[] = banded.rows.map((r) => ({
    code: r.code,
    label: r.label,
    rank: r.rank,
    studyCount: Number(r.n),
    isUnclassified: false,
  }));
  bands.push({
    code: EVIDENCE_UNCLASSIFIED,
    label: "Unclassified",
    rank: null,
    studyCount: unclassified,
    isUnclassified: true,
  });
  return bands;
}

// --- outcome distribution ----------------------------------------------------

/**
 * Reported-outcome distribution: distinct PUBLISHED studies grouped by their
 * human-reviewed OUTCOME final value, across the full seven-category spectrum
 * (zero-filled, canonical order) plus an explicit UNCLASSIFIED bucket for studies
 * with no visible human-reviewed outcome.
 *
 * On the anon path, RLS already hides classification rows whose `final_value is
 * null` (docs/16, migration 0008), so an AI-only suggestion never enters a real
 * category — it lands in UNCLASSIFIED. A `left join` (not inner) means a study
 * with NO outcome row is also counted as UNCLASSIFIED, so the buckets always sum
 * to the published-study total. Classification is unique per (study, dimension),
 * so the join adds at most one row per study — no inflation (docs/28 §1.6–1.8).
 *
 * This is a set of parallel, independent counts. It is NEVER summed, netted,
 * balanced, or reduced to a single figure.
 */
export async function getOutcomeDistribution(db: SqlExecutor): Promise<DistributionResult> {
  const total = await scalar(
    db,
    `select count(*)::text n from research_study s where ${PUBLISHED}`,
  );
  const rows = await db.query<{ value: string | null; n: string }>(
    `select oc.final_value as value, count(distinct s.id)::text as n
       from research_study s
       left join classification oc on oc.study_id = s.id and oc.dimension = 'OUTCOME'
      where ${PUBLISHED}
      group by oc.final_value`,
  );
  // Canonical spectrum order; OUTCOME_VALUES already ends with UNCLASSIFIED.
  const spectrum = OUTCOME_VALUES.filter((v) => v !== OUTCOME_UNCLASSIFIED);
  const buckets = zeroFill(spectrum, rows.rows, OUTCOME_UNCLASSIFIED);
  return { buckets, total };
}

// --- quality distribution ----------------------------------------------------

/**
 * Evidence-quality distribution: distinct PUBLISHED studies grouped by their
 * human-reviewed coarse QUALITY summary (HIGH | MODERATE | LOW | UNCLEAR;
 * docs/08 §4), zero-filled, plus an explicit UNASSESSED bucket. Entirely
 * independent of outcome — a positive study is not automatically high quality
 * and this function never reads or combines the outcome dimension (docs/28 §1.9).
 */
export async function getQualityDistribution(db: SqlExecutor): Promise<DistributionResult> {
  const total = await scalar(
    db,
    `select count(*)::text n from research_study s where ${PUBLISHED}`,
  );
  const rows = await db.query<{ value: string | null; n: string }>(
    `select qc.final_value as value, count(distinct s.id)::text as n
       from research_study s
       left join classification qc on qc.study_id = s.id and qc.dimension = 'QUALITY'
      where ${PUBLISHED}
      group by qc.final_value`,
  );
  const buckets = zeroFill(QUALITY_SUMMARIES, rows.rows, QUALITY_UNASSESSED);
  return { buckets, total };
}

// --- criticism distribution --------------------------------------------------

/**
 * Criticism distribution on TWO independent axes — by category and by origin —
 * each counting DISTINCT PUBLISHED studies that carry at least one ACTIVE
 * criticism in that bucket. Counting studies (not criticism rows) means a study
 * with several criticisms in one bucket is counted once and cannot skew the
 * picture (docs/28 §1.10). Only ACTIVE criticism on published research is visible
 * (withdrawn/superseded is retained but not shown; RLS enforces this too).
 *
 * Criticism lives entirely on its own axis: it is never converted into a negative
 * outcome, never crossed with the outcome distribution, and never scored
 * (docs/28 §1.11). A "studies with no criticism" figure is returned for honest
 * context.
 */
export async function getCriticismDistribution(db: SqlExecutor): Promise<CriticismDistribution> {
  const total = await scalar(
    db,
    `select count(*)::text n from research_study s where ${PUBLISHED}`,
  );

  // A criticism belongs to a study directly (study_id) or via one of the study's
  // publications (publication_id); either attributes it to the one study.
  const activeCriticismJoin = `
    join criticism cr
      on cr.status = 'ACTIVE'
     and (
       cr.study_id = s.id
       or cr.publication_id in (select p.id from publication p where p.study_id = s.id)
     )`;

  const byCategoryRows = await db.query<{ value: string; n: string }>(
    `select cr.category as value, count(distinct s.id)::text as n
       from research_study s ${activeCriticismJoin}
      where ${PUBLISHED}
      group by cr.category`,
  );
  const byOriginRows = await db.query<{ value: string; n: string }>(
    `select cr.origin as value, count(distinct s.id)::text as n
       from research_study s ${activeCriticismJoin}
      where ${PUBLISHED}
      group by cr.origin`,
  );

  const studiesWithCriticism = await scalar(
    db,
    `select count(distinct s.id)::text n
       from research_study s ${activeCriticismJoin}
      where ${PUBLISHED}`,
  );

  // Zero-fill against the fixed vocabularies; there is no "missing" bucket for
  // criticism (a study simply may have none — reported separately below).
  const byCategory = CRITICISM_CATEGORIES.map((value) => ({
    value,
    studyCount: Number(byCategoryRows.rows.find((r) => r.value === value)?.n ?? "0"),
  }));
  const byOrigin = CRITICISM_ORIGINS.map((value) => ({
    value,
    studyCount: Number(byOriginRows.rows.find((r) => r.value === value)?.n ?? "0"),
  }));

  return {
    byCategory,
    byOrigin,
    studiesWithCriticism,
    studiesWithNoCriticism: total - studiesWithCriticism,
    total,
  };
}
