import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/index.js';
import {
  searchPublishedResearch,
  getPublishedResearchFacets,
  normalizeExplorerParams,
  type QueryExecutor,
} from './index.js';

const A1 = '00000000-0000-0000-0000-0000000000a1'; // seed reviewer (classification final_actor)
const C_ASTHMA = '00000000-0000-0000-0000-0000000000c2';
const C_MIGRAINE = '00000000-0000-0000-0000-0000000000c3';
const E_INDIV = '00000000-0000-0000-0000-0000000000e1';
const E_ARNICA = '00000000-0000-0000-0000-0000000000e2';

interface StudyOpts {
  title: string;
  studyType: string;
  lifecycle?: string;
  pubState?: string;
  date?: string | null;
  doi?: string;
  author?: string;
  classifications?: Record<string, string>;
  conditions?: string[];
  interventions?: string[];
}

async function insertStudy(exec: QueryExecutor, o: StudyOpts): Promise<string> {
  const s = await exec.query<{ id: string }>(
    `insert into research_study (canonical_title, study_type_code, lifecycle_state, is_demo)
     values ($1, $2, $3, false) returning id`,
    [o.title, o.studyType, o.lifecycle ?? 'PUBLISHED']
  );
  const studyId = s.rows[0]!.id;
  const pub = await exec.query<{ id: string }>(
    `insert into publication (study_id, title, publication_date, publication_state, is_primary)
     values ($1, $2, $3, $4, true) returning id`,
    [studyId, o.title, o.date ?? null, o.pubState ?? 'PUBLISHED']
  );
  const pubId = pub.rows[0]!.id;
  if (o.doi) {
    await exec.query(
      `insert into research_identifier (publication_id, id_type, value_raw, value_canonical) values ($1,'DOI',$2,$3)`,
      [pubId, o.doi, o.doi]
    );
  }
  if (o.author) {
    const a = await exec.query<{ id: string }>(
      `insert into author (normalized_name, display_name) values ($1,$2) returning id`,
      [o.author.toLowerCase(), o.author]
    );
    await exec.query(`insert into publication_author (publication_id, author_id, author_position) values ($1,$2,1)`, [pubId, a.rows[0]!.id]);
  }
  for (const [dim, val] of Object.entries(o.classifications ?? {})) {
    await exec.query(`insert into classification (study_id, dimension, value, final_actor) values ($1,$2,$3,$4)`, [studyId, dim, val, A1]);
  }
  for (const c of o.conditions ?? []) await exec.query(`insert into study_condition (study_id, condition_id) values ($1,$2)`, [studyId, c]);
  for (const iv of o.interventions ?? []) await exec.query(`insert into study_intervention (study_id, intervention_id) values ($1,$2)`, [studyId, iv]);
  return studyId;
}

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  await db.asRolePersistent('service_role', null, async (exec) => {
    await insertStudy(exec, {
      title: 'Zebrafish asthma homeopathy randomized trial',
      studyType: 'RCT',
      date: '2015-03-01',
      doi: '10.7777/search.001',
      author: 'Quentin Searchauthor',
      classifications: { OUTCOME: 'POSITIVE', QUALITY: 'ADEQUATE', EVIDENCE_LEVEL: 'RCT' },
      conditions: [C_ASTHMA],
      interventions: [E_INDIV],
    });
    await insertStudy(exec, {
      title: 'Migraine observational cohort report',
      studyType: 'COHORT',
      date: '2020-07-01',
      doi: '10.7777/search.002',
      classifications: { OUTCOME: 'NEGATIVE', EVIDENCE_LEVEL: 'OBSERVATIONAL' },
      conditions: [C_MIGRAINE],
    });
    await insertStudy(exec, {
      title: 'Arnica meta review synthesis',
      studyType: 'META_ANALYSIS',
      date: '2010-01-01',
      doi: '10.7777/search.003',
      classifications: { OUTCOME: 'LEANING_POSITIVE', EVIDENCE_LEVEL: 'META_ANALYSIS' },
      interventions: [E_ARNICA],
    });
    // A draft sharing the "zebrafish asthma" tokens — must never surface.
    await insertStudy(exec, {
      title: 'Zebrafish asthma secret draft record',
      studyType: 'RCT',
      lifecycle: 'PENDING_REVIEW',
      pubState: 'DRAFT',
      date: '2016-01-01',
    });
  });
});
afterAll(async () => {
  await db.close();
});

const search = (params: Parameters<typeof searchPublishedResearch>[1]) =>
  db.asRole('anon', null, (exec) => searchPublishedResearch(exec, params));

describe('searchPublishedResearch — public boundary', () => {
  it('returns only PUBLISHED research (drafts excluded)', async () => {
    const res = await search({});
    expect(res.total).toBeGreaterThan(0);
    expect(res.cards.some((c) => c.title.includes('secret draft'))).toBe(false);
  });

  it('excludes the draft even when its tokens match the query', async () => {
    const res = await search({ q: 'zebrafish asthma' });
    expect(res.cards.every((c) => !c.title.includes('secret draft'))).toBe(true);
    expect(res.cards.some((c) => c.title.startsWith('Zebrafish asthma homeopathy'))).toBe(true);
  });
});

