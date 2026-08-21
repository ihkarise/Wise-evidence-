import { PGlite } from '@electric-sql/pglite';
import type { QueryExecutor } from '../db.js';
import { runMigrations, runSeed } from '../migrate.js';
import { AUTH_SHIM_SQL } from './auth-shim.js';

/** The database roles the shim provides (matching Supabase). */
export type PgRole = 'anon' | 'authenticated' | 'service_role';

export interface TestDatabase extends QueryExecutor {
  /** The underlying PGlite instance. */
  readonly pg: PGlite;
  /** Run a multi-statement SQL script. */
  exec(sql: string): Promise<unknown>;
  /**
   * Run `fn` inside a transaction as a specific role and (optional) auth user,
   * then ROLLBACK — so RLS is exercised by real PostgreSQL and nothing persists.
   * `sub` is the authenticated user's UUID (Supabase auth.uid()); null = signed-out.
   */
  asRole<T>(role: PgRole, sub: string | null, fn: (exec: QueryExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface CreateTestDatabaseOptions {
  /** Also load the reference taxonomy seed + demo fixtures. Default false. */
  seed?: boolean;
}

/**
 * Create a fresh in-memory PGlite database with the Supabase auth shim applied,
 * the real migrations run, and (optionally) the seed + fixtures loaded. Setup
 * runs as the PGlite superuser; RLS is tested by switching roles via `asRole`.
 */
export async function createTestDatabase(
  options: CreateTestDatabaseOptions = {}
): Promise<TestDatabase> {
  const pg = new PGlite();
  await pg.exec(AUTH_SHIM_SQL);
  await runMigrations(pg);
  if (options.seed) {
    await runSeed(pg);
  }

  const api: TestDatabase = {
    pg,
    query: (sql, params) => pg.query(sql, params as unknown[] | undefined),
    exec: (sql) => pg.exec(sql),
    async asRole(role, sub, fn) {
      await pg.exec('begin');
      try {
        await pg.query(`set local role ${role}`);
        await pg.query('select set_config($1, $2, true)', [
          'request.jwt.claims',
          sub ? JSON.stringify({ sub, role }) : '',
        ]);
        return await fn(api);
      } finally {
        await pg.exec('rollback');
      }
    },
    close: () => pg.close(),
  };
  return api;
}

export { AUTH_SHIM_SQL } from './auth-shim.js';
