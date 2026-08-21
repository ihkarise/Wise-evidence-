import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/index.js';
import { getEvidenceLandscape, type EvidenceLandscape, type QueryExecutor } from './index.js';

const A1 = '00000000-0000-0000-0000-0000000000a1'; // seed reviewer (classification final_actor)

interface StudyOpts {
  title: string;
  studyType?: string | null;
  lifecycle?: string;
  pubState?: string;
  publications?: number; // number of publication rows (default 1)
  classifications?: Record<string, string>;
  criticism?: string; // category
}

async function insertStudy(exec: QueryExecutor, o: StudyOpts): Promise<string> {
  const s = await exec.query<{ id: string }>(
    `insert into research_study (canonical_title, study_type_code, lifecycle_state, is_demo)
     values ($1, $2, $3, false) returning id`,
    [o.title, o.studyType ?? null, o.lifecycle ?? 'PUBLISHED']
  );
  const studyId = s.rows[0]!.id;
  const nPubs = o.publications ?? 1;
  for (let i = 0; i < nPubs; i++) {
    await exec.query(
      `insert into publication (study_id, title, publication_state, is_primary)
       values ($1, $2, $3, $4)`,
      [studyId, `${o.title} (pub ${i + 1})`, o.pubState ?? 'PUBLISHED', i === 0]
    );
  }
  for (const [dim, val] of Object.entries(o.classifications ?? {})) {
    await exec.query(`insert into classification (study_id, dimension, value, final_actor) values ($1,$2,$3,$4)`, [studyId, dim, val, A1]);
  }
  if (o.criticism) {
    await exec.query(`insert into criticism (study_id, category, origin, body, actor) values ($1,$2,'REVIEWER_ASSESSED','note',$3)`, [studyId, o.criticism, A1]);
  }
  return studyId;
}

let db: TestDatabase;
let land: EvidenceLandscape;
let multiId: string;

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  await db.asRolePersistent('service_role', null, async (exec) => {
    // Positive + LOW quality + criticism (proves positive can be low-quality & criticized).
    await insertStudy(exec, {
      title: 'L strong positive rct',
      studyType: 'RCT',
      classifications: { OUTCOME: 'STRONG_POSITIVE', EVIDENCE_LEVEL: 'RCT', QUALITY: 'INADEQUATE' },
      criticism: 'SAMPLE_SIZE',
    });
    // One study, three publications, unique evidence level CONTROLLED_TRIAL.
    multiId = await insertStudy(exec, {
      title: 'L multi publication study',
      studyType: 'CONTROLLED_TRIAL',
      publications: 3,
      classifications: { OUTCOME: 'POSITIVE', EVIDENCE_LEVEL: 'CONTROLLED_TRIAL' },
    });
    // Negative + HIGH quality (proves negative can be high-quality).
    await insertStudy(exec, {
      title: 'L negative high quality',
      studyType: 'RCT',
      classifications: { OUTCOME: 'NEGATIVE', QUALITY: 'ADEQUATE' },
    });
    // Published but no OUTCOME classification → UNCLASSIFIED outcome.
    await insertStudy(exec, { title: 'L unclassified outcome', studyType: 'RCT', classifications: { EVIDENCE_LEVEL: 'RCT' } });
    // Published but no EVIDENCE_LEVEL → UNCLASSIFIED evidence level.
    await insertStudy(exec, { title: 'L unclassified level', studyType: 'RCT', classifications: { OUTCOME: 'NEUTRAL_INCONCLUSIVE' } });

    // Excluded records carrying otherwise-unique outcomes (must NOT appear):
    await insertStudy(exec, { title: 'L draft', lifecycle: 'PENDING_REVIEW', pubState: 'DRAFT', classifications: { OUTCOME: 'STRONG_NEGATIVE' } });
    await insertStudy(exec, { title: 'L archived', lifecycle: 'ARCHIVED', pubState: 'ARCHIVED', classifications: { OUTCOME: 'STRONG_NEGATIVE' } });
    await insertStudy(exec, { title: 'L rejected', lifecycle: 'REJECTED', pubState: 'REJECTED', classifications: { OUTCOME: 'LEANING_NEGATIVE' } });
  });
  land = await db.asRole('anon', null, (exec) => getEvidenceLandscape(exec));
});
afterAll(async () => {
  await db.close();
});