describe('searchPublishedResearch — search', () => {
  it('matches a title token', async () => {
    const res = await search({ q: 'zebrafish' });
    expect(res.cards[0]!.title).toContain('Zebrafish');
  });
  it('matches an author name', async () => {
    const res = await search({ q: 'Searchauthor' });
    expect(res.cards.some((c) => c.authors.includes('Quentin Searchauthor'))).toBe(true);
  });
  it('matches an exact DOI', async () => {
    const res = await search({ q: 'https://doi.org/10.7777/search.002' });
    expect(res.cards.some((c) => c.doi === '10.7777/search.002')).toBe(true);
  });
  it('returns no results for a non-matching query (without error)', async () => {
    const res = await search({ q: 'qwertzzz-nomatch-token' });
    expect(res.total).toBe(0);
    expect(res.cards).toHaveLength(0);
  });
  it('handles whitespace and case', async () => {
    const res = await search({ q: '  ZEBRAFISH  ' });
    expect(res.cards.some((c) => c.title.includes('Zebrafish'))).toBe(true);
  });
  it('handles malicious input safely (parameterized)', async () => {
    const res = await search({ q: "'; drop table research_study; --" });
    expect(res.total).toBe(0);
    const still = await db.asRole('anon', null, (exec) =>
      exec.query<{ n: string }>('select count(*)::text n from research_study')
    );
    expect(Number(still.rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe('searchPublishedResearch — filters', () => {
  it('filters by study type', async () => {
    const res = await search({ studyType: 'COHORT' });
    expect(res.cards.some((c) => c.title.includes('Migraine observational'))).toBe(true);
    expect(res.cards.every((c) => c.study_type_code === 'COHORT')).toBe(true);
  });
  it('filters by outcome', async () => {
    const res = await search({ outcome: 'NEGATIVE' });
    expect(res.cards.every((c) => c.outcome === 'NEGATIVE')).toBe(true);
  });
  it('filters by evidence level', async () => {
    const res = await search({ evidenceLevel: 'META_ANALYSIS' });
    expect(res.cards.some((c) => c.title.includes('Arnica meta'))).toBe(true);
  });
  it('filters by condition slug', async () => {
    const res = await search({ condition: 'asthma' });
    expect(res.cards.some((c) => c.title.includes('Zebrafish asthma'))).toBe(true);
    expect(res.cards.every((c) => c.conditions.includes('Asthma'))).toBe(true);
  });
  it('filters by intervention slug', async () => {
    const res = await search({ intervention: 'arnica-montana' });
    expect(res.cards.some((c) => c.title.includes('Arnica meta'))).toBe(true);
  });
  it('filters by year range', async () => {
    const res = await search({ yearFrom: 2015, yearTo: 2016 });
    expect(res.cards.every((c) => (c.year ?? 0) >= 2015 && (c.year ?? 0) <= 2016)).toBe(true);
    expect(res.cards.some((c) => c.title.includes('Zebrafish asthma'))).toBe(true);
  });
  it('combines filters', async () => {
    const res = await search({ studyType: 'RCT', condition: 'asthma', outcome: 'POSITIVE' });
    expect(res.cards.every((c) => c.study_type_code === 'RCT' && c.outcome === 'POSITIVE')).toBe(true);
  });
});

describe('searchPublishedResearch — sorting & pagination', () => {
  it('sorts newest and oldest', async () => {
    const newest = await search({ sort: 'newest' });
    const oldest = await search({ sort: 'oldest' });
    const years = (r: typeof newest) => r.cards.map((c) => c.year ?? 0).filter((y) => y > 0);
    const ny = years(newest);
    const oy = years(oldest);
    expect(ny[0]!).toBeGreaterThanOrEqual(ny[ny.length - 1]!);
    expect(oy[0]!).toBeLessThanOrEqual(oy[oy.length - 1]!);
  });
  it('sorts by title A–Z', async () => {
    const res = await search({ sort: 'title' });
    const titles = res.cards.map((c) => c.title.toLowerCase());
    const sorted = [...titles].sort();
    expect(titles).toEqual(sorted);
  });
  it('paginates: an out-of-range page returns no cards but a correct total', async () => {
    const first = await search({});
    const far = await search({ page: 999 });
    expect(far.total).toBe(first.total);
    expect(far.cards).toHaveLength(0);
  });
  it('de-duplicates multi-publication studies (one card per study)', async () => {
    const res = await search({ q: 'multi-publication' });
    const ids = res.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getPublishedResearchFacets', () => {
  it('returns facet options present among published research', async () => {
    const f = await db.asRole('anon', null, (exec) => getPublishedResearchFacets(exec));
    expect(f.studyTypes.some((s) => s.code === 'COHORT')).toBe(true);
    expect(f.conditions.some((c) => c.slug === 'asthma')).toBe(true);
    expect(f.outcomes).toContain('NEGATIVE');
    expect(f.yearMin ?? 9999).toBeLessThanOrEqual(2010);
    expect(f.yearMax ?? 0).toBeGreaterThanOrEqual(2020);
  });
});

describe('normalizeExplorerParams', () => {
  it('whitelists enums and coerces numbers', () => {
    const p = normalizeExplorerParams({ outcome: 'positive', sort: 'newest', page: '3', yearFrom: '2015', quality: 'bogus' });
    expect(p.outcome).toBe('POSITIVE');
    expect(p.sort).toBe('newest');
    expect(p.page).toBe(3);
    expect(p.yearFrom).toBe(2015);
    expect(p.quality).toBeUndefined();
  });
  it('drops invalid values and clamps page', () => {
    const p = normalizeExplorerParams({ sort: 'popularity', page: '0', yearTo: 'abc', outcome: '' });
    expect(p.sort).toBeUndefined();
    expect(p.page).toBe(1);
    expect(p.yearTo).toBeUndefined();
    expect(p.outcome).toBeUndefined();
  });
});
