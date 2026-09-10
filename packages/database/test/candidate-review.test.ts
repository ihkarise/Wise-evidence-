/**
 * M7.4B — discovery candidate review workflow.
 *
 * Exercises the real, ordered migrations (0001→0013) on PGlite and the
 * `service/candidates.ts` operations end-to-end: candidates are first produced by
 * a real M7.3 mock discovery run (through the M7.4A adapter), then reviewed. It
 * verifies list/detail reads, staff/admin/anonymous authorization, accept (→ DRAFT
 * only), reject, link-duplicate, correction, refetch, defer, idempotency,
 * provenance preservation, audit entries, and the LOCKED boundaries: accept never
 * publishes, never classifies, never invokes AI, and never deletes a candidate.
 *
 * All offline and deterministic.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runDiscovery,
  createDefaultDiscoveryRegistry,
  type RunDiscoveryDeps,
} from "@wise-evidence/discovery";
import {
  DatabaseDiscoveryStore,
  DatabaseStudyIndex,
  listCandidates,
  getCandidateDetail,
  acceptCandidate,
  rejectCandidate,
  linkCandidateDuplicate,
  correctCandidate,
  requestCandidateRefetch,
  deferCandidate,
  type Actor,
} from "../src/index.js";
import { createTestDatabase, type TestDatabase, type RoleScopedDb } from "./harness.js";

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

/** Build orchestrator deps whose stores are backed by the scoped DB. */
function deps(s: RoleScopedDb): RunDiscoveryDeps {
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
  };
}

/** Run a mock discovery to seed candidates, returning the run id. */
async function seedCandidates(): Promise<string> {
  const result = await db.asServiceRole((s) => runDiscovery({ providerType: "MOCK" }, deps(s)));
  expect(result.state).toBe("COMPLETED");
  return result.runId;
}

/** The candidate id for a given stable source id. */
async function candidateIdFor(stableSourceId: string): Promise<string> {
  const row = await db.query<{ id: string }>(
    `select id from import_candidate where source_stable_id = $1`,
    [stableSourceId],
  );
  const id = row.rows[0]?.id;
  expect(id, `candidate for ${stableSourceId}`).toBeTruthy();
  return id!;
}

async function candidateState(id: string): Promise<string> {
  const row = await db.query<{ state: string }>(
    `select state from import_candidate where id = $1`,
    [id],
  );
  return row.rows[0]!.state;
}

async function auditActions(entityId: string): Promise<string[]> {
  const rows = await db.query<{ action: string }>(
    `select action from audit_log where entity = 'import_candidate' and entity_id = $1 order by created_at`,
    [entityId],
  );
  return rows.rows.map((r) => r.action);
}

// --- reads -------------------------------------------------------------------

describe("candidate list & detail", () => {
  it("lists discovery candidates for staff, newest first, with a safe summary", async () => {
    await seedCandidates();
    const list = await db.asServiceRole((s) => listCandidates(s, REVIEWER));
    expect(list.length).toBe(4);
    for (const c of list) {
      expect(c.sourceKey).toBe("mock");
      expect(typeof c.id).toBe("string");
      // No classification/outcome/efficacy fields leak into the list shape.
      expect(c).not.toHaveProperty("outcome");
    }
  });

  it("filters by state", async () => {
    await seedCandidates();
    const review = await db.asServiceRole((s) =>
      listCandidates(s, REVIEWER, { state: "REVIEW_REQUIRED" }),
    );
    expect(review.every((c) => c.state === "REVIEW_REQUIRED")).toBe(true);
  });

  it("returns full detail including provenance and dedup", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0001");
    const detail = await db.asServiceRole((s) => getCandidateDetail(s, REVIEWER, id));
    expect(detail).not.toBeNull();
    expect(detail!.payload?.canonicalDoi).toBe("10.0000/wise.discovery.alpha");
    expect(detail!.payload?.provenance?.rawHash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail!.sourceStableId).toBe("mock-0001");
    expect(detail!.job?.sourceName).toBe("Automated discovery (mock)");
  });

  it("detail returns null for a non-existent id", async () => {
    const detail = await db.asServiceRole((s) =>
      getCandidateDetail(s, REVIEWER, "99999999-0000-0000-0000-000000000000"),
    );
    expect(detail).toBeNull();
  });
});

// --- authorization -----------------------------------------------------------

