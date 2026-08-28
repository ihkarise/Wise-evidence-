/**
 * Deterministic database test harness (docs/25 §11, ADR-013).
 *
 * Boots an in-process PostgreSQL (PGlite), loads the clearly-labelled Supabase
 * test shim, then applies the real, ordered migrations from `supabase/migrations`
 * — the same SQL that deploys to a live Supabase project. Optionally loads the
 * DEMO fixtures. Provides role-context helpers (`asAnon`, `asUser`,
 * `asServiceRole`) that set the same JWT-claims GUCs PostgREST would, so RLS is
 * exercised the way it behaves in production.
 *
 * This file is test infrastructure. It is NOT exported from the package's public
 * API and never ships to the application.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { loadMigrations, loadSeedFile } from "../src/paths.js";

const SHIM_PATH = fileURLToPath(new URL("./supabase-shim.sql", import.meta.url));

/** The PostgreSQL roles Supabase exposes (and the shim recreates). */
export type SessionRole = "anon" | "authenticated" | "service_role";

export interface QueryResult<T> {
  rows: T[];
}

export interface TestDatabase {
  /** Run SQL as the default owner (superuser) — bypasses RLS; use to arrange data. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run multi-statement SQL as the default owner. */
  exec(sql: string): Promise<void>;
  /** Run `fn` as the anonymous (`anon`) role with no JWT — the public read path. */
  asAnon<T>(fn: (db: RoleScopedDb) => Promise<T>): Promise<T>;
  /** Run `fn` as `authenticated` with a JWT `sub` of `userId`. */
  asUser<T>(userId: string, fn: (db: RoleScopedDb) => Promise<T>): Promise<T>;
  /** Run `fn` as `service_role` (bypasses RLS — server-side privileged path). */
  asServiceRole<T>(fn: (db: RoleScopedDb) => Promise<T>): Promise<T>;
  /** Load the DEMO fixtures (supabase/seed/demo_fixtures.sql) as the owner. */
  loadDemoFixtures(): Promise<void>;
  close(): Promise<void>;
}

/** A query surface scoped to whichever role a helper entered. */
export interface RoleScopedDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

/**
 * Create and fully migrate a fresh in-memory database. Each call is isolated —
 * nothing is shared between tests.
 */
export async function createTestDatabase(options?: { seed?: boolean }): Promise<TestDatabase> {
  const pg = new PGlite();

  // 1. Supabase compatibility shim (roles + auth.*), before any migration.
  const shimSql = await readFile(SHIM_PATH, "utf8");
  await pg.exec(shimSql);

  // 2. The real, ordered migrations.
  for (const migration of await loadMigrations()) {
    try {
      await pg.exec(migration.sql);
    } catch (error) {
      throw new Error(`migration ${migration.name} failed: ${(error as Error).message}`);
    }
  }

  const runScoped = async <T>(
    role: SessionRole,
    claims: Record<string, unknown> | null,
    fn: (db: RoleScopedDb) => Promise<T>,
  ): Promise<T> => {
    const claimsJson = claims ? JSON.stringify(claims) : "";
    await pg.query("select set_config('request.jwt.claims', $1, false)", [claimsJson]);
    await pg.exec(`set role ${role}`);
    try {
      return await fn({
        query: <T2 = Record<string, unknown>>(sql: string, params?: unknown[]) =>
          pg.query<T2>(sql, params) as Promise<QueryResult<T2>>,
      });
    } finally {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claims', '', false)");
    }
  };

  const db: TestDatabase = {
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      pg.query<T>(sql, params) as Promise<QueryResult<T>>,
    exec: (sql: string) => pg.exec(sql).then(() => undefined),
    asAnon: (fn) => runScoped("anon", null, fn),
    asUser: (userId, fn) => runScoped("authenticated", { sub: userId, role: "authenticated" }, fn),
    asServiceRole: (fn) => runScoped("service_role", { role: "service_role" }, fn),
    loadDemoFixtures: async () => {
      const sql = await loadSeedFile("demo_fixtures.sql");
      await pg.exec(sql);
    },
    close: () => pg.close(),
  };

  if (options?.seed) {
    await db.loadDemoFixtures();
  }

  return db;
}
