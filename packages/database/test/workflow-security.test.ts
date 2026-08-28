/**
 * M3 security tests (docs/26 §24). These exercise the DATABASE boundary
 * directly through the anon / authenticated roles the Supabase shim recreates —
 * NOT the service layer — proving that authorization holds even if the server
 * layer were bypassed:
 *   - anon cannot mutate or read drafts;
 *   - authenticated non-staff cannot mutate;
 *   - a reviewer cannot transition a study to PUBLISHED (publish guard);
 *   - a reviewer cannot self-promote to ADMIN (app_user is locked);
 *   - an admin CAN publish a non-demo PENDING_REVIEW study;
 *   - a demo record can never be published;
 *   - private audit stays inaccessible to the public.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./harness.js";

const REVIEWER_ID = "10000000-0000-0000-0000-000000000001"; // seeded REVIEWER
const ADMIN_ID = "10000000-0000-0000-0000-0000000000ad";
const STRANGER_ID = "99999999-9999-9999-9999-999999999999"; // authenticated, no app_user
const DEMO_DRAFT = "20000000-0000-0000-0000-000000000009"; // is_demo, DRAFT

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  await db.query(
    "insert into app_user (id, email, display_name, role) values ($1, 'admin@example.invalid', 'Admin', 'ADMIN')",
    [ADMIN_ID],
  );
});
afterAll(async () => {
  await db.close();
});

/** Create a non-demo study directly (owner) in a given publication_state. */
async function makeStudy(publicationState: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into research_study (canonical_title, lifecycle_state, publication_state, is_demo)
     values ('sec test', 'PROCESSING', $1::publication_state, false) returning id`,
    [publicationState],
  );
  return rows[0]!.id;
}

describe("anon is fully read-limited and cannot mutate", () => {
  it("cannot insert or update research", async () => {
    await expect(
      db.asAnon((s) => s.query("insert into research_study (canonical_title) values ('x')")),
    ).rejects.toThrow();
  });
  it("cannot read a draft study", async () => {
    const rows = await db.asAnon((s) =>
      s.query<{ n: string }>("select count(*)::text n from research_study where id = $1", [
        DEMO_DRAFT,
      ]),
    );
    expect(rows.rows[0]?.n).toBe("0");
  });
  it("cannot read the audit log at all (hard-denied)", async () => {
    await expect(db.asAnon((s) => s.query("select * from audit_log"))).rejects.toThrow();
  });
});

describe("authenticated non-staff cannot mutate", () => {
  it("cannot insert a study", async () => {
    await expect(
      db.asUser(STRANGER_ID, (s) =>
        s.query("insert into research_study (canonical_title) values ('x')"),
      ),
    ).rejects.toThrow();
  });
});

describe("reviewer authorization limits (DB-enforced)", () => {
  it("a reviewer CAN create a non-demo draft", async () => {
    await expect(
      db.asUser(REVIEWER_ID, (s) =>
        s.query("insert into research_study (canonical_title) values ('reviewer draft')"),
      ),
    ).resolves.toBeDefined();
  });

  it("a reviewer CANNOT transition a study to PUBLISHED (publish guard)", async () => {
    const id = await makeStudy("PENDING_REVIEW");
    await expect(
      db.asUser(REVIEWER_ID, (s) =>
        s.query("update research_study set publication_state = 'PUBLISHED' where id = $1", [id]),
      ),
    ).rejects.toThrow(/only ADMIN may publish/i);
  });

  it("a reviewer CANNOT self-promote to ADMIN (app_user is locked)", async () => {
    await expect(
      db.asUser(REVIEWER_ID, (s) =>
        s.query("update app_user set role = 'ADMIN' where id = $1", [REVIEWER_ID]),
      ),
    ).rejects.toThrow();
    // role unchanged
    const row = await db.query<{ role: string }>("select role from app_user where id = $1", [
      REVIEWER_ID,
    ]);
    expect(row.rows[0]?.role).toBe("REVIEWER");
  });
});

describe("admin authorization (DB-enforced)", () => {
  it("an admin CAN publish a non-demo PENDING_REVIEW study", async () => {
    const id = await makeStudy("PENDING_REVIEW");
    await expect(
      db.asUser(ADMIN_ID, (s) =>
        s.query("update research_study set publication_state = 'PUBLISHED' where id = $1", [id]),
      ),
    ).resolves.toBeDefined();
    const row = await db.query<{ publication_state: string }>(
      "select publication_state from research_study where id = $1",
      [id],
    );
    expect(row.rows[0]?.publication_state).toBe("PUBLISHED");
  });

  it("cannot publish straight from DRAFT (state machine)", async () => {
    const id = await makeStudy("DRAFT");
    await expect(
      db.asUser(ADMIN_ID, (s) =>
        s.query("update research_study set publication_state = 'PUBLISHED' where id = $1", [id]),
      ),
    ).rejects.toThrow(/PENDING_REVIEW/i);
  });
});

describe("demo records can never be published", () => {
  it("rejects publishing a demo study even for an admin", async () => {
    // Put the demo draft into PENDING_REVIEW (owner), then try to publish as admin.
    await db.query("update research_study set publication_state = 'PENDING_REVIEW' where id = $1", [
      DEMO_DRAFT,
    ]);
    await expect(
      db.asUser(ADMIN_ID, (s) =>
        s.query("update research_study set publication_state = 'PUBLISHED' where id = $1", [
          DEMO_DRAFT,
        ]),
      ),
    ).rejects.toThrow(/demo/i);
  });
});