describe("authorization", () => {
  it("reviewer and admin may list; PUBLIC is refused (forbidden)", async () => {
    await seedCandidates();
    await expect(db.asServiceRole((s) => listCandidates(s, REVIEWER))).resolves.toBeTruthy();
    await expect(db.asServiceRole((s) => listCandidates(s, ADMIN))).resolves.toBeTruthy();
    await expect(db.asServiceRole((s) => listCandidates(s, PUBLIC_ACTOR))).rejects.toMatchObject({
      reason: "forbidden",
    });
  });

  it("every mutating op refuses a non-staff actor", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0002");
    await db.asServiceRole(async (s) => {
      await expect(acceptCandidate(s, PUBLIC_ACTOR, id)).rejects.toMatchObject({
        reason: "forbidden",
      });
      await expect(rejectCandidate(s, PUBLIC_ACTOR, id, "x")).rejects.toMatchObject({
        reason: "forbidden",
      });
      await expect(linkCandidateDuplicate(s, PUBLIC_ACTOR, id, ADMIN.id)).rejects.toMatchObject({
        reason: "forbidden",
      });
      await expect(
        correctCandidate(s, PUBLIC_ACTOR, id, { field: "title", proposedValue: "y" }),
      ).rejects.toMatchObject({ reason: "forbidden" });
      await expect(requestCandidateRefetch(s, PUBLIC_ACTOR, id)).rejects.toMatchObject({
        reason: "forbidden",
      });
      await expect(deferCandidate(s, PUBLIC_ACTOR, id)).rejects.toMatchObject({
        reason: "forbidden",
      });
    });
    // Nothing changed.
    expect(await candidateState(id)).toBe("REVIEW_REQUIRED");
  });

  it("anonymous role cannot read import_candidate at all (RLS authoritative)", async () => {
    await seedCandidates();
    await expect(db.asAnon((s) => s.query(`select * from import_candidate`))).rejects.toThrow();
    await expect(
      db.asAnon((s) => s.query(`update import_candidate set state = 'IMPORTED'`)),
    ).rejects.toThrow();
    await expect(db.asAnon((s) => s.query(`delete from import_candidate`))).rejects.toThrow();
  });

  it("a signed-in reviewer can read candidates through RLS (authenticated path)", async () => {
    await seedCandidates();
    const rows = await db.asUser(REVIEWER.id, (s) =>
      s.query<{ id: string }>(`select id from import_candidate`),
    );
    expect(rows.rows.length).toBe(4);
  });
});

// --- accept ------------------------------------------------------------------

