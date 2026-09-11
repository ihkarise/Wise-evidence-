/**
 * M7.9 — SCHEDULED discovery (`runScheduledDiscovery`) + the overlap guard.
 *
 * Exercises the SCHEDULED entry point on the real ordered migrations
 * (0001→0013) via PGlite. It reuses the EXACT M7.8 composition (same
 * orchestrator, registry, persistence adapters, closed allowlist, conservative
 * DEFAULT_BUDGET) and differs only in the recorded `trigger` and the overlap
 * guard. Everything here is offline and deterministic (MOCK provider). No real
 * network, no scheduler — a run happens only when the function is called.
 *
 * Coverage (task M7.9 test list):
 *  - a scheduled run is recorded as a SCHEDULED import_job and enqueues candidates
 *  - the overlap guard refuses a scheduled run while one is in progress, with NO
 *    new run row created (a manual run is NOT blocked — M7.8 behaviour preserved)
 *  - a non-staff actor is refused before any run row is created
 *  - idempotency: a repeat scheduled run adds no new candidates
 *  - NO canonical research_study/publication/classification rows are written
 *  - AI is never invoked (ai_job/ai_result stay empty)
 *  - a FAILED scheduled run leaves no phantom RUNNING lock (fail closed)
 *  - no secret-like content leaks into the safe run result
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runScheduledDiscovery,
  runManualDiscovery,
  type Actor,
  ServiceError,
} from "../src/index.js";
import { createTestDatabase, type TestDatabase } from "./harness.js";

const REVIEWER: Actor = { id: "10000000-0000-0000-0000-000000000001", role: "REVIEWER" };
const ADMIN: Actor = { id: "10000000-0000-0000-0000-000000000002", role: "ADMIN" };
const PUBLIC_ACTOR: Actor = { id: "10000000-0000-0000-0000-0000000000bb", role: "PUBLIC" };

/** Deterministic composition deps (no real timers / randomness). */
const DET = { now: () => 1000, sleep: () => Promise.resolve(), rng: () => 0 } as const;

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await db.query(
    `insert into app_user (id, email, display_name, role) values
       ($1, 'rev@example.invalid', 'Rev', 'REVIEWER'),
       ($2, 'adm@example.invalid', 'Adm', 'ADMIN')`,
    [REVIEWER.id, ADMIN.id],
  );
});

afterEach(async () => {
  await db.close();
});

async function count(table: string): Promise<number> {
  const r = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number(r.rows[0]!.n);
}

async function mockSourceId(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `select id from research_source where name = $1 limit 1`,
    ["Automated discovery (mock)"],
  );
  return r.rows[0]!.id;
}

