/**
 * M7.4A — discovery candidate persistence (migration 0013 + adapter).
 *
 * Exercises the real, ordered migrations (0001→0013) on PGlite and the
 * DatabaseDiscoveryStore / DatabaseStudyIndex adapters through the M7.3
 * orchestrator. Verifies: schema/index, import_job lifecycle, candidate
 * persistence + provenance + dedup preservation, DB-enforced idempotency, the
 * NULL-identity policy, an end-to-end mock run, that NO canonical rows are
 * written, and the RLS/authorization boundary. All offline and deterministic.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runDiscovery,
  createDefaultDiscoveryRegistry,
  DiscoveryProviderRegistry,
  MockDiscoveryProvider,
  type RunDiscoveryDeps,
} from "@wise-evidence/discovery";
import { DatabaseDiscoveryStore, DatabaseStudyIndex, type Actor } from "../src/index.js";
import { createTestDatabase, type TestDatabase, type RoleScopedDb } from "./harness.js";

const REVIEWER: Actor = { id: "10000000-0000-0000-0000-000000000001", role: "REVIEWER" };
const PUBLIC_ACTOR: Actor = { id: "10000000-0000-0000-0000-0000000000bb", role: "PUBLIC" };

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await db.query(
    `insert into app_user (id, email, display_name, role)
     values ($1, 'rev@example.invalid', 'Rev', 'REVIEWER')`,
    [REVIEWER.id],
  );
});

afterEach(async () => {
  await db.close();
});

/** Build orchestrator deps whose stores are backed by the scoped DB. */
function deps(s: RoleScopedDb, overrides: Partial<RunDiscoveryDeps> = {}): RunDiscoveryDeps {
  const store = new DatabaseDiscoveryStore(s, REVIEWER);
  return {
    registry: createDefaultDiscoveryRegistry(),
    runStore: store,
    candidateStore: store,
    studyIndex: new DatabaseStudyIndex(s),
    actor: { role: "REVIEWER" },
    now: () => 1000,
    sleep: () => Promise.resolve(),
    rng: () => 0,
    ...overrides,
  };
}