describe("accept", () => {
  it("creates a DRAFT/IMPORTED research record and marks the candidate IMPORTED", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0001");
    const result = await db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id));
    expect(result.created).toBe(true);

    const study = await db.query<{ lifecycle_state: string; publication_state: string }>(
      `select lifecycle_state, publication_state from research_study where id = $1`,
      [result.studyId],
    );
    expect(study.rows[0]!.lifecycle_state).toBe("IMPORTED");
    expect(study.rows[0]!.publication_state).toBe("DRAFT");
    expect(await candidateState(id)).toBe("IMPORTED");
  });

  it("preserves provenance: the draft reuses the discovery research_source and DOI", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0001");
    const { studyId } = await db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id));

    // The publication's source is the SAME discovery source as the import_job.
    const link = await db.query<{ same: boolean }>(
      `select (p.source_id = j.source_id) as same
         from publication p
         join import_candidate c on c.id = $1
         join import_job j on j.id = c.import_job_id
        where p.study_id = $2 and p.is_primary = true`,
      [id, studyId],
    );
    expect(link.rows[0]!.same).toBe(true);

    // The candidate's stable DOI == the study's canonical identifier (queryable link).
    const ident = await db.query<{ n: string }>(
      `select count(*)::text as n
         from research_identifier ri
        where ri.publication_id in (select id from publication where study_id = $1)
          and ri.value_canonical = (
                select normalized_payload->>'canonicalDoi'
                  from import_candidate where id = $2)`,
      [studyId, id],
    );
    expect(Number(ident.rows[0]!.n)).toBe(1);
  });

  it("writes an append-only audit entry linking the candidate to the created study", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0001");
    const { studyId } = await db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id));
    const audit = await db.query<{ action: string; after: Record<string, unknown> }>(
      `select action, after from audit_log
        where entity = 'import_candidate' and entity_id = $1 and action = 'candidate_accepted'`,
      [id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.after.studyId).toBe(studyId);
  });

  it("does NOT publish and does NOT create any classification on accept", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0001");
    const { studyId } = await db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id));

    const pubState = await db.query<{ publication_state: string }>(
      `select publication_state from research_study where id = $1`,
      [studyId],
    );
    expect(pubState.rows[0]!.publication_state).not.toBe("PUBLISHED");

    const cls = await db.query<{ n: string }>(
      `select count(*)::text as n from classification where study_id = $1`,
      [studyId],
    );
    expect(Number(cls.rows[0]!.n)).toBe(0);
  });

  it("invokes no AI: no ai_job / ai_result rows are produced by review", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0001");
    await db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id));
    for (const table of ["ai_job", "ai_result"]) {
      const n = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
      expect(Number(n.rows[0]!.n)).toBe(0);
    }
  });

  it("re-accepting an already-imported candidate is refused (invalid-state); no duplicate study", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0001");
    await db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id));
    await expect(db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id))).rejects.toMatchObject({
      reason: "invalid-state",
    });

    const studies = await db.query<{ n: string }>(`select count(*)::text as n from research_study`);
    expect(Number(studies.rows[0]!.n)).toBe(1);
  });

  it("when a study already owns the DOI, accept links a duplicate instead of creating a second study", async () => {
    // Pre-seed a study owning mock-0002's DOI.
    const existingStudy = "20000000-0000-0000-0000-000000000009";
    await db.query(
      `insert into research_study (id, canonical_title, normalized_title, lifecycle_state, publication_state)
       values ($1, 'Existing alpha', 'existing alpha', 'IMPORTED', 'DRAFT')`,
      [existingStudy],
    );
    await db.query(
      `insert into research_identifier (study_id, type, value_raw, value_canonical)
       values ($1, 'DOI', '10.0000/wise.discovery.alpha', '10.0000/wise.discovery.alpha')`,
      [existingStudy],
    );
    await seedCandidates();
    const id = await candidateIdFor("mock-0001");
    const result = await db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id));
    expect(result.created).toBe(false);
    expect(result.studyId).toBe(existingStudy);
    expect(await candidateState(id)).toBe("DUPLICATE_CANDIDATE");

    const studies = await db.query<{ n: string }>(`select count(*)::text as n from research_study`);
    expect(Number(studies.rows[0]!.n)).toBe(1); // no second study created
  });
});

// --- reject ------------------------------------------------------------------

describe("reject", () => {
  it("moves the candidate to FAILED with a reason and never deletes it", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0002");
    await db.asServiceRole((s) => rejectCandidate(s, REVIEWER, id, "off-topic"));
    const row = await db.query<{ state: string; error_detail: string }>(
      `select state, error_detail from import_candidate where id = $1`,
      [id],
    );
    expect(row.rows).toHaveLength(1); // still present
    expect(row.rows[0]!.state).toBe("FAILED");
    expect(row.rows[0]!.error_detail).toBe("off-topic");
    expect(await auditActions(id)).toContain("candidate_rejected");
  });

  it("a rejected candidate cannot then be accepted (invalid-state)", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0002");
    await db.asServiceRole((s) => rejectCandidate(s, REVIEWER, id, "off-topic"));
    await expect(db.asServiceRole((s) => acceptCandidate(s, REVIEWER, id))).rejects.toMatchObject({
      reason: "invalid-state",
    });
  });
});

// --- link duplicate ----------------------------------------------------------

describe("link duplicate", () => {
  it("links the candidate to a validated study and keeps it reviewable", async () => {
    const study = "20000000-0000-0000-0000-000000000010";
    await db.query(
      `insert into research_study (id, canonical_title, normalized_title)
       values ($1, 'Some study', 'some study')`,
      [study],
    );
    await seedCandidates();
    const id = await candidateIdFor("mock-0002");
    await db.asServiceRole((s) => linkCandidateDuplicate(s, REVIEWER, id, study));
    const row = await db.query<{ state: string; duplicate_of_study_id: string }>(
      `select state, duplicate_of_study_id from import_candidate where id = $1`,
      [id],
    );
    expect(row.rows[0]!.state).toBe("DUPLICATE_CANDIDATE");
    expect(row.rows[0]!.duplicate_of_study_id).toBe(study);
  });

  it("refuses an unknown study (not-found) and an invalid id (invalid-input)", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0002");
    await db.asServiceRole(async (s) => {
      await expect(
        linkCandidateDuplicate(s, REVIEWER, id, "20000000-0000-0000-0000-0000000000ff"),
      ).rejects.toMatchObject({ reason: "not-found" });
      await expect(linkCandidateDuplicate(s, REVIEWER, id, "not-a-uuid")).rejects.toMatchObject({
        reason: "invalid-input",
      });
    });
  });
});

