import type { QueryExecutor } from './db.js';

/**
 * Evidence-landscape aggregation for /evidence and /statistics (docs/24, ADR-015).
 *
 * The unit of analysis is the ResearchStudy: study counts use
 * count(distinct research_study.id) / count(distinct classification.study_id) —
 * NEVER row counts after joining publication, so a study with three publications
 * contributes ONE study (and three publications, counted separately). All queries
 * run under the anon RLS role → PUBLISHED studies only. No efficacy score, no
 * positive/negative balance, no weighting: these are frequency distributions.
 */

export interface LevelCount {
  code: string;
  label: string;
  rank: number;
  studies: number;
}
export interface StudyTypeCount {
  code: string;
  label: string;
  studies: number;
}
export interface ValueCount {
  value: string;
  studies: number;
}
export interface CriticismCount {
  category: string;
  studies: number;
}

export interface EvidenceLandscape {
  totalStudies: number;
  totalPublications: number;
  byEvidenceLevel: LevelCount[]; // ordered by pyramid rank
  unclassifiedEvidenceLevel: number;
  byStudyType: StudyTypeCount[];
  unclassifiedStudyType: number;
  outcomeDistribution: ValueCount[]; // all seven categories, in spectrum order
  unclassifiedOutcome: number;
  qualityDistribution: ValueCount[]; // all four categories
  unclassifiedQuality: number;
  criticismByCategory: CriticismCount[];
}

const OUTCOME_ORDER = [
  'STRONG_POSITIVE',
  'POSITIVE',
  'LEANING_POSITIVE',
  'NEUTRAL_INCONCLUSIVE',
  'LEANING_NEGATIVE',
  'NEGATIVE',
  'STRONG_NEGATIVE',
];
const QUALITY_ORDER = ['ADEQUATE', 'UNCLEAR', 'INADEQUATE', 'NOT_APPLICABLE'];

async function scalar(exec: QueryExecutor, sql: string): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(sql);
  return rows[0]?.n ?? 0;
}

/** Compute the full published-research landscape (study-based). */
export async function getEvidenceLandscape(exec: QueryExecutor): Promise<EvidenceLandscape> {
  const totalStudies = await scalar(exec, `select count(distinct id)::int as n from research_study`);
  const totalPublications = await scalar(exec, `select count(*)::int as n from publication`);

  // Evidence level — one classification row per (study, dimension); count distinct studies.
  const levels = await exec.query<{ code: string; label: string; rank: number; studies: number }>(
    `select el.code, el.label, el.pyramid_rank as rank,
            count(distinct c.study_id)::int as studies
       from evidence_level el
       left join classification c
         on c.dimension = 'EVIDENCE_LEVEL' and c.value = el.code
      group by el.code, el.label, el.pyramid_rank
      order by el.pyramid_rank`
  );
  const studiesWithLevel = await scalar(
    exec,
    `select count(distinct study_id)::int as n from classification where dimension = 'EVIDENCE_LEVEL'`
  );

  // Study type facet (separate from evidence level).
  const studyTypes = await exec.query<{ code: string; label: string; studies: number }>(
    `select st.code, st.label, count(distinct s.id)::int as studies
       from study_type st
       left join research_study s on s.study_type_code = st.code
      group by st.code, st.label, st.hierarchy_position
      order by st.hierarchy_position`
  );
  const studiesWithType = await scalar(
    exec,
    `select count(distinct id)::int as n from research_study where study_type_code is not null`
  );

  // Outcome distribution (study-based). Missing → UNCLASSIFIED, never neutral.
  const outcomeRows = await exec.query<{ value: string; studies: number }>(
    `select value, count(distinct study_id)::int as studies
       from classification where dimension = 'OUTCOME' group by value`
  );
  const outcomeMap = new Map(outcomeRows.rows.map((r) => [r.value, r.studies]));
  const outcomeDistribution = OUTCOME_ORDER.map((value) => ({ value, studies: outcomeMap.get(value) ?? 0 }));
  const studiesWithOutcome = outcomeDistribution.reduce((a, b) => a + b.studies, 0);

  // Quality distribution (independent of outcome).
  const qualityRows = await exec.query<{ value: string; studies: number }>(
    `select value, count(distinct study_id)::int as studies
       from classification where dimension = 'QUALITY' group by value`
  );
  const qualityMap = new Map(qualityRows.rows.map((r) => [r.value, r.studies]));
  const qualityDistribution = QUALITY_ORDER.map((value) => ({ value, studies: qualityMap.get(value) ?? 0 }));
  const studiesWithQuality = qualityDistribution.reduce((a, b) => a + b.studies, 0);

  // Criticism distribution (independent of outcome): studies flagged, by category.
  const criticism = await exec.query<{ category: string; studies: number }>(
    `select category, count(distinct study_id)::int as studies
       from criticism where status = 'active'
      group by category order by studies desc, category`
  );

  return {
    totalStudies,
    totalPublications,
    byEvidenceLevel: levels.rows,
    unclassifiedEvidenceLevel: Math.max(0, totalStudies - studiesWithLevel),
    byStudyType: studyTypes.rows,
    unclassifiedStudyType: Math.max(0, totalStudies - studiesWithType),
    outcomeDistribution,
    unclassifiedOutcome: Math.max(0, totalStudies - studiesWithOutcome),
    qualityDistribution,
    unclassifiedQuality: Math.max(0, totalStudies - studiesWithQuality),
    criticismByCategory: criticism.rows,
  };
}
