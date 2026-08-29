/**
 * M6 AI persistence, cache, and provenance tests (docs/29 §21). Drives the
 * database AI service against the deterministic PGlite database via the
 * service_role executor — the same trusted path the Astro server uses after it
 * authorizes the actor. Covers job/result persistence, the cache identity (hit /
 * miss / isolation by prompt-version + model + input), immutability, minimised
 * input, token-usage NULL handling, suggestion listing, the human decision
 * record, and accept-provenance on the canonical row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase, type RoleScopedDb } from "./harness.js";
import {
  createDraftFromMetadata,
  setOutcome,
  recordExecution,
  findCachedSuggestion,
  getStudySuggestions,
  getEnrichmentInput,
  recordSuggestionDecision,
  getSuggestionOutput,
  ServiceError,
  type Actor,
  type AiJobKey,
  type AiUsage,
} from "../src/index.js";

const ADMIN: Actor = { id: "10000000-0000-0000-0000-0000000000ad", role: "ADMIN" };
const REVIEWER: Actor = { id: "10000000-0000-0000-0000-000000000001", role: "REVIEWER" }; // seeded
const PUBLIC: Actor = { id: "10000000-0000-0000-0000-0000000000bb", role: "PUBLIC" };

let db: TestDatabase;
let studyId: string;

function svc<T>(fn: (db: RoleScopedDb) => Promise<T>): Promise<T> {
  return db.asServiceRole(fn);
}

const USAGE: AiUsage = { inputTokens: 12, outputTokens: 6, totalTokens: 18 };
const NO_USAGE: AiUsage = { inputTokens: null, outputTokens: null, totalTokens: null };

function key(over: Partial<AiJobKey> = {}): AiJobKey {
  return {
    studyId,
    operation: "outcome-classification",
    inputHash: "hash-aaa",
    model: "mock-1",
    promptVersion: "v1",
    ...over,
  };
}

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  await db.query(
    "insert into app_user (id, email, display_name, role) values ($1, 'a@example.invalid', 'Admin', 'ADMIN')",
    [ADMIN.id],
  );
  const created = await svc((s) =>
    createDraftFromMetadata(s, REVIEWER, {
      doi: "10.1234/wise.m6.ai",
      title: "A Homeopathy Trial For AI Enrichment Testing",
      abstract: "Invented abstract for the AI enrichment tests.",
      journalTitle: "Journal of Example",
      publicationDate: "2022-05",
      sourceName: "Manual entry (test)",
    }),
  );
  studyId = created.studyId;
});
afterAll(async () => {
  await db.close();
});

describe("minimised task input (data minimization)", () => {
  it("builds only the fields a task needs, and never a DOI", async () => {
    const input = (await svc((s) => getEnrichmentInput(s, studyId, "outcome-classification")))!;
    expect(input.title).toContain("Homeopathy Trial");
    expect(Object.keys(input)).not.toContain("doi");
    expect(input).toHaveProperty("abstract");
    expect(input).toHaveProperty("publicationYear");
  });

  it("builds a target + candidate set for duplicate-detection", async () => {
    const input = (await svc((s) => getEnrichmentInput(s, studyId, "duplicate-detection")))!;
    expect(input).toHaveProperty("target");
    expect(Array.isArray((input as { candidates: unknown[] }).candidates)).toBe(true);
  });
});

describe("record + cache identity", () => {
  let resultId: string;

  it("records a VALID job + immutable result on the service path", async () => {
    const res = await svc((s) =>
      recordExecution(s, REVIEWER, {
        key: key(),
        provider: "mock",
        promptContentHash: "prompthash",
        result: {
          validationStatus: "VALID",
          output: { outcome: "POSITIVE", confidence: 0.7 },
          confidence: 0.7,
          usage: USAGE,
          costEstimate: null,
          validationError: null,
          rawOutputSha256: "rawhash",
        },
      }),
    );
    expect(res.resultId).toBeTruthy();
    resultId = res.resultId!;
    expect(res.cached).toBe(false);
  });

  it("returns the cached suggestion for the exact key (a hit)", async () => {
    const hit = await svc((s) => findCachedSuggestion(s, key()));
    expect(hit?.resultId).toBe(resultId);
    expect(hit?.validationStatus).toBe("VALID");
    expect(hit?.confidence).toBe(0.7);
    expect(hit?.usage).toEqual(USAGE);
  });

  it("isolates the cache by prompt version, model, and input hash (misses)", async () => {
    expect(await svc((s) => findCachedSuggestion(s, key({ promptVersion: "v2" })))).toBeNull();
    expect(await svc((s) => findCachedSuggestion(s, key({ model: "other-model" })))).toBeNull();
    expect(await svc((s) => findCachedSuggestion(s, key({ inputHash: "hash-bbb" })))).toBeNull();
    expect(
      await svc((s) => findCachedSuggestion(s, key({ operation: "evidence-quality" }))),
    ).toBeNull();
  });

  it("rejects a duplicate job for the same cache key", async () => {
    await expect(
      svc((s) =>
        recordExecution(s, REVIEWER, {
          key: key(),
          provider: "mock",
          promptContentHash: "prompthash",
          result: {
            validationStatus: "VALID",
            output: { outcome: "NEGATIVE", confidence: 0.5 },
            confidence: 0.5,
            usage: USAGE,
            costEstimate: null,
            validationError: null,
            rawOutputSha256: "rawhash2",
          },
        }),
      ),
    ).rejects.toMatchObject({ reason: "duplicate" });
  });

  it("keeps ai_result immutable (append-only)", async () => {
    await expect(
      svc((s) => s.query("update ai_result set confidence = 0.1 where id = $1", [resultId])),
    ).rejects.toThrow();
  });

  it("stores NULL token usage (never zero) when unreported", async () => {
    await svc((s) =>
      recordExecution(s, REVIEWER, {
        key: key({ operation: "research-summary", inputHash: "hash-sum" }),
        provider: "mock",
        promptContentHash: "ph",
        result: {
          validationStatus: "VALID",
          output: { summary: "s" },
          confidence: null,
          usage: NO_USAGE,
          costEstimate: null,
          validationError: null,
          rawOutputSha256: "rh",
        },
      }),
    );
    const hit = await svc((s) =>
      findCachedSuggestion(s, key({ operation: "research-summary", inputHash: "hash-sum" })),
    );
    expect(hit?.usage).toEqual(NO_USAGE);
    expect(hit?.costEstimate).toBeNull();
  });

  it("records a hard provider failure as a FAILED job with no result", async () => {
    const res = await svc((s) =>
      recordExecution(s, REVIEWER, {
        key: key({ operation: "evidence-quality", inputHash: "hash-fail" }),
        provider: "openai-compatible",
        promptContentHash: "ph",
        failure: { reason: "unavailable", errorDetail: "provider down", usage: NO_USAGE },
      }),
    );
    expect(res.resultId).toBeNull();
    const hit = await svc((s) =>
      findCachedSuggestion(s, key({ operation: "evidence-quality", inputHash: "hash-fail" })),
    );
    expect(hit?.jobStatus).toBe("FAILED");
    expect(hit?.errorDetail).toBe("provider down");
  });
});

describe("human decision + accept provenance", () => {
  let resultId: string;

  beforeAll(async () => {
    const res = await svc((s) =>
      recordExecution(s, REVIEWER, {
        key: key({ operation: "outcome-classification", inputHash: "hash-accept" }),
        provider: "mock",
        promptContentHash: "ph",
        result: {
          validationStatus: "VALID",
          output: { outcome: "LEANING_POSITIVE", confidence: 0.55 },
          confidence: 0.55,
          usage: USAGE,
          costEstimate: null,
          validationError: null,
          rawOutputSha256: "rh",
        },
      }),
    );
    resultId = res.resultId!;
  });

  it("reads a suggestion's task/study/output", async () => {
    const out = await svc((s) => getSuggestionOutput(s, resultId));
    expect(out?.studyId).toBe(studyId);
    expect(out?.operation).toBe("outcome-classification");
    expect(out?.validationStatus).toBe("VALID");
  });

  it("records the human decision in the append-only audit log", async () => {
    await svc((s) =>
      recordSuggestionDecision(s, REVIEWER, {
        resultId,
        studyId,
        task: "outcome-classification",
        decision: "ACCEPT",
      }),
    );
    const suggestions = await svc((s) => getStudySuggestions(s, studyId));
    const accepted = suggestions.find((x) => x.resultId === resultId);
    expect(accepted?.decision).toBe("ACCEPT");
  });

  it("writes the canonical value via the human op and records ai_result_id provenance", async () => {
    await svc((s) =>
      setOutcome(s, REVIEWER, studyId, "LEANING_POSITIVE", null, "accepted", resultId),
    );
    const row = await svc((s) =>
      s.query<{ final_value: string; ai_result_id: string | null }>(
        "select final_value, ai_result_id from classification where study_id = $1 and dimension = 'OUTCOME'",
        [studyId],
      ),
    );
    expect(row.rows[0]?.final_value).toBe("LEANING_POSITIVE");
    expect(row.rows[0]?.ai_result_id).toBe(resultId);
  });
});

describe("permissions", () => {
  it("refuses recordExecution for a non-staff actor", async () => {
    await expect(
      svc((s) =>
        recordExecution(s, PUBLIC, {
          key: key({ inputHash: "hash-forbidden" }),
          provider: "mock",
          promptContentHash: "ph",
          failure: { reason: "unavailable", errorDetail: "x", usage: NO_USAGE },
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("refuses recordSuggestionDecision for a non-staff actor", async () => {
    await expect(
      svc((s) =>
        recordSuggestionDecision(s, PUBLIC, {
          resultId: "00000000-0000-0000-0000-000000000000",
          studyId,
          task: "outcome-classification",
          decision: "REJECT",
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});
