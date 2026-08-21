import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/index.js';
import { findStudyByDoi, listPublishedPublications } from './repositories.js';

const S1 = '00000000-0000-0000-0000-000000001001'; // positive, published (+ criticism)
const S7 = '00000000-0000-0000-0000-000000001007'; // multi-publication
const S8 = '00000000-0000-0000-0000-000000001008'; // AI-overridden
const S10 = '00000000-0000-0000-0000-000000001010'; // draft
const REVIEWER = '00000000-0000-0000-0000-0000000000a1';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
});
afterAll(async () => {
  await db.close();
});

describe('connection & migrations', () => {
  it('applies all migrations and seeds reference taxonomy', async () => {
    const st = await db.query<{ n: string }>('select count(*)::text n from study_type');
    expect(Number(st.rows[0]!.n)).toBe(13);
    const el = await db.query<{ n: string }>('select count(*)::text n from evidence_level');
    expect(Number(el.rows[0]!.n)).toBe(10);
  });
});

describe('research study & publication (Study != Publication)', () => {
  it('creates a study with a primary publication and reads the relationship', async () => {
    const study = await db.query<{ id: string }>(
      `insert into research_study (canonical_title, study_type_code, lifecycle_state)
       values ('created-in-test', 'RCT', 'DISCOVERED') returning id`
    );
    const studyId = study.rows[0]!.id;
    const pub = await db.query<{ id: string; study_id: string }>(
      `insert into publication (study_id, title, publication_state, is_primary)
       values ($1, 'Created In Test', 'DRAFT', true) returning id, study_id`,
      [studyId]
    );
    expect(pub.rows[0]!.study_id).toBe(studyId);
  });

  it('supports multiple publications for one study', async () => {
    const pubs = await db.query<{ n: string }>(
      'select count(*)::text n from publication where study_id = $1',
      [S7]
    );
    expect(Number(pubs.rows[0]!.n)).toBe(2);
  });

  it('links ordered authors to a publication', async () => {
    const authors = await db.query<{ author_position: number }>(
      `select author_position from publication_author
       where publication_id = '00000000-0000-0000-0000-000000002001'
       order by author_position`
    );
    expect(authors.rows.map((r) => r.author_position)).toEqual([1, 2]);
  });

  it('links conditions and interventions at the study level', async () => {
    const cond = await db.query<{ slug: string }>(
      `select c.slug from study_condition sc join condition c on c.id = sc.condition_id where sc.study_id = $1`,
      [S1]
    );
    expect(cond.rows.map((r) => r.slug)).toContain('allergic-rhinitis');
    const iv = await db.query<{ slug: string }>(
      `select i.slug from study_intervention si join intervention i on i.id = si.intervention_id where si.study_id = $1`,
      [S1]
    );
    expect(iv.rows.map((r) => r.slug)).toContain('individualized-homeopathy');
  });
});

describe('classification storage & separation of dimensions', () => {
  it('stores outcome, quality, and confidence as SEPARATE rows', async () => {
    const rows = await db.query<{ dimension: string; value: string }>(
      `select dimension, value from classification where study_id = $1 order by dimension`,
      [S1]
    );
    const map = Object.fromEntries(rows.rows.map((r) => [r.dimension, r.value]));
    expect(map.OUTCOME).toBe('POSITIVE');
    expect(map.QUALITY).toBe('ADEQUATE');
    expect(map.CONFIDENCE).toBe('MODERATE');
  });

  it('rejects an invalid outcome value via the check constraint', async () => {
    await expect(
      db.query(
        `insert into classification (study_id, dimension, value, final_actor)
         values ($1, 'OUTCOME', 'BOGUS', $2)`,
        [S7, REVIEWER]
      )
    ).rejects.toThrow();
  });

  it('every classification is a human final (final_actor never null)', async () => {
    const nulls = await db.query<{ n: string }>(
      'select count(*)::text n from classification where final_actor is null'
    );
    expect(Number(nulls.rows[0]!.n)).toBe(0);
  });
});

describe('AI suggestion vs human final classification', () => {
  it('preserves BOTH the AI suggestion and the diverging human final value', async () => {
    const ai = await db.query<{ suggested_value: string }>(
      `select r.suggested_value
         from ai_result r join ai_job j on j.id = r.job_id
        where j.study_id = $1`,
      [S8]
    );
    expect(ai.rows[0]!.suggested_value).toBe('POSITIVE'); // AI suggested POSITIVE

    const human = await db.query<{ value: string; ai_result_id: string | null; final_reason: string | null }>(
      `select value, ai_result_id, final_reason from classification
        where study_id = $1 and dimension = 'OUTCOME'`,
      [S8]
    );
    expect(human.rows[0]!.value).toBe('LEANING_POSITIVE'); // human overrode
    expect(human.rows[0]!.ai_result_id).not.toBeNull(); // links to the AI result
    expect(human.rows[0]!.final_reason).toBeTruthy(); // reason recorded
  });
});

