/**
 * Guard for the operator's production inspection tool
 * (docs/reports/PRODUCTION-DATABASE-INSPECTION.sql).
 *
 * That script is meant to be run by the owner against the LIVE Supabase database
 * to verify migration/RLS/grant state WITHOUT changing anything. Its safety
 * contract is that it is strictly READ-ONLY. These tests keep it honest so an
 * edit can never quietly turn it into a write:
 *
 *   1. a static scan asserts it contains no DML/DDL/GRANT/REVOKE/SET ROLE;
 *   2. it actually parses and executes end-to-end against a migrated PGlite
 *      database seeded with the DEMO fixtures (proving every catalog query is
 *      valid against the real 0001–0012 schema).
 *
 * The Supabase-only migration ledger (supabase_migrations.schema_migrations) is
 * deliberately probed via `to_regclass` in the script, so it runs error-free on
 * stock PostgreSQL too.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTestDatabase, type TestDatabase } from "./harness.js";

const SQL_PATH = fileURLToPath(
  new URL("../../../docs/reports/PRODUCTION-DATABASE-INSPECTION.sql", import.meta.url),
);

/** Strip line comments and split into runnable statements on the `;` terminator. */
function statements(sql: string): string[] {
  const noComments = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
});
afterAll(async () => {
  await db.close();
});

describe("production inspection script is read-only", () => {
  const sqlStatements = statements(readFileSync(SQL_PATH, "utf8"));
  const scanned = sqlStatements.join(";\n").toLowerCase();

  it("contains no write, DDL, privilege, or role-switching statement", () => {
    const forbidden: RegExp[] = [
      /\binsert\s+into\b/,
      /\bupdate\s+\w+\s+set\b/,
      /\bdelete\s+from\b/,
      /\btruncate\s+(table|only|[a-z_"]+\s*;)/,
      /\bcreate\s+(table|type|function|trigger|policy|role|schema|view|index)\b/,
      /\balter\b/,
      /\bdrop\b/,
      /\bgrant\b/,
      /\brevoke\b/,
      /\bset\s+role\b/,
      /\bset\s+session\s+authorization\b/,
    ];
    for (const re of forbidden) {
      expect(re.test(scanned), `inspection SQL matched forbidden pattern ${re}`).toBe(false);
    }
  });

  it("parses and executes every statement against the migrated schema", async () => {
    expect(sqlStatements.length).toBeGreaterThan(8);
    for (const s of sqlStatements) {
      await db.query(s);
    }
  });
});
