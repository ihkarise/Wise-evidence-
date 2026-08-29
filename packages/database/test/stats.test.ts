/**
 * M5 Evidence Visualization tests (docs/28 §8, ADR-016). The stats layer is a
 * PostgreSQL-only, PUBLISHED-only, distinct-STUDY count layer. These tests build
 * a small, fully deterministic fixture set directly on the owner path (exactly as
 * supabase/seed/demo_fixtures.sql does), then drive the stats functions through:
 *
 *   - the ANON role the Supabase shim recreates (production RLS is the
 *     authoritative gate — the realistic public path used by /evidence and
 *     /statistics), and
 *   - the service_role path, to prove the explicit `publication_state` predicate
 *     makes the functions correct under a privileged role too.
 *
 * Coverage (task §17): evidence-level counts + rank ordering + zero-count bands +
 * UNCLASSIFIED; published-only (drafts/pending/rejected/archived excluded);
 * one-study-multiple-publications counts once and publications counted
 * separately; full seven-category outcome spectrum with zero counts and
 * UNCLASSIFIED (missing never becomes NEUTRAL); quality independent of outcome;
 * criticism independent of outcome and never inflated by multiple rows; RLS
 * honesty (private/AI/audit/review/import records invisible); and a structural
 * guard that no efficacy/balance/combined score is ever introduced.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase, type RoleScopedDb } from "./harness.js";
import * as stats from "../src/stats.js";
import {
  getCatalogueOverview,
  getEvidencePyramid,
  getOutcomeDistribution,
  getQualityDistribution,
  getCriticismDistribution,
  OUTCOME_UNCLASSIFIED,
  QUALITY_UNASSESSED,
  EVIDENCE_UNCLASSIFIED,
} from "../src/stats.js";

let db: TestDatabase;

/** Run a stats query on the public anon path — RLS-enforced, like production. */
function pub<T>(fn: (db: RoleScopedDb) => Promise<T>): Promise<T> {
  return db.asAnon(fn);
}

/** A reviewer app_user id used as actor on classifications/criticism. */
const REVIEWER = "aa000000-0000-0000-0000-0000000000a0";

/**
 * Deterministic fixtures, all is_demo=false ("real"). Six PUBLISHED studies
 * (S1–S6) plus four non-published studies (drafts/pending/rejected/archived) that
 * must never be counted. Cross-pairs (positive+low quality, negative+high
 * quality) make outcome/quality independence visible.
 */