const outcome = (v: string) => land.outcomeDistribution.find((o) => o.value === v)?.studies ?? -1;
const quality = (v: string) => land.qualityDistribution.find((o) => o.value === v)?.studies ?? -1;
const level = (code: string) => land.byEvidenceLevel.find((l) => l.code === code)?.studies ?? -1;

describe('getEvidenceLandscape — study-based counting', () => {
  it('counts one study with three publications as ONE study', async () => {
    // Unique evidence level CONTROLLED_TRIAL is used only by the multi-pub study.
    expect(level('CONTROLLED_TRIAL')).toBe(1);
  });

  it('reports the three publications separately (not as studies)', async () => {
    const pubs = await db.asRole('anon', null, (exec) =>
      exec.query<{ n: string }>('select count(*)::text n from publication where study_id = $1', [multiId])
    );
    expect(Number(pubs.rows[0]!.n)).toBe(3);
    expect(land.totalPublications).toBeGreaterThan(land.totalStudies);
  });
});

describe('getEvidenceLandscape — public boundary (anon RLS)', () => {
  it('excludes draft and archived studies (STRONG_NEGATIVE only exists on excluded records)', () => {
    expect(outcome('STRONG_NEGATIVE')).toBe(0);
  });
  it('excludes rejected studies (LEANING_NEGATIVE only exists on an excluded record)', () => {
    expect(outcome('LEANING_NEGATIVE')).toBe(0);
  });
});

describe('getEvidenceLandscape — outcome distribution', () => {
  it('represents all seven documented categories', () => {
    expect(land.outcomeDistribution.map((o) => o.value)).toEqual([
      'STRONG_POSITIVE', 'POSITIVE', 'LEANING_POSITIVE', 'NEUTRAL_INCONCLUSIVE', 'LEANING_NEGATIVE', 'NEGATIVE', 'STRONG_NEGATIVE',
    ]);
    expect(outcome('STRONG_POSITIVE')).toBeGreaterThanOrEqual(1);
  });
  it('surfaces UNCLASSIFIED outcome and never maps missing to neutral', () => {
    expect(land.unclassifiedOutcome).toBeGreaterThanOrEqual(1);
  });
});

describe('getEvidenceLandscape — quality is independent of outcome', () => {
  it('a positive study can be low quality and a negative study high quality', () => {
    expect(quality('INADEQUATE')).toBeGreaterThanOrEqual(1); // from the STRONG_POSITIVE study
    expect(quality('ADEQUATE')).toBeGreaterThanOrEqual(1); // from the NEGATIVE study
    // Adding quality did not change outcome counts.
    expect(outcome('STRONG_POSITIVE')).toBeGreaterThanOrEqual(1);
    expect(outcome('NEGATIVE')).toBeGreaterThanOrEqual(1);
  });
});

describe('getEvidenceLandscape — criticism is independent of outcome', () => {
  it('a positive study can carry criticism without affecting outcome counts', () => {
    const sampleSize = land.criticismByCategory.find((c) => c.category === 'SAMPLE_SIZE');
    expect(sampleSize?.studies ?? 0).toBeGreaterThanOrEqual(1);
    expect(outcome('STRONG_POSITIVE')).toBeGreaterThanOrEqual(1); // still positive
  });
});

describe('getEvidenceLandscape — evidence level', () => {
  it('surfaces an Unclassified evidence-level count', () => {
    expect(land.unclassifiedEvidenceLevel).toBeGreaterThanOrEqual(1);
  });
  it('orders levels by pyramid rank (navigation ordering, not truth)', () => {
    const ranks = land.byEvidenceLevel.map((l) => l.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
  it('evidence level does not alter outcome classification', () => {
    // The multi-pub study is CONTROLLED_TRIAL and POSITIVE; both hold independently.
    expect(level('CONTROLLED_TRIAL')).toBe(1);
    expect(outcome('POSITIVE')).toBeGreaterThanOrEqual(1);
  });
});

describe('getEvidenceLandscape — no efficacy/aggregation', () => {
  it('exposes no positive/negative balance or efficacy score', () => {
    const keys = Object.keys(land).join(' ').toLowerCase();
    expect(keys).not.toMatch(/efficac|balance|score|weight|net/);
  });
});
