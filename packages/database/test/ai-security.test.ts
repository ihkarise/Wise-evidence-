/**
 * M6 AI security + firewall tests (docs/29 §17, §19, §21). The database is the
 * authoritative boundary. These assert, against the real RLS/policies and the
 * service layer:
 *   - AI records (ai_job / ai_result) are private: anon and non-staff cannot read
 *     them; staff can.
 *   - AI never writes canonical data, never publishes, never changes lifecycle /
 *     publication state (recordExecution + a decision leave the study untouched).
 *   - The M5 firewall holds: an AI suggestion does not change any published
 *     statistic; only a human-approved canonical value does.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase, type RoleScopedDb } from "./harness.js";
import {
  createDraftFromMetadata,
  setOutcome,
  submitForReview,
  approveAndPublish,
  recordExecution,
  recordSuggestionDecision,
  getOutcomeDistribution,
  getCatalogueOverview,
  type Actor,
  type AiJobKey,
} from "../src/index.js";

const ADMIN: Actor = { id: "10000000-0000-0000-0000-0000000000ad", role: "ADMIN" };
const REVIEWER: Actor = { id: "10000000-0000-0000-0000-000000000001", role: "REVIEWER" };
const STRANGER_ID = "99999999-9999-9999-9999-999999999999";
const PUBLISHED_DEMO = "20000000-0000-0000-0000-000000000001";

let db: TestDatabase;
function svc<T>(fn: (db: RoleScopedDb) => Promise<T>): Promise<T> {
  return db.asServiceRole(fn);
}

const NO_USAGE = { inputTokens: null, outputTokens: null, totalTokens: null };

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  await db.query(
    "insert into app_user (id, email, display_name, role) values ($1, 'a@example.invalid', 'Admin', 'ADMIN')",
    [ADMIN.id],
  );
});
afterAll(async () => {
  await db.close();
});

describe("RLS: AI records are private", () => {
  it("anon is hard-denied on ai_job and ai_result (no grant at all)", async () => {
    // anon has NO grant on the private AI tables (migration 0008), so the read is
    // rejected outright — a stronger guarantee than an RLS-filtered empty result.
    await expect(db.asAnon((s) => s.query("select 1 from ai_job"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.asAnon((s) => s.query("select 1 from ai_result"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("a signed-in non-staff user cannot read ai_result", async () => {
    const rows = await db.asUser(STRANGER_ID, (s) =>
      s.query<{ n: string }>("select count(*)::text n from ai_result"),
    );
    expect(rows.rows[0]?.n).toBe("0");
  });

  it("a reviewer can read AI records", async () => {
    const rows = await db.asUser(REVIEWER.id, (s) =>
      s.query<{ n: string }>("select count(*)::text n from ai_result"),
    );
    expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0);
  });
});

describe("AI never writes canonical data or changes state", () => {
  let studyId: string;

  beforeAll(async () => {
    const created = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, {
        doi: "10.1234/wise.m6.firewall",
        title: "Firewall Study",
        sourceName: "Manual entry (test)",
      }),
    );
    studyId = created.studyId;
  });

  it("recording a suggestion + decision leaves lifecycle/publication state untouched", async () => {
    const before = await svc((s) =>
      s.query<{ lifecycle_state: string; publication_state: string }>(
        "select lifecycle_state, publication_state from research_study where id = $1",
        [studyId],
      ),
    );
    const res = await svc((s) =>
      recordExecution(s, REVIEWER, {
        key: {
          studyId,
          operation: "outcome-classification",
          inputHash: "fw-1",
          model: "mock-1",
          promptVersion: "v1",
        } satisfies AiJobKey,
        provider: "mock",
        promptContentHash: "ph",
        result: {
          validationStatus: "VALID",
          output: { outcome: "STRONG_POSITIVE", confidence: 0.9 },
          confidence: 0.9,
          usage: NO_USAGE,
          costEstimate: null,
          validationError: null,
          rawOutputSha256: "rh",
        },
      }),
    );
    await svc((s) =>
      recordSuggestionDecision(s, REVIEWER, {
        resultId: res.resultId!,
        studyId,
        task: "outcome-classification",
        decision: "REJECT",
      }),
    );

    const after = await svc((s) =>
      s.query<{ lifecycle_state: string; publication_state: string }>(
        "select lifecycle_state, publication_state from research_study where id = $1",
        [studyId],
      ),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0]?.publication_state).toBe("DRAFT");
  });

  it("does not create a canonical classification value from the AI suggestion", async () => {
    const rows = await svc((s) =>
      s.query<{ final_value: string | null }>(
        "select final_value from classification where study_id = $1 and dimension = 'OUTCOME'",
        [studyId],
      ),
    );
    // Either no row, or a row whose human final_value is still null — the AI's
    // STRONG_POSITIVE suggestion is NOT canonical.
    expect(rows.rows[0]?.final_value ?? null).toBeNull();
  });
});

describe("M5 firewall: AI suggestions never enter published statistics", () => {
  it("adding an AI suggestion for a published study does not change the outcome distribution", async () => {
    const before = await db.asAnon((s) => getOutcomeDistribution(s));
    const overviewBefore = await db.asAnon((s) => getCatalogueOverview(s));

    await svc((s) =>
      recordExecution(s, REVIEWER, {
        key: {
          studyId: PUBLISHED_DEMO,
          operation: "outcome-classification",
          inputHash: "m5-firewall",
          model: "mock-1",
          promptVersion: "v1",
        },
        provider: "mock",
        promptContentHash: "ph",
        result: {
          validationStatus: "VALID",
          output: { outcome: "STRONG_NEGATIVE", confidence: 0.99 },
          confidence: 0.99,
          usage: NO_USAGE,
          costEstimate: null,
          validationError: null,
          rawOutputSha256: "rh",
        },
      }),
    );

    const after = await db.asAnon((s) => getOutcomeDistribution(s));
    const overviewAfter = await db.asAnon((s) => getCatalogueOverview(s));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(JSON.stringify(overviewAfter)).toBe(JSON.stringify(overviewBefore));
  });

  it("the published study's canonical outcome is unchanged by the AI suggestion", async () => {
    const row = await svc((s) =>
      s.query<{ final_value: string; ai_result_id: string | null }>(
        "select final_value, ai_result_id from classification where study_id = $1 and dimension = 'OUTCOME'",
        [PUBLISHED_DEMO],
      ),
    );
    expect(row.rows[0]?.final_value).toBe("POSITIVE"); // seed value
    expect(row.rows[0]?.ai_result_id).toBeNull(); // never auto-linked
  });
});

describe("human-approved values behave normally in M5", () => {
  it("a human-published outcome DOES appear in the outcome distribution", async () => {
    const created = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, {
        doi: "10.1234/wise.m6.human",
        title: "Human Approved Study",
        sourceName: "Manual entry (test)",
      }),
    );
    const id = created.studyId;

    const before = await db.asAnon((s) => getOutcomeDistribution(s));
    const strongNegBefore = countFor(before, "STRONG_NEGATIVE");

    await svc((s) => setOutcome(s, REVIEWER, id, "STRONG_NEGATIVE", null, null));
    await svc((s) => submitForReview(s, REVIEWER, id));
    await svc((s) => approveAndPublish(s, ADMIN, id));

    const after = await db.asAnon((s) => getOutcomeDistribution(s));
    expect(countFor(after, "STRONG_NEGATIVE")).toBe(strongNegBefore + 1);
  });
});

// --- helpers -----------------------------------------------------------------

function countFor(
  dist: { buckets: readonly { value: string; studyCount: number }[] },
  value: string,
): number {
  return dist.buckets.find((b) => b.value === value)?.studyCount ?? 0;
}