const FIXTURES = `
insert into app_user (id, email, display_name, role) values
  ('${REVIEWER}', 'm5-reviewer@example.invalid', 'M5 Reviewer', 'REVIEWER');

-- PUBLISHED studies -----------------------------------------------------------
insert into research_study (id, canonical_title, normalized_title, study_type_id, subject_type, lifecycle_state, publication_state, is_demo) values
  ('50000000-0000-0000-0000-000000000001', 'S1 rct',   's1 rct',   (select id from study_type where code='RCT'),           'HUMAN', 'PUBLISHED','PUBLISHED', false),
  ('50000000-0000-0000-0000-000000000002', 'S2 rct',   's2 rct',   (select id from study_type where code='RCT'),           'HUMAN', 'PUBLISHED','PUBLISHED', false),
  ('50000000-0000-0000-0000-000000000003', 'S3 meta',  's3 meta',  (select id from study_type where code='META_ANALYSIS'), 'HUMAN', 'PUBLISHED','PUBLISHED', false),
  ('50000000-0000-0000-0000-000000000004', 'S4 cohort','s4 cohort',(select id from study_type where code='COHORT'),        'HUMAN', 'PUBLISHED','PUBLISHED', false),
  ('50000000-0000-0000-0000-000000000005', 'S5 rct',   's5 rct',   (select id from study_type where code='RCT'),           'HUMAN', 'PUBLISHED','PUBLISHED', false),
  -- S6: NO study type (study_type_id null) => UNCLASSIFIED evidence band; multi-publication.
  ('50000000-0000-0000-0000-000000000006', 'S6 notype','s6 notype', null,                                                 'HUMAN', 'PUBLISHED','PUBLISHED', false);

-- NON-published studies (must be excluded from every count) --------------------
insert into research_study (id, canonical_title, normalized_title, study_type_id, subject_type, lifecycle_state, publication_state, is_demo) values
  ('50000000-0000-0000-0000-0000000000d1', 'D1 draft',   'd1 draft',   (select id from study_type where code='RCT'), 'HUMAN', 'IMPORTED','DRAFT', false),
  ('50000000-0000-0000-0000-0000000000d2', 'D2 pending', 'd2 pending', (select id from study_type where code='RCT'), 'HUMAN', 'PENDING_REVIEW','PENDING_REVIEW', false),
  ('50000000-0000-0000-0000-0000000000d3', 'D3 rejected','d3 rejected',(select id from study_type where code='RCT'), 'HUMAN', 'REJECTED','REJECTED', false),
  ('50000000-0000-0000-0000-0000000000d4', 'D4 archived','d4 archived',(select id from study_type where code='RCT'), 'HUMAN', 'ARCHIVED','ARCHIVED', false);

-- Publications. S1–S5 have one each; S6 has TWO (a preprint + a primary journal).
insert into publication (id, study_id, title, publication_date, language, is_primary, is_demo) values
  ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','S1 rct',   '2021-01-01','en', true,  false),
  ('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','S2 rct',   '2020-01-01','en', true,  false),
  ('60000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000003','S3 meta',  '2022-01-01','en', true,  false),
  ('60000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000004','S4 cohort','2019-01-01','en', true,  false),
  ('60000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000005','S5 rct',   '2023-01-01','en', true,  false),
  ('60000000-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000006','S6 preprint','2021-06-01','en', false, false),
  ('60000000-0000-0000-0000-000000000016','50000000-0000-0000-0000-000000000006','S6 journal', '2022-06-01','en', true,  false),
  -- a publication on the draft, to prove draft publications are also excluded.
  ('60000000-0000-0000-0000-0000000000d1','50000000-0000-0000-0000-0000000000d1','D1 draft', '2024-01-01','en', true, false);

-- OUTCOME classifications (human-reviewed final values). Cross-paired with quality.
insert into classification (study_id, dimension, final_value, final_actor, confidence) values
  ('50000000-0000-0000-0000-000000000001','OUTCOME','STRONG_POSITIVE',    '${REVIEWER}','HIGH'),
  ('50000000-0000-0000-0000-000000000002','OUTCOME','NEGATIVE',           '${REVIEWER}','HIGH'),
  ('50000000-0000-0000-0000-000000000003','OUTCOME','POSITIVE',           '${REVIEWER}','MODERATE'),
  ('50000000-0000-0000-0000-000000000004','OUTCOME','NEUTRAL_INCONCLUSIVE','${REVIEWER}','LOW'),
  ('50000000-0000-0000-0000-000000000006','OUTCOME','LEANING_NEGATIVE',   '${REVIEWER}','MODERATE');
-- S5 has an OUTCOME row with a NULL final value (AI-only, pending review): it must
-- count as UNCLASSIFIED, never NEUTRAL. On anon RLS hides it; the left join still
-- yields UNCLASSIFIED.
insert into classification (study_id, dimension, final_value, confidence) values
  ('50000000-0000-0000-0000-000000000005','OUTCOME', null, 'LOW');
-- A published-study count must be unaffected by outcomes on NON-published studies:
insert into classification (study_id, dimension, final_value, final_actor, confidence) values
  ('50000000-0000-0000-0000-0000000000d1','OUTCOME','POSITIVE','${REVIEWER}','HIGH'),
  ('50000000-0000-0000-0000-0000000000d2','OUTCOME','STRONG_POSITIVE','${REVIEWER}','HIGH');

-- QUALITY summaries (independent of outcome): S1 positive+LOW, S2 negative+HIGH.
insert into classification (study_id, dimension, final_value, final_actor) values
  ('50000000-0000-0000-0000-000000000001','QUALITY','LOW',     '${REVIEWER}'),
  ('50000000-0000-0000-0000-000000000002','QUALITY','HIGH',    '${REVIEWER}'),
  ('50000000-0000-0000-0000-000000000003','QUALITY','MODERATE','${REVIEWER}'),
  ('50000000-0000-0000-0000-000000000005','QUALITY','UNCLEAR', '${REVIEWER}');
-- S4 and S6 have NO quality row => UNASSESSED.

-- Criticism. S2 has THREE active rows (2 METHODOLOGY + 1 BLINDING); S3 has one.
-- A withdrawn row on S1 must never be counted.
insert into criticism (study_id, category, origin, text, actor, status) values
  ('50000000-0000-0000-0000-000000000002','METHODOLOGY','REVIEWER_ASSESSED','m5 crit a','${REVIEWER}','ACTIVE'),
  ('50000000-0000-0000-0000-000000000002','METHODOLOGY','REVIEWER_ASSESSED','m5 crit b','${REVIEWER}','ACTIVE'),
  ('50000000-0000-0000-0000-000000000002','BLINDING',   'AUTHOR_REPORTED',  'm5 crit c','${REVIEWER}','ACTIVE'),
  ('50000000-0000-0000-0000-000000000003','METHODOLOGY','EXTERNAL_PUBLICATION','m5 crit d','${REVIEWER}','ACTIVE'),
  ('50000000-0000-0000-0000-000000000001','SAMPLE_SIZE','REVIEWER_ASSESSED','m5 withdrawn','${REVIEWER}','WITHDRAWN');
`;

beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(FIXTURES);
});
afterAll(async () => {
  await db.close();
});

// --- catalogue overview ------------------------------------------------------

describe("catalogue overview — studies vs publications (docs/28 §1.5)", () => {
  it("counts 6 published studies across 7 published publications", async () => {
    const o = await pub(getCatalogueOverview);
    expect(o.publishedStudies).toBe(6);
    // S1..S5 = 5 primary + S6 = 2 => 7 publications; the draft's publication is
    // excluded because its study is not PUBLISHED.
    expect(o.publishedPublications).toBe(7);
  });

  it("a multi-publication study never inflates the study count", async () => {
    const o = await pub(getCatalogueOverview);
    // S6 alone contributes 2 publications but exactly 1 study.
    expect(o.publishedPublications).toBeGreaterThan(o.publishedStudies);
    const pyr = await pub(getEvidencePyramid);
    const unclassified = pyr.find((b) => b.isUnclassified)!;
    expect(unclassified.studyCount).toBe(1); // S6, counted ONCE despite 2 pubs
  });
});

// --- evidence pyramid --------------------------------------------------------

describe("evidence pyramid (docs/28 §1.1–1.5)", () => {
  it("returns all 10 taxonomy bands in pyramid_rank order plus a trailing UNCLASSIFIED band", async () => {
    const pyr = await pub(getEvidencePyramid);
    const taxonomy = pyr.filter((b) => !b.isUnclassified);
    expect(taxonomy.map((b) => b.code)).toEqual([
      "META_ANALYSIS",
      "SYSTEMATIC_REVIEW",
      "RCT",
      "CONTROLLED_TRIAL",
      "OBSERVATIONAL",
      "CASE_SERIES",
      "CASE_REPORT",
      "PRECLINICAL",
      "EXPERT_OPINION",
      "OTHER",
    ]);
    // ranks strictly ascending
    const ranks = taxonomy.map((b) => b.rank!);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // the synthetic band is last and carries EVIDENCE_UNCLASSIFIED
    const last = pyr[pyr.length - 1]!;
    expect(last.code).toBe(EVIDENCE_UNCLASSIFIED);
    expect(last.isUnclassified).toBe(true);
    expect(last.rank).toBeNull();
  });

  it("counts distinct studies per band, including zero-count bands", async () => {
    const pyr = await pub(getEvidencePyramid);
    const byCode = Object.fromEntries(pyr.map((b) => [b.code, b.studyCount]));
    expect(byCode.META_ANALYSIS).toBe(1); // S3
    expect(byCode.RCT).toBe(3); // S1, S2, S5
    expect(byCode.OBSERVATIONAL).toBe(1); // S4 (COHORT collapses into OBSERVATIONAL)
    expect(byCode.SYSTEMATIC_REVIEW).toBe(0); // zero-count band still present
    expect(byCode.CASE_REPORT).toBe(0);
    expect(byCode.PRECLINICAL).toBe(0);
  });

  it("puts studies with no study type into the explicit UNCLASSIFIED band (never discarded)", async () => {
    const pyr = await pub(getEvidencePyramid);
    const unclassified = pyr.find((b) => b.isUnclassified)!;
    expect(unclassified.studyCount).toBe(1); // S6
    // band counts sum to the published-study total — nothing dropped.
    const sum = pyr.reduce((a, b) => a + b.studyCount, 0);
    expect(sum).toBe(6);
  });
});

// --- outcome distribution ----------------------------------------------------