// --- correction --------------------------------------------------------------

describe("correction", () => {
  it("records a correction via the existing correction table without mutating the payload", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0002");
    const before = await db.query<{ normalized_payload: Record<string, unknown> }>(
      `select normalized_payload from import_candidate where id = $1`,
      [id],
    );
    const { correctionId } = await db.asServiceRole((s) =>
      correctCandidate(s, REVIEWER, id, {
        field: "title",
        proposedValue: "Corrected title",
        reason: "typo",
      }),
    );
    const corr = await db.query<{ target_type: string; target_id: string; status: string }>(
      `select target_type, target_id, status from correction where id = $1`,
      [correctionId],
    );
    expect(corr.rows[0]!.target_type).toBe("import_candidate");
    expect(corr.rows[0]!.target_id).toBe(id);
    expect(corr.rows[0]!.status).toBe("OPEN");

    // Candidate payload is unchanged (provenance preserved).
    const after = await db.query<{ normalized_payload: Record<string, unknown> }>(
      `select normalized_payload from import_candidate where id = $1`,
      [id],
    );
    expect(after.rows[0]!.normalized_payload).toEqual(before.rows[0]!.normalized_payload);
    // The correction is surfaced on the detail view.
    const detail = await db.asServiceRole((s) => getCandidateDetail(s, REVIEWER, id));
    expect(detail!.corrections.some((c) => c.id === correctionId)).toBe(true);
  });
});

// --- refetch & defer ---------------------------------------------------------

describe("refetch & defer (no side effects beyond audit)", () => {
  it("refetch records a request but performs no fetch and no state change", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0002");
    await db.asServiceRole((s) => requestCandidateRefetch(s, REVIEWER, id));
    expect(await candidateState(id)).toBe("REVIEW_REQUIRED");
    expect(await auditActions(id)).toContain("candidate_refetch_requested");
  });

  it("defer keeps the candidate in the queue and records a note", async () => {
    await seedCandidates();
    const id = await candidateIdFor("mock-0002");
    await db.asServiceRole((s) => deferCandidate(s, REVIEWER, id, "revisit later"));
    expect(await candidateState(id)).toBe("REVIEW_REQUIRED");
    expect(await auditActions(id)).toContain("candidate_deferred");
  });
});

// --- boundaries across the whole review path ---------------------------------

describe("boundaries", () => {
  it("the full review path never publishes anything", async () => {
    await seedCandidates();
    const accept = await candidateIdFor("mock-0001");
    const reject = await candidateIdFor("mock-0003");
    await db.asServiceRole(async (s) => {
      await acceptCandidate(s, REVIEWER, accept);
      await rejectCandidate(s, REVIEWER, reject, "no");
    });
    const published = await db.query<{ n: string }>(
      `select count(*)::text as n from research_study where publication_state = 'PUBLISHED'`,
    );
    expect(Number(published.rows[0]!.n)).toBe(0);
  });

  it("accept refuses a candidate whose payload has no DOI (invalid-input)", async () => {
    // Manually craft a discovery-shaped candidate with no canonical DOI.
    const job = await db.query<{ id: string }>(
      `insert into import_job (trigger, state) values ('MANUAL', 'RUNNING') returning id`,
    );
    const jobId = job.rows[0]!.id;
    const cand = await db.query<{ id: string }>(
      `insert into import_candidate (import_job_id, source_key, source_stable_id, normalized_payload, state)
       values ($1, 'mock', 'no-doi-1', $2::jsonb, 'REVIEW_REQUIRED') returning id`,
      [jobId, JSON.stringify({ canonicalDoi: null, title: "No DOI here", authors: [] })],
    );
    await expect(
      db.asServiceRole((s) => acceptCandidate(s, REVIEWER, cand.rows[0]!.id)),
    ).rejects.toMatchObject({ reason: "invalid-input" });
  });
});