describe("migration 0013 — candidate identity", () => {
  it("adds the identity columns and the partial unique index", async () => {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'import_candidate'
          and column_name in ('source_key', 'source_stable_id')`,
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["source_key", "source_stable_id"]);

    const idx = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where tablename = 'import_candidate'
          and indexname = 'import_candidate_source_identity_uniq'`,
    );
    expect(idx.rows).toHaveLength(1);
  });

  it("NULL-identity candidates never collide (partial predicate)", async () => {
    // Two candidates with NULL identity coexist (manual / DEMO candidates).
    const { rows } = await db.query<{ id: string }>(
      `insert into import_job (trigger, state) values ('MANUAL', 'RUNNING') returning id`,
    );
    const jobId = rows[0]!.id;
    await db.query(
      `insert into import_candidate (import_job_id, state) values ($1, 'REVIEW_REQUIRED')`,
      [jobId],
    );
    await db.query(
      `insert into import_candidate (import_job_id, state) values ($1, 'REVIEW_REQUIRED')`,
      [jobId],
    );
    const count = await db.query<{ n: string }>(
      `select count(*)::text as n from import_candidate where source_key is null`,
    );
    expect(Number(count.rows[0]!.n)).toBe(2);
  });

  it("rejects a duplicate (source_key, source_stable_id) at the DB level", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into import_job (trigger, state) values ('MANUAL', 'RUNNING') returning id`,
    );
    const jobId = rows[0]!.id;
    await db.query(
      `insert into import_candidate (import_job_id, source_key, source_stable_id, state)
       values ($1, 'crossref', '10.0000/dup', 'REVIEW_REQUIRED')`,
      [jobId],
    );
    await expect(
      db.query(
        `insert into import_candidate (import_job_id, source_key, source_stable_id, state)
         values ($1, 'crossref', '10.0000/dup', 'REVIEW_REQUIRED')`,
        [jobId],
      ),
    ).rejects.toThrow();
  });
});

describe("DatabaseDiscoveryStore — lifecycle & idempotency", () => {
  it("records the import_job lifecycle RUNNING → COMPLETED with counters", async () => {
    const result = await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));
    expect(result.state).toBe("COMPLETED");

    const job = await db.query<{ state: string; counts: Record<string, number> }>(
      `select state, counts from import_job where id = $1`,
      [result.runId],
    );
    expect(job.rows[0]!.state).toBe("COMPLETED");
    expect(job.rows[0]!.counts.candidates).toBe(4);
    expect(job.rows[0]!.counts.discovered).toBe(5);
  });

  it("persists candidates with provenance and preserved dedup decision", async () => {
    const result = await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));
    const cand = await db.query<{
      source_key: string;
      source_stable_id: string;
      normalized_payload: Record<string, unknown>;
      dedup_decision: string;
      state: string;
    }>(
      `select source_key, source_stable_id, normalized_payload, dedup_decision, state
         from import_candidate where source_stable_id = 'mock-0001'`,
    );
    expect(cand.rows).toHaveLength(1);
    const row = cand.rows[0]!;
    expect(row.source_key).toBe("mock");
    expect(row.state).toBe("REVIEW_REQUIRED");
    expect(row.normalized_payload.canonicalDoi).toBe("10.0000/wise.discovery.alpha");
    expect((row.normalized_payload.provenance as Record<string, unknown>).rawHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(JSON.parse(row.dedup_decision).verdict).toBe("NEW");

    // Total candidates persisted.
    const n = await db.query<{ n: string }>(
      `select count(*)::text as n from import_candidate where source_key = 'mock'`,
    );
    expect(Number(n.rows[0]!.n)).toBe(4);
    expect(result.counters.candidates).toBe(4);
  });

  it("is idempotent: re-running the same discovery creates no new candidates", async () => {
    await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));
    const second = await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));

    expect(second.counters.candidates).toBe(0);
    expect(second.counters.skipped).toBe(4);
    const n = await db.query<{ n: string }>(
      `select count(*)::text as n from import_candidate where source_key = 'mock'`,
    );
    expect(Number(n.rows[0]!.n)).toBe(4); // unchanged after the second run
  });

  it("insertCandidate is conflict-safe and preserves the existing row", async () => {
    // Two logical persistence attempts of the same identity → one row.
    await db.asServiceRole(async (s) => {
      const store = new DatabaseDiscoveryStore(s, REVIEWER);
      const { runId } = await store.createRun({
        sourceKey: "crossref",
        trigger: "MANUAL",
        startedAt: new Date(0).toISOString(),
      });
      const record = {
        runId,
        sourceKey: "crossref",
        stableSourceId: "10.0000/concurrent",
        normalizedPayload: { title: "first" },
        rawHash: "a".repeat(64),
        dedup: { verdict: "NEW", matchedBy: null, relatedStudyId: null, reason: "x" } as const,
        state: "REVIEW_REQUIRED",
      };
      const a = await store.insertCandidate(record);
      const b = await store.insertCandidate({ ...record, normalizedPayload: { title: "second" } });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.candidateId).toBe(a.candidateId);
    });
    const row = await db.query<{ normalized_payload: Record<string, unknown> }>(
      `select normalized_payload from import_candidate where source_stable_id = '10.0000/concurrent'`,
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.normalized_payload.title).toBe("first"); // not overwritten
  });
});

describe("DatabaseStudyIndex — research-level dedup preserved", () => {
  it("flags an exact-DOI match as DEFINITE and links the study (never merges)", async () => {
    const studyId = "20000000-0000-0000-0000-000000000001";
    await db.query(
      `insert into research_study (id, canonical_title, normalized_title)
       values ($1, 'Existing alpha', 'existing alpha')`,
      [studyId],
    );
    await db.query(
      `insert into research_identifier (study_id, type, value_raw, value_canonical)
       values ($1, 'DOI', '10.0000/wise.discovery.alpha', '10.0000/wise.discovery.alpha')`,
      [studyId],
    );

    const result = await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));
    expect(result.counters.duplicates).toBe(2); // mock-0001 + mock-0004 share the DOI

    const cand = await db.query<{ dedup_decision: string; duplicate_of_study_id: string }>(
      `select dedup_decision, duplicate_of_study_id
         from import_candidate where source_stable_id = 'mock-0001'`,
    );
    expect(JSON.parse(cand.rows[0]!.dedup_decision).verdict).toBe("DEFINITE_DUPLICATE");
    expect(cand.rows[0]!.duplicate_of_study_id).toBe(studyId);

    // The candidate is kept; the existing study is untouched (DUPLICATE ≠ DELETE).
    const studies = await db.query<{ n: string }>(`select count(*)::text as n from research_study`);
    expect(Number(studies.rows[0]!.n)).toBe(1);
  });
});

describe("no canonical writes (boundary)", () => {
  it("writes only import_job/import_candidate — never research_study/publication/classification", async () => {
    await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));
    for (const table of ["research_study", "publication", "classification"]) {
      const n = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
      expect(Number(n.rows[0]!.n)).toBe(0);
    }
    const cands = await db.query<{ n: string }>(`select count(*)::text as n from import_candidate`);
    expect(Number(cands.rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe("RLS / authorization boundary", () => {
  it("anon cannot read/insert/update/delete import_candidate", async () => {
    await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));
    await expect(db.asAnon((s) => s.query(`select * from import_candidate`))).rejects.toThrow();
    await expect(
      db.asAnon((s) =>
        s.query(
          `insert into import_candidate (import_job_id, source_key, source_stable_id, state)
           values (gen_random_uuid(), 'x', 'y', 'REVIEW_REQUIRED')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      db.asAnon((s) => s.query(`update import_candidate set state = 'IMPORTED'`)),
    ).rejects.toThrow();
    await expect(db.asAnon((s) => s.query(`delete from import_candidate`))).rejects.toThrow();
  });

  it("service_role can read the persisted candidates (server-side path)", async () => {
    const result = await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));
    const rows = await db.asServiceRole((s) =>
      s.query<{ id: string }>(`select id from import_candidate where import_job_id = $1`, [
        result.runId,
      ]),
    );
    expect(rows.rows.length).toBe(4);
  });

  it("the adapter refuses a non-staff actor (defense in depth over RLS)", async () => {
    await db.asServiceRole(async (s) => {
      expect(() => new DatabaseDiscoveryStore(s, PUBLIC_ACTOR)).toThrow();
    });
  });
});

describe("import_job failure state", () => {
  it("records FAILED for an unconfigured provider run", async () => {
    // A registry that only has MOCK — resolving PUBMED fails closed.
    const registry = new DiscoveryProviderRegistry().register(
      "MOCK",
      () => new MockDiscoveryProvider(),
    );
    const result = await db.asServiceRole((s) =>
      runDiscovery({ providerType: "PUBMED" }, deps(s, { registry })),
    );
    expect(result.state).toBe("FAILED");
    const job = await db.query<{ state: string }>(`select state from import_job where id = $1`, [
      result.runId,
    ]);
    expect(job.rows[0]!.state).toBe("FAILED");
  });
});