describe('criticism is separate from outcome', () => {
  it('a POSITIVE study can carry criticism without changing its outcome', async () => {
    const crit = await db.query<{ category: string; origin: string }>(
      `select category, origin from criticism where study_id = $1`,
      [S1]
    );
    expect(crit.rows[0]!.category).toBe('SAMPLE_SIZE');
    expect(crit.rows[0]!.origin).toBe('AUTHOR_REPORTED');
    const outcome = await db.query<{ value: string }>(
      `select value from classification where study_id = $1 and dimension = 'OUTCOME'`,
      [S1]
    );
    expect(outcome.rows[0]!.value).toBe('POSITIVE');
  });
});

describe('identifiers, DOI uniqueness & dedup support', () => {
  it('enforces unique (id_type, value_canonical)', async () => {
    await expect(
      db.query(
        `insert into research_identifier (publication_id, id_type, value_raw, value_canonical)
         values ('00000000-0000-0000-0000-000000002002', 'DOI', 'dup', '10.5555/demo.0001')`
      )
    ).rejects.toThrow();
  });

  it('finds a study by DOI in any form via the data-access helper', async () => {
    const found = await findStudyByDoi(db, 'https://doi.org/10.5555/DEMO.0001');
    expect(found?.id).toBe(S1);
    expect(await findStudyByDoi(db, 'not-a-doi')).toBeNull();
  });

  it('missing-DOI study has no DOI identifier (scenario 5)', async () => {
    const dois = await db.query<{ n: string }>(
      `select count(*)::text n from research_identifier i
        join publication p on p.id = i.publication_id
       where p.study_id = '00000000-0000-0000-0000-000000001005' and i.id_type = 'DOI'`
    );
    expect(Number(dois.rows[0]!.n)).toBe(0);
  });
});

describe('duplicate candidate is reviewable, never auto-deleted', () => {
  it('keeps both the candidate and the referenced original', async () => {
    const cand = await db.query<{ state: string; duplicate_of_study_id: string }>(
      `select state, duplicate_of_study_id from import_candidate where duplicate_of_study_id = $1`,
      [S1]
    );
    expect(cand.rows[0]!.state).toBe('DUPLICATE_CANDIDATE');
    // The referenced original study still exists (not deleted).
    const orig = await db.query<{ n: string }>(
      'select count(*)::text n from research_study where id = $1',
      [S1]
    );
    expect(Number(orig.rows[0]!.n)).toBe(1);
  });
});

describe('publication state & public read helper', () => {
  it('draft study/publication exists but is not PUBLISHED', async () => {
    const s = await db.query<{ lifecycle_state: string }>(
      'select lifecycle_state from research_study where id = $1',
      [S10]
    );
    expect(s.rows[0]!.lifecycle_state).toBe('PENDING_REVIEW');
  });

  it('listPublishedPublications returns only PUBLISHED rows', async () => {
    const pubs = await listPublishedPublications(db);
    expect(pubs.length).toBeGreaterThan(0);
    expect(pubs.every((p) => p.publication_state === 'PUBLISHED')).toBe(true);
  });
});

describe('audit log', () => {
  it('records actor/action/entity/before/after', async () => {
    await db.query(
      `insert into audit_log (actor, action, entity, entity_id, field, before_value, after_value)
       values ($1, 'UPDATE', 'classification', $2, 'value', 'POSITIVE', 'LEANING_POSITIVE')`,
      [REVIEWER, S8]
    );
    const row = await db.query<{ action: string; before_value: string; after_value: string }>(
      `select action, before_value, after_value from audit_log where entity_id = $1 order by created_at desc limit 1`,
      [S8]
    );
    expect(row.rows[0]!.action).toBe('UPDATE');
    expect(row.rows[0]!.before_value).toBe('POSITIVE');
    expect(row.rows[0]!.after_value).toBe('LEANING_POSITIVE');
  });
});

describe('demo data is clearly marked', () => {
  it('all fixture studies carry is_demo = true', async () => {
    const notDemo = await db.query<{ n: string }>(
      "select count(*)::text n from research_study where is_demo = false and canonical_title like '[demo]%'"
    );
    expect(Number(notDemo.rows[0]!.n)).toBe(0);
    const demo = await db.query<{ n: string }>(
      'select count(*)::text n from research_study where is_demo = true'
    );
    expect(Number(demo.rows[0]!.n)).toBeGreaterThanOrEqual(9);
  });
});