describe("outcome distribution (docs/28 §1.6–1.8)", () => {
  it("represents all seven canonical categories in spectrum order, then UNCLASSIFIED", async () => {
    const { buckets } = await pub(getOutcomeDistribution);
    expect(buckets.map((b) => b.value)).toEqual([
      "STRONG_POSITIVE",
      "POSITIVE",
      "LEANING_POSITIVE",
      "NEUTRAL_INCONCLUSIVE",
      "LEANING_NEGATIVE",
      "NEGATIVE",
      "STRONG_NEGATIVE",
      OUTCOME_UNCLASSIFIED,
    ]);
  });

  it("preserves zero counts and counts each study once", async () => {
    const { buckets, total } = await pub(getOutcomeDistribution);
    const by = Object.fromEntries(buckets.map((b) => [b.value, b.studyCount]));
    expect(by.STRONG_POSITIVE).toBe(1); // S1
    expect(by.POSITIVE).toBe(1); // S3
    expect(by.NEUTRAL_INCONCLUSIVE).toBe(1); // S4
    expect(by.LEANING_NEGATIVE).toBe(1); // S6
    expect(by.NEGATIVE).toBe(1); // S2
    expect(by.LEANING_POSITIVE).toBe(0); // zero preserved
    expect(by.STRONG_NEGATIVE).toBe(0); // zero preserved
    expect(total).toBe(6);
  });

  it("counts missing/AI-only outcome as UNCLASSIFIED — NEVER neutral", async () => {
    const { buckets } = await pub(getOutcomeDistribution);
    const by = Object.fromEntries(buckets.map((b) => [b.value, b.studyCount]));
    // S5 has an AI-only OUTCOME row with a null final value; it must be here...
    expect(by[OUTCOME_UNCLASSIFIED]).toBe(1);
    // ...and it must NOT have been folded into NEUTRAL_INCONCLUSIVE (still only S4).
    expect(by.NEUTRAL_INCONCLUSIVE).toBe(1);
  });

  it("buckets sum exactly to the published-study total (self-checking identity)", async () => {
    const { buckets, total } = await pub(getOutcomeDistribution);
    expect(buckets.reduce((a, b) => a + b.studyCount, 0)).toBe(total);
  });
});

// --- quality distribution ----------------------------------------------------

describe("quality distribution — independent of outcome (docs/28 §1.9)", () => {
  it("represents HIGH/MODERATE/LOW/UNCLEAR plus UNASSESSED, zero-filled", async () => {
    const { buckets } = await pub(getQualityDistribution);
    expect(buckets.map((b) => b.value)).toEqual([
      "HIGH",
      "MODERATE",
      "LOW",
      "UNCLEAR",
      QUALITY_UNASSESSED,
    ]);
  });

  it("counts quality independently of outcome (negative+HIGH, positive+LOW both present)", async () => {
    const { buckets, total } = await pub(getQualityDistribution);
    const by = Object.fromEntries(buckets.map((b) => [b.value, b.studyCount]));
    expect(by.HIGH).toBe(1); // S2 — a NEGATIVE-outcome study with HIGH quality
    expect(by.LOW).toBe(1); // S1 — a STRONG_POSITIVE study with LOW quality
    expect(by.MODERATE).toBe(1); // S3
    expect(by.UNCLEAR).toBe(1); // S5
    expect(by[QUALITY_UNASSESSED]).toBe(2); // S4, S6 (no quality row)
    expect(buckets.reduce((a, b) => a + b.studyCount, 0)).toBe(total);
  });
});

// --- criticism distribution --------------------------------------------------

describe("criticism distribution — independent, study-based (docs/28 §1.10–1.11)", () => {
  it("counts DISTINCT studies per category — multiple criticism rows do not inflate", async () => {
    const { byCategory } = await pub(getCriticismDistribution);
    const by = Object.fromEntries(byCategory.map((b) => [b.value, b.studyCount]));
    // S2 has TWO METHODOLOGY rows + S3 has one => 2 distinct studies, not 3 rows.
    expect(by.METHODOLOGY).toBe(2);
    expect(by.BLINDING).toBe(1); // S2 only
    expect(by.STATISTICS).toBe(0); // zero-filled
  });

  it("breaks down by origin on its own axis, keeping origins distinguishable", async () => {
    const { byOrigin } = await pub(getCriticismDistribution);
    const by = Object.fromEntries(byOrigin.map((b) => [b.value, b.studyCount]));
    expect(by.REVIEWER_ASSESSED).toBe(1); // S2
    expect(by.AUTHOR_REPORTED).toBe(1); // S2
    expect(by.EXTERNAL_PUBLICATION).toBe(1); // S3
    expect(by.AI_SUGGESTED).toBe(0);
  });

  it("reports studies-with / studies-without criticism and excludes withdrawn rows", async () => {
    const { studiesWithCriticism, studiesWithNoCriticism, total } =
      await pub(getCriticismDistribution);
    // S2 + S3 carry active criticism; S1's only criticism is WITHDRAWN, so S1 is not counted.
    expect(studiesWithCriticism).toBe(2);
    expect(studiesWithNoCriticism).toBe(4);
    expect(total).toBe(6);
  });

  it("does not alter the outcome distribution (criticism is not a negative outcome)", async () => {
    // S2 (NEGATIVE, 3 criticisms) and S3 (POSITIVE, 1 criticism) keep their outcomes.
    const { buckets } = await pub(getOutcomeDistribution);
    const by = Object.fromEntries(buckets.map((b) => [b.value, b.studyCount]));
    expect(by.NEGATIVE).toBe(1);
    expect(by.POSITIVE).toBe(1);
  });
});