describe("scheduled run — recorded as SCHEDULED, enqueues reviewable candidates", () => {
  it("a MOCK scheduled run completes and persists candidates as trigger=SCHEDULED", async () => {
    const result = await db.asServiceRole((s) =>
      runScheduledDiscovery(s, ADMIN, { provider: "MOCK", query: "homeopathy" }, DET),
    );
    expect(result.state).toBe("COMPLETED");
    expect(result.trigger).toBe("SCHEDULED");
    expect(result.counters.candidates).toBe(4);

    const job = await db.query<{ state: string; trigger: string }>(
      `select state, trigger from import_job where id = $1`,
      [result.runId],
    );
    expect(job.rows[0]!.state).toBe("COMPLETED");
    expect(job.rows[0]!.trigger).toBe("SCHEDULED");
    expect(await count("import_candidate")).toBe(4);
  });

  it("records the SERVER actor on the audit trail (never client-driven)", async () => {
    await db.asServiceRole((s) => runScheduledDiscovery(s, ADMIN, { provider: "MOCK" }, DET));
    const audit = await db.query<{ actor: string }>(
      `select distinct actor from audit_log where action like 'discovery_%'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const row of audit.rows) expect(row.actor).toBe(ADMIN.id);
  });
});

describe("overlap guard — a scheduled run never piles onto an in-progress run", () => {
  it("refuses a scheduled run while one is RUNNING, creating NO new run row", async () => {
    // First scheduled run creates the 'mock' source and completes.
    await db.asServiceRole((s) => runScheduledDiscovery(s, ADMIN, { provider: "MOCK" }, DET));
    const sourceId = await mockSourceId();

    // Simulate an in-progress run for this source.
    await db.query(
      `insert into import_job (source_id, trigger, state, started_at)
       values ($1, 'SCHEDULED', 'RUNNING', now())`,
      [sourceId],
    );
    const before = await count("import_job");

    await db.asServiceRole(async (s) => {
      await expect(
        runScheduledDiscovery(s, ADMIN, { provider: "MOCK" }, DET),
      ).rejects.toMatchObject({ reason: "invalid-state" });
    });

    // No new import_job was created for the refused scheduled run.
    expect(await count("import_job")).toBe(before);
  });

  it("does NOT block a MANUAL run (M7.8 behaviour is unchanged)", async () => {
    await db.asServiceRole((s) => runScheduledDiscovery(s, ADMIN, { provider: "MOCK" }, DET));
    const sourceId = await mockSourceId();
    await db.query(
      `insert into import_job (source_id, trigger, state, started_at)
       values ($1, 'SCHEDULED', 'RUNNING', now())`,
      [sourceId],
    );

    // A manual run is intentionally not guarded and still succeeds.
    const manual = await db.asServiceRole((s) =>
      runManualDiscovery(s, ADMIN, { provider: "MOCK" }, DET),
    );
    expect(manual.state).toBe("COMPLETED");
    expect(manual.trigger).toBe("MANUAL");
  });
});

describe("authorization + idempotency + locked boundaries (scheduled)", () => {
  it("refuses a non-staff actor before any run row is created", async () => {
    await db.asServiceRole(async (s) => {
      await expect(
        runScheduledDiscovery(s, PUBLIC_ACTOR, { provider: "MOCK" }, DET),
      ).rejects.toThrow(ServiceError);
    });
    expect(await count("import_job")).toBe(0);
    expect(await count("import_candidate")).toBe(0);
  });

  it("a repeat scheduled run adds no new candidates (idempotency preserved)", async () => {
    await db.asServiceRole((s) => runScheduledDiscovery(s, ADMIN, { provider: "MOCK" }, DET));
    const second = await db.asServiceRole((s) =>
      runScheduledDiscovery(s, REVIEWER, { provider: "MOCK" }, DET),
    );
    expect(second.counters.candidates).toBe(0);
    expect(second.counters.skipped).toBe(4);
    expect(await count("import_candidate")).toBe(4);
  });

  it("writes NO canonical research_study/publication/classification and never calls AI", async () => {
    await db.asServiceRole((s) => runScheduledDiscovery(s, ADMIN, { provider: "MOCK" }, DET));
    for (const table of [
      "research_study",
      "publication",
      "classification",
      "ai_job",
      "ai_result",
    ]) {
      expect(await count(table)).toBe(0);
    }
  });
});

describe("failure handling — a failed scheduled run leaves no phantom lock", () => {
  it("a networked provider without egress fails closed and holds no RUNNING job", async () => {
    // CROSSREF with no injected fetch → NOT_CONFIGURED → FAILED run.
    const result = await db.asServiceRole((s) =>
      runScheduledDiscovery(s, ADMIN, { provider: "CROSSREF" }, DET),
    );
    expect(result.state).toBe("FAILED");
    expect(result.counters.candidates).toBe(0);

    // The failed run's import_job is FAILED (finalized), never left RUNNING — so
    // it can never permanently block future scheduled runs.
    const running = await db.query<{ n: string }>(
      `select count(*)::text as n from import_job where state = 'RUNNING'`,
    );
    expect(Number(running.rows[0]!.n)).toBe(0);

    // A subsequent scheduled run of a different source is therefore not blocked.
    const next = await db.asServiceRole((s) =>
      runScheduledDiscovery(s, ADMIN, { provider: "MOCK" }, DET),
    );
    expect(next.state).toBe("COMPLETED");
  });

  it("no secret-like content appears in the safe run result", async () => {
    const result = await db.asServiceRole((s) =>
      runScheduledDiscovery(s, ADMIN, { provider: "CROSSREF" }, DET),
    );
    const serialized = JSON.stringify(result).toLowerCase();
    for (const needle of ["password", "secret", "api_key", "apikey", "bearer", "authorization"]) {
      expect(serialized).not.toContain(needle);
    }
  });
});
