/**
 * Grant-hardening tests for migration 0012 (docs/16 §4, docs/19 §11, ADR-018).
 *
 * These assert the SQL-privilege posture directly (via has_table_privilege),
 * complementing the RLS boundary tests in rls.test.ts. RLS already blocks anon
 * from private data; 0012 additionally makes the underlying GRANTs match the
 * documented least-privilege intent, so a stray Supabase default grant cannot
 * quietly widen anon's reach.
 *
 * Stock PostgreSQL (PGlite) has none of Supabase's ALTER DEFAULT PRIVILEGES, so
 * the last test SIMULATES that condition (owner grants anon extra privileges)
 * and proves 0012's statements remove it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./harness.js";
import { loadMigrations } from "../src/paths.js";

const PRIVATE_TABLES = [
  "app_user",
  "review",
  "correction",
  "audit_log",
  "import_job",
  "import_candidate",
  "ai_job",
  "ai_result",
] as const;

const PUBLIC_READ_TABLES = ["research_study", "taxonomy_version", "classification"] as const;

let db: TestDatabase;

/** Owner-context privilege probe: does `role` hold `priv` on `table`? */
async function can(role: string, table: string, priv: string): Promise<boolean> {
  const res = await db.query<{ v: boolean }>("select has_table_privilege($1, $2, $3) as v", [
    role,
    table,
    priv,
  ]);
  return Boolean(res.rows[0]?.v);
}

beforeAll(async () => {
  db = await createTestDatabase({ seed: false });
});
afterAll(async () => {
  await db.close();
});

describe("anon is hard-denied on private staff tables", () => {
  it("holds no SELECT/INSERT/UPDATE/DELETE on any private table", async () => {
    for (const table of PRIVATE_TABLES) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(await can("anon", table, priv), `anon ${priv} ${table}`).toBe(false);
      }
    }
  });
});

describe("anon is read-only on public tables", () => {
  it("keeps SELECT on catalogue/research tables", async () => {
    for (const table of PUBLIC_READ_TABLES) {
      expect(await can("anon", table, "SELECT"), `anon SELECT ${table}`).toBe(true);
    }
  });

  it("cannot write to any public table", async () => {
    for (const table of PUBLIC_READ_TABLES) {
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        expect(await can("anon", table, priv), `anon ${priv} ${table}`).toBe(false);
      }
    }
  });
});

describe("authenticated access is preserved", () => {
  it("keeps SELECT on private tables (RLS narrows to staff)", async () => {
    for (const table of PRIVATE_TABLES) {
      expect(await can("authenticated", table, "SELECT"), `authenticated SELECT ${table}`).toBe(
        true,
      );
    }
  });

  it("keeps its M3 content-write grants (migration 0010)", async () => {
    expect(await can("authenticated", "research_study", "INSERT")).toBe(true);
    expect(await can("authenticated", "research_study", "UPDATE")).toBe(true);
  });

  it("may not TRUNCATE any table", async () => {
    for (const table of [...PUBLIC_READ_TABLES, ...PRIVATE_TABLES]) {
      expect(await can("authenticated", table, "TRUNCATE"), `authenticated TRUNCATE ${table}`).toBe(
        false,
      );
    }
  });
});

describe("service_role is unaffected", () => {
  it("retains full table access", async () => {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(await can("service_role", "audit_log", priv), `service_role ${priv}`).toBe(true);
    }
  });
});

describe("0012 removes stray Supabase-style default grants", () => {
  it("re-applying the migration strips anon privileges a default grant handed it", async () => {
    // Simulate what Supabase's ALTER DEFAULT PRIVILEGES does on the live project:
    // silently grant anon access the migration comments claim it never has.
    await db.exec("grant select, insert, update, delete on audit_log to anon");
    await db.exec("grant insert on research_study to anon");
    expect(await can("anon", "audit_log", "SELECT")).toBe(true); // stray grant present
    expect(await can("anon", "research_study", "INSERT")).toBe(true);

    // Re-apply the exact 0012 SQL that ships to production.
    const migrations = await loadMigrations();
    const hardening = migrations.find((m) => m.name.startsWith("0012"));
    expect(hardening, "0012 migration file present").toBeTruthy();
    await db.exec(hardening!.sql);

    // The stray grants are gone; the legitimate public SELECT survives.
    expect(await can("anon", "audit_log", "SELECT")).toBe(false);
    expect(await can("anon", "audit_log", "INSERT")).toBe(false);
    expect(await can("anon", "research_study", "INSERT")).toBe(false);
    expect(await can("anon", "research_study", "SELECT")).toBe(true);
  });
});