// --- published-only / RLS honesty --------------------------------------------

describe("published-only visibility & RLS honesty (docs/28 §1.16, task §15)", () => {
  it("excludes drafts / pending / rejected / archived from every count", async () => {
    const o = await pub(getCatalogueOverview);
    expect(o.publishedStudies).toBe(6); // the 4 non-published studies are not here
    const { total } = await pub(getOutcomeDistribution);
    expect(total).toBe(6);
    // D2 is PENDING with a STRONG_POSITIVE outcome; it must not appear.
    const { buckets } = await pub(getOutcomeDistribution);
    const strongPos = buckets.find((b) => b.value === "STRONG_POSITIVE")!;
    expect(strongPos.studyCount).toBe(1); // S1 only — not the pending D2
  });

  it("anon and service_role agree on the published counts (predicate = RLS)", async () => {
    const anon = await db.asAnon(getCatalogueOverview);
    const service = await db.asServiceRole(getCatalogueOverview);
    expect(anon).toEqual(service);
    const anonOut = await db.asAnon(getOutcomeDistribution);
    const svcOut = await db.asServiceRole(getOutcomeDistribution);
    expect(anonOut).toEqual(svcOut);
  });

  it("hard-denies anon access to private/AI/audit/review/import tables", async () => {
    // These tables grant SELECT to authenticated only; anon has no grant at all.
    for (const table of ["ai_result", "audit_log", "review", "import_job"]) {
      await expect(
        db.asAnon((s) => s.query(`select count(*)::text n from ${table}`)),
      ).rejects.toBeTruthy();
    }
  });

  it("never surfaces an AI-only suggestion as a public value (it stays UNCLASSIFIED)", async () => {
    // S5's outcome exists only as an AI-shaped null-final_value row; on the anon
    // path it is invisible as a real category and lands in UNCLASSIFIED.
    const { buckets } = await pub(getOutcomeDistribution);
    const by = Object.fromEntries(buckets.map((b) => [b.value, b.studyCount]));
    expect(by[OUTCOME_UNCLASSIFIED]).toBe(1);
  });
});

// --- structural no-score guard -----------------------------------------------

describe("structural guard — no efficacy/combined score is ever introduced (docs/28 §1.18)", () => {
  const FORBIDDEN =
    /(efficacy|effectiveness|balance|weighted|combined|score|netpositive|net_positive)/i;

  it("exposes no export whose name implies a score/balance/efficacy metric", () => {
    for (const name of Object.keys(stats)) {
      expect(name).not.toMatch(FORBIDDEN);
    }
  });

  it("returns only descriptive count shapes — no score-like keys anywhere", async () => {
    const [overview, pyramid, outcome, quality, criticism] = await Promise.all([
      pub(getCatalogueOverview),
      pub(getEvidencePyramid),
      pub(getOutcomeDistribution),
      pub(getQualityDistribution),
      pub(getCriticismDistribution),
    ]);
    const keys = new Set<string>();
    const collect = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object")
        for (const [k, val] of Object.entries(v)) {
          keys.add(k);
          collect(val);
        }
    };
    collect([overview, pyramid, outcome, quality, criticism]);
    for (const k of keys) expect(k).not.toMatch(FORBIDDEN);
    // The only count fields are study/publication counts and plain totals.
    expect([...keys].sort()).toEqual(
      [
        "buckets",
        "byCategory",
        "byOrigin",
        "code",
        "isUnclassified",
        "label",
        "publishedPublications",
        "publishedStudies",
        "rank",
        "studiesWithCriticism",
        "studiesWithNoCriticism",
        "studyCount",
        "total",
        "value",
      ].sort(),
    );
  });
});
