import postgres from 'postgres';
import type { QueryExecutor } from '@wise-evidence/database';
import { CrossrefMetadataProvider, MockMetadataProvider, type MetadataProvider } from '@wise-evidence/metadata';

/**
 * Production data-access glue (verified at the Supabase go-live gate, docs/19 §11).
 *
 * The request executor talks to Supabase's PostgreSQL directly and sets the
 * caller's role + JWT claims per transaction — the SAME contract the PGlite test
 * harness enforces (ADR-012), so RLS behaves identically. `SUPABASE_DB_URL` is a
 * server-only secret; when unset (pending mode) these throw a clear error rather
 * than inventing a connection.
 */

export type PgRole = 'anon' | 'authenticated' | 'service_role';
export interface Actor {
  role: PgRole;
  /** app_user.auth_id (Supabase auth.uid()); null for anonymous. */
  sub: string | null;
}

const connString = process.env.SUPABASE_DB_URL;
let sql: ReturnType<typeof postgres> | null = null;

function client() {
  if (!connString) {
    throw new Error('SUPABASE_DB_URL is not configured (Supabase pending gate — docs/19 §11).');
  }
  if (!sql) sql = postgres(connString, { prepare: false });
  return sql;
}

export function isDbConfigured(): boolean {
  return Boolean(connString);
}

/**
 * Run `fn` in a transaction under `actor`'s role + claims, so PostgreSQL RLS is
 * authoritative. Commits on success, rolls back on throw.
 */
export async function withActor<T>(actor: Actor, fn: (exec: QueryExecutor) => Promise<T>): Promise<T> {
  const c = client();
  return c.begin(async (tx) => {
    await tx.unsafe(`set local role ${actor.role}`);
    const claims = actor.sub ? JSON.stringify({ sub: actor.sub, role: actor.role }) : '';
    await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    const exec: QueryExecutor = {
      query: async <Row = Record<string, unknown>>(text: string, params?: unknown[]) => {
        const args = (params ?? []) as (string | number | boolean | null)[];
        const rows = (await tx.unsafe(text, args)) as unknown as Row[];
        return { rows };
      },
    };
    return fn(exec);
  }) as Promise<T>;
}

/** Select the metadata provider from env (mock by default; crossref opt-in). */
export function getMetadataProvider(): MetadataProvider {
  return process.env.METADATA_PROVIDER === 'crossref'
    ? new CrossrefMetadataProvider()
    : new MockMetadataProvider();
}
