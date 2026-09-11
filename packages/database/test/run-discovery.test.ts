/**
 * M7.8 — manual "Run discovery now" (`runManualDiscovery`).
 *
 * Exercises the ONE composition point that lets a staff user start the EXISTING
 * bounded orchestrator against the EXISTING persistence adapters, on the real
 * ordered migrations (0001→0013) via PGlite. Everything here is offline and
 * deterministic (MOCK provider / injected fake registry). No real network.
 *
 * Coverage (task M7.8 test list):
 *  - staff can start a run; PUBLIC/non-staff is refused (role never client-driven)
 *  - the EXISTING orchestrator is actually invoked (canonical MOCK counters)
 *  - candidates are persisted; idempotency holds; duplicate runs add nothing
 *  - NO canonical research_study/publication/classification rows are written
 *  - AI is never invoked (ai_job/ai_result stay empty)
 *  - the conservative DEFAULT_BUDGET is enforced (client cannot widen it)
 *  - provider errors are handled safely and do not corrupt the database
 *  - the client cannot select an unknown provider or supply a URL/host
 *  - a networked provider without injected egress fails closed (NOT_CONFIGURED)
 *  - no secret-like content leaks into the safe run result
 *  - the actor written to the audit trail is the server actor, not a client value
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DiscoveryProviderRegistry,
  MockDiscoveryProvider,
  type MockDiscoveryDataset,
  type RawMockItem,
} from "@wise-evidence/discovery";
import {
  runManualDiscovery,
  parseManualDiscoveryProvider,
  MANUAL_DISCOVERY_PROVIDERS,
  type Actor,
  ServiceError,
} from "../src/index.js";
import { createTestDatabase, type TestDatabase } from "./harness.js";

const REVIEWER: Actor = { id: "10000000-0000-0000-0000-000000000001", role: "REVIEWER" };
const ADMIN: Actor = { id: "10000000-0000-0000-0000-000000000002", role: "ADMIN" };
const PUBLIC_ACTOR: Actor = { id: "10000000-0000-0000-0000-0000000000bb", role: "PUBLIC" };

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

/** Deterministic composition deps (no real timers / randomness). */
const DET = { now: () => 1000, sleep: () => Promise.resolve(), rng: () => 0 } as const;

/** Build a large dataset of DISTINCT items to probe budget enforcement. */
function bigDataset(pages: number, perPage: number): MockDiscoveryDataset {
  const out: RawMockItem[][] = [];
  let n = 0;
  for (let p = 0; p < pages; p += 1) {
    const page: RawMockItem[] = [];
    for (let i = 0; i < perPage; i += 1) {
      n += 1;
      page.push({
        sourceId: `budget-${n}`,
        title: `Budget study number ${n}`,
        doi: `10.1234/budget.${n}`,
        identifiers: [{ type: "DOI", value: `10.1234/budget.${n}` }],
        authors: ["A. Author"],
        journal: "Journal of Budgets",
        publicationDate: "2020-01-01",
      });
    }
    out.push(page);
  }
  return { pages: out };
}

describe("parseManualDiscoveryProvider — closed allowlist (no arbitrary URL/provider)", () => {
  it("accepts every allowlisted provider (case-insensitive)", () => {
    for (const p of MANUAL_DISCOVERY_PROVIDERS) {
      expect(parseManualDiscoveryProvider(p)).toBe(p);
      expect(parseManualDiscoveryProvider(p.toLowerCase())).toBe(p);
    }
  });

  it("rejects unknown providers, URLs, and empty input", () => {
    for (const bad of [
      "",
      "  ",
      "FOO",
      "http://evil.example/api",
      "https://api.crossref.org",
      "MOCK; DROP TABLE",
      "../../etc/passwd",
    ]) {
      expect(() => parseManualDiscoveryProvider(bad)).toThrow(ServiceError);
    }
  });
});

describe("authorization — role comes from the server actor, never the client", () => {
  it("a reviewer can start a run", async () => {
    const result = await db.asServiceRole((s) =>
      runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, DET),
    );
    expect(result.state).toBe("COMPLETED");
  });

  it("an admin can start a run", async () => {
    const result = await db.asServiceRole((s) =>
      runManualDiscovery(s, ADMIN, { provider: "MOCK" }, DET),
    );
    expect(result.state).toBe("COMPLETED");
  });

  it("a PUBLIC/non-staff actor is refused before any run row is created", async () => {
    await db.asServiceRole(async (s) => {
      await expect(runManualDiscovery(s, PUBLIC_ACTOR, { provider: "MOCK" }, DET)).rejects.toThrow(
        ServiceError,
      );
    });
    const jobs = await db.query<{ n: string }>(`select count(*)::text as n from import_job`);
    expect(Number(jobs.rows[0]!.n)).toBe(0);
    const cands = await db.query<{ n: string }>(`select count(*)::text as n from import_candidate`);
    expect(Number(cands.rows[0]!.n)).toBe(0);
  });
});

