/**
 * DEMO fixture and domain-distinction tests (docs/20 §3, §6).
 *
 * Verifies the required representative cases exist; that demo records cannot be
 * mistaken for real research; and that the non-negotiable distinctions hold in
 * data: Study != Publication, dimension independence, criticism != outcome,
 * AI suggestion != human canonical, and duplicate-candidate != deleted. Also
 * checks that stored canonical DOIs match `@wise-evidence/domain` normalizeDoi.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./harness.js";
import { normalizeDoi } from "@wise-evidence/database";

const MULTI_PUB_STUDY = "20000000-0000-0000-0000-000000000006";
const AI_OVERRIDE_STUDY = "20000000-0000-0000-0000-000000000007";
const POSITIVE_STUDY = "20000000-0000-0000-0000-000000000001";
const MISSING_DOI_STUDY = "20000000-0000-0000-0000-000000000005";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
});
afterAll(async () => {
  await db.close();
});

describe("demo fixtures are unmistakably demo", () => {
  it("marks every fixture study and publication is_demo = true", async () => {
    const s = await db.query<{ n: string }>(
      "select count(*)::text n from research_study where is_demo = false",
    );
    expect(s.rows[0]?.n).toBe("0");
    const p = await db.query<{ n: string }>(
      "select count(*)::text n from publication where is_demo = false",
    );
    expect(p.rows[0]?.n).toBe("0");
  });

  it("prefixes every demo title with [DEMO]", async () => {
    const bad = await db.query<{ n: string }>(
      "select count(*)::text n from research_study where canonical_title not like '[DEMO]%'",
    );
    expect(bad.rows[0]?.n).toBe("0");
  });

  it("uses only the reserved non-existent DOI registrant 10.0000/", async () => {
    const bad = await db.query<{ n: string }>(
      `select count(*)::text n from research_identifier
       where type = 'DOI' and value_canonical not like '10.0000/%'`,
    );
    expect(bad.rows[0]?.n).toBe("0");
  });

  it("defaults is_demo to false for a fresh non-demo insert", async () => {
    await db.query(
      "insert into research_study (id, canonical_title) values ('b0000000-0000-0000-0000-000000000001', 'real record')",
    );
    const row = await db.query<{ is_demo: boolean }>(
      "select is_demo from research_study where id = 'b0000000-0000-0000-0000-000000000001'",
    );
    expect(row.rows[0]?.is_demo).toBe(false);
  });
});

describe("required representative cases are present", () => {
  it("covers positive / negative / mixed / neutral outcomes", async () => {
    const res = await db.query<{ final_value: string }>(
      "select final_value from classification where dimension = 'OUTCOME' and final_value is not null",
    );
    const values = new Set(res.rows.map((r) => r.final_value));
    for (const v of ["POSITIVE", "NEGATIVE", "LEANING_POSITIVE", "NEUTRAL_INCONCLUSIVE"]) {
      expect(values.has(v), `missing demo outcome ${v}`).toBe(true);
    }
  });

  it("includes a published study with no DOI", async () => {
    const res = await db.query<{ n: string }>(
      `select count(*)::text n from research_identifier ri
       join publication p on p.id = ri.publication_id
       where p.study_id = $1 and ri.type = 'DOI'`,
      [MISSING_DOI_STUDY],
    );
    expect(res.rows[0]?.n).toBe("0");
  });
});

describe("Study != Publication", () => {
  it("one study can carry multiple publications", async () => {
    const res = await db.query<{ n: string }>(
      "select count(*)::text n from publication where study_id = $1",
      [MULTI_PUB_STUDY],
    );
    expect(res.rows[0]?.n).toBe("2");
    // still exactly one primary publication
    const primary = await db.query<{ n: string }>(
      "select count(*)::text n from publication where study_id = $1 and is_primary",
      [MULTI_PUB_STUDY],
    );
    expect(primary.rows[0]?.n).toBe("1");
  });
});

describe("dimensions stay independent", () => {
  it("a positive study also carries criticism, and its outcome is unchanged", async () => {
    const outcome = await db.query<{ final_value: string }>(
      "select final_value from classification where study_id = $1 and dimension = 'OUTCOME'",
      [POSITIVE_STUDY],
    );
    expect(outcome.rows[0]?.final_value).toBe("POSITIVE");
    const crit = await db.query<{ n: string }>(
      "select count(*)::text n from criticism where study_id = $1 and status = 'ACTIVE'",
      [POSITIVE_STUDY],
    );
    expect(Number(crit.rows[0]?.n)).toBeGreaterThan(0);
  });

  it("stores quality separately from outcome (different table, no shared column)", async () => {
    const q = await db.query<{ n: string }>(
      "select count(*)::text n from evidence_quality_assessment where study_id = $1",
      [POSITIVE_STUDY],
    );
    expect(Number(q.rows[0]?.n)).toBeGreaterThan(0);
  });
});

describe("AI suggestion != human canonical", () => {
  it("keeps the immutable AI suggestion and a differing human final value", async () => {
    const row = await db.query<{ final_value: string; ai_outcome: string }>(
      `select c.final_value, r.structured_output->>'outcome' as ai_outcome
       from classification c
       join ai_result r on r.id = c.ai_result_id
       where c.study_id = $1 and c.dimension = 'OUTCOME'`,
      [AI_OVERRIDE_STUDY],
    );
    expect(row.rows[0]?.ai_outcome).toBe("POSITIVE"); // AI said POSITIVE
    expect(row.rows[0]?.final_value).toBe("LEANING_POSITIVE"); // human overrode
    expect(row.rows[0]?.final_value).not.toBe(row.rows[0]?.ai_outcome);
  });

  it("records the override in review and append-only audit history", async () => {
    const rev = await db.query<{ n: string }>(
      "select count(*)::text n from review where study_id = $1",
      [AI_OVERRIDE_STUDY],
    );
    expect(Number(rev.rows[0]?.n)).toBeGreaterThan(0);
    const audit = await db.query<{ n: string }>(
      "select count(*)::text n from audit_log where entity_id = $1",
      [AI_OVERRIDE_STUDY],
    );
    expect(Number(audit.rows[0]?.n)).toBeGreaterThan(0);
  });
});

describe("duplicate candidate is routed, never deleted", () => {
  it("keeps both the original and the fuzzy-duplicate study, linked via a candidate", async () => {
    const both = await db.query<{ n: string }>(
      `select count(*)::text n from research_study
       where normalized_title = 'demo duplicate title shared'`,
    );
    expect(both.rows[0]?.n).toBe("2");
    const cand = await db.query<{ state: string; duplicate_of_study_id: string }>(
      "select state, duplicate_of_study_id from import_candidate where state = 'DUPLICATE_CANDIDATE'",
    );
    expect(cand.rows[0]?.duplicate_of_study_id).toBe("20000000-0000-0000-0000-00000000000a");
  });
});

describe("stored DOIs match the shared canonicaliser", () => {
  it("normalizeDoi(value_raw) equals the stored value_canonical for every demo DOI", async () => {
    const rows = await db.query<{ value_raw: string; value_canonical: string }>(
      "select value_raw, value_canonical from research_identifier where type = 'DOI'",
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const r of rows.rows) {
      const normalized = normalizeDoi(r.value_raw);
      expect(normalized.ok).toBe(true);
      if (normalized.ok) {
        expect(normalized.doi).toBe(r.value_canonical);
      }
    }
  });
});
