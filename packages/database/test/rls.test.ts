/**
 * Row-Level Security boundary tests (docs/16 §4, docs/20 §3).
 *
 * The database is the authoritative security boundary. These tests exercise the
 * SAME policies that deploy to Supabase, via the anon / authenticated /
 * service_role roles the test shim recreates. They verify: anon reads only
 * published research; private tables are hidden from anon; a non-staff
 * authenticated user still sees only published data; a reviewer sees drafts;
 * and no unauthorized role can mutate protected data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./harness.js";

const REVIEWER_ID = "10000000-0000-0000-0000-000000000001"; // seeded app_user
const STRANGER_ID = "99999999-9999-9999-9999-999999999999"; // authenticated, no app_user row
const DRAFT_STUDY = "20000000-0000-0000-0000-000000000009";
const PUBLISHED_POSITIVE = "20000000-0000-0000-0000-000000000001";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
});
afterAll(async () => {
  await db.close();
});

describe("public (anon) read path", () => {
  it("sees published studies but not drafts", async () => {
    const rows = await db.asAnon((s) =>
      s.query<{ id: string; publication_state: string }>(
        "select id, publication_state from research_study",
      ),
    );
    const states = new Set(rows.rows.map((r) => r.publication_state));
    expect(states).toEqual(new Set(["PUBLISHED"]));
    expect(rows.rows.some((r) => r.id === DRAFT_STUDY)).toBe(false);
  });

  it("cannot see a draft study's publications", async () => {
    const rows = await db.asAnon((s) =>
      s.query<{ n: string }>("select count(*)::text n from publication where study_id = $1", [
        DRAFT_STUDY,
      ]),
    );
    expect(rows.rows[0]?.n).toBe("0");
  });

  it("sees only human-reviewed (non-null) classifications on published studies", async () => {
    const rows = await db.asAnon((s) =>
      s.query<{ n: string }>(
        "select count(*)::text n from classification where final_value is null",
      ),
    );
    expect(rows.rows[0]?.n).toBe("0");
  });

  it("is hard-denied on private tables (ai_result, review, audit_log, app_user)", async () => {
    // No SELECT grant to anon → the query errors rather than returning rows.
    for (const table of ["ai_result", "review", "audit_log", "app_user", "import_candidate"]) {
      await expect(
        db.asAnon((s) => s.query(`select * from ${table}`)),
        `anon should not read ${table}`,
      ).rejects.toThrow();
    }
  });
});

describe("authenticated non-staff user", () => {
  it("still sees only published research (no elevated access)", async () => {
    const rows = await db.asUser(STRANGER_ID, (s) =>
      s.query<{ publication_state: string }>("select publication_state from research_study"),
    );
    expect(new Set(rows.rows.map((r) => r.publication_state))).toEqual(new Set(["PUBLISHED"]));
  });

  it("cannot read private AI results", async () => {
    const rows = await db.asUser(STRANGER_ID, (s) =>
      s.query<{ n: string }>("select count(*)::text n from ai_result"),
    );
    expect(rows.rows[0]?.n).toBe("0");
  });
});

describe("reviewer (staff) read path", () => {
  it("sees draft studies too", async () => {
    const rows = await db.asUser(REVIEWER_ID, (s) =>
      s.query<{ id: string }>("select id from research_study where id = $1", [DRAFT_STUDY]),
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("can read AI results and audit history", async () => {
    const ai = await db.asUser(REVIEWER_ID, (s) =>
      s.query<{ n: string }>("select count(*)::text n from ai_result"),
    );
    expect(Number(ai.rows[0]?.n)).toBeGreaterThan(0);
    const audit = await db.asUser(REVIEWER_ID, (s) =>
      s.query<{ n: string }>("select count(*)::text n from audit_log"),
    );
    expect(Number(audit.rows[0]?.n)).toBeGreaterThan(0);
  });
});

describe("mutation is denied to unauthorized roles", () => {
  it("anon cannot insert a study", async () => {
    await expect(
      db.asAnon((s) => s.query("insert into research_study (canonical_title) values ('hack')")),
    ).rejects.toThrow();
  });

  it("anon cannot update a published study", async () => {
    await expect(
      db.asAnon((s) =>
        s.query("update research_study set publication_state = 'DRAFT' where id = $1", [
          PUBLISHED_POSITIVE,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("even a reviewer has no direct table write in M2 (writes go via service_role)", async () => {
    await expect(
      db.asUser(REVIEWER_ID, (s) =>
        s.query("insert into research_study (canonical_title) values ('reviewer direct write')"),
      ),
    ).rejects.toThrow();
  });

  it("service_role (server-side) can write and bypasses RLS", async () => {
    await expect(
      db.asServiceRole((s) =>
        s.query(
          "insert into research_study (canonical_title, publication_state) values ('server insert', 'DRAFT')",
        ),
      ),
    ).resolves.toBeDefined();
    // and can see the draft it just wrote
    const rows = await db.asServiceRole((s) =>
      s.query<{ n: string }>(
        "select count(*)::text n from research_study where publication_state = 'DRAFT'",
      ),
    );
    expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0);
  });
});