describe("invokes the existing orchestrator and persists candidates", () => {
  it("a MOCK run yields the orchestrator's canonical counters and persists candidates", async () => {
    const result = await db.asServiceRole((s) =>
      runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, DET),
    );
    // These exact counts come only from the real orchestrator + MOCK fixtures.
    expect(result.trigger).toBe("MANUAL");
    expect(result.counters.discovered).toBe(5);
    expect(result.counters.candidates).toBe(4);

    const cands = await db.query<{ n: string }>(
      `select count(*)::text as n from import_candidate where source_key = 'mock'`,
    );
    expect(Number(cands.rows[0]!.n)).toBe(4);

    // The run is recorded as a MANUAL import_job.
    const job = await db.query<{ state: string; trigger: string }>(
      `select state, trigger from import_job where id = $1`,
      [result.runId],
    );
    expect(job.rows[0]!.state).toBe("COMPLETED");
    expect(job.rows[0]!.trigger).toBe("MANUAL");
  });

  it("re-running the same discovery creates no new candidates (idempotency preserved)", async () => {
    await db.asServiceRole((s) => runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, DET));
    const second = await db.asServiceRole((s) =>
      runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, DET),
    );
    expect(second.counters.candidates).toBe(0);
    expect(second.counters.skipped).toBe(4);
    const n = await db.query<{ n: string }>(
      `select count(*)::text as n from import_candidate where source_key = 'mock'`,
    );
    expect(Number(n.rows[0]!.n)).toBe(4);
  });

  it("records the SERVER actor on the audit trail (client cannot impersonate)", async () => {
    await db.asServiceRole((s) => runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, DET));
    const audit = await db.query<{ actor: string }>(
      `select distinct actor from audit_log where action like 'discovery_%'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const row of audit.rows) expect(row.actor).toBe(REVIEWER.id);
  });
});

describe("locked boundaries — discovery is never authority", () => {
  it("writes NO canonical research_study / publication / classification", async () => {
    await db.asServiceRole((s) => runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, DET));
    for (const table of ["research_study", "publication", "classification"]) {
      const n = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
      expect(Number(n.rows[0]!.n)).toBe(0);
    }
  });

  it("never invokes AI (ai_job / ai_result stay empty)", async () => {
    await db.asServiceRole((s) => runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, DET));
    for (const table of ["ai_job", "ai_result"]) {
      const n = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
      expect(Number(n.rows[0]!.n)).toBe(0);
    }
  });
});

describe("budget — the conservative default is enforced (client cannot widen it)", () => {
  it("caps a huge source to DEFAULT_BUDGET (maxPages 5, maxItems 100)", async () => {
    const registry = new DiscoveryProviderRegistry().register(
      "MOCK",
      () => new MockDiscoveryProvider({ dataset: bigDataset(10, 20) }),
    );
    const result = await db.asServiceRole((s) =>
      runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, { ...DET, registry }),
    );
    expect(result.counters.pages).toBeLessThanOrEqual(5);
    expect(result.counters.discovered).toBeLessThanOrEqual(100);
    expect(result.counters.candidates).toBeLessThanOrEqual(100);
    // The 200-item source was NOT drained — the run stopped at the budget, so it
    // can never be unbounded regardless of how large the source is.
    expect(result.counters.discovered).toBeLessThan(200);
    // Persisted candidates never exceed the budget either.
    const n = await db.query<{ n: string }>(`select count(*)::text as n from import_candidate`);
    expect(Number(n.rows[0]!.n)).toBeLessThanOrEqual(100);
  });
});

describe("provider errors are handled safely and never corrupt the database", () => {
  it("a rate-limited source ends FAILED with no candidates and a recorded FAILED job", async () => {
    const registry = new DiscoveryProviderRegistry().register(
      "MOCK",
      () => new MockDiscoveryProvider({ maxDiscoverCalls: 0 }), // first discover → RATE_LIMITED
    );
    const result = await db.asServiceRole((s) =>
      runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, { ...DET, registry }),
    );
    expect(result.state).toBe("FAILED");
    expect(result.counters.candidates).toBe(0);

    const job = await db.query<{ state: string }>(`select state from import_job where id = $1`, [
      result.runId,
    ]);
    expect(job.rows[0]!.state).toBe("FAILED");
    const cands = await db.query<{ n: string }>(`select count(*)::text as n from import_candidate`);
    expect(Number(cands.rows[0]!.n)).toBe(0);
  });

  it("a networked provider without injected egress fails closed (NOT_CONFIGURED)", async () => {
    // The default registry is used but NO fetch is injected → CROSSREF cannot run.
    const result = await db.asServiceRole((s) =>
      runManualDiscovery(s, REVIEWER, { provider: "CROSSREF" }, DET),
    );
    expect(result.state).toBe("FAILED");
    expect(result.counters.candidates).toBe(0);
    // The failure is a safe, typed reason — never a leaked internal.
    expect(result.errors.some((e) => e.code === "NOT_CONFIGURED")).toBe(true);
  });

  it("no secret-like content appears in the safe run result", async () => {
    const registry = new DiscoveryProviderRegistry().register(
      "MOCK",
      () => new MockDiscoveryProvider({ maxDiscoverCalls: 0 }),
    );
    const result = await db.asServiceRole((s) =>
      runManualDiscovery(s, REVIEWER, { provider: "MOCK" }, { ...DET, registry }),
    );
    const serialized = JSON.stringify(result).toLowerCase();
    for (const needle of ["password", "secret", "api_key", "apikey", "bearer", "authorization"]) {
      expect(serialized).not.toContain(needle);
    }
  });
});
