/**
 * Server-side data-access executor (docs/26 §4, ADR-014).
 *
 * Implements the same `SqlExecutor` contract the tested service layer runs on,
 * backed by a direct PostgreSQL connection and per-request ROLE context — the
 * exact model the deterministic test harness uses. Each helper reserves a
 * dedicated connection, sets the PostgREST-equivalent role + JWT claims, runs
 * the caller, then resets and releases the connection so RLS is exercised
 * identically to production Supabase.
 *
 * SERVER ONLY. The connection string is a server secret; when it is absent the
 * data layer is "not configured" and callers degrade gracefully (no crash),
 * matching the M1 credential-boundary pattern.
 */
import postgres from "postgres";
import type { SqlExecutor } from "@wise-evidence/database";

const DB_URL = import.meta.env.SUPABASE_DB_URL;

/** Whether a real database connection is configured. */
export const isDatabaseConfigured = Boolean(DB_URL);

let pool: postgres.Sql | null = null;
function getPool(): postgres.Sql {
  if (!DB_URL) {
    throw new Error("SUPABASE_DB_URL is not configured");
  }
  pool ??= postgres(DB_URL, { max: 5, prepare: false });
  return pool;
}

type SessionRole = "anon" | "authenticated" | "service_role";

async function withRole<T>(
  role: SessionRole,
  claims: Record<string, unknown> | null,
  fn: (db: SqlExecutor) => Promise<T>,
): Promise<T> {
  const sql = getPool();
  const reserved = await sql.reserve();
  try {
    await reserved`select set_config('request.jwt.claims', ${claims ? JSON.stringify(claims) : ""}, false)`;
    await reserved.unsafe(`set role ${role}`);
    const executor: SqlExecutor = {
      query: async <R = Record<string, unknown>>(text: string, params?: unknown[]) => {
        const rows = (await reserved.unsafe(text, (params ?? []) as never[])) as unknown as R[];
        return { rows: [...rows] };
      },
    };
    return await fn(executor);
  } finally {
    await reserved.unsafe("reset role").catch(() => undefined);
    await reserved`select set_config('request.jwt.claims', '', false)`.catch(() => undefined);
    reserved.release();
  }
}

/** Run on the anonymous public read path (RLS: only PUBLISHED). */
export function asAnon<T>(fn: (db: SqlExecutor) => Promise<T>): Promise<T> {
  return withRole("anon", null, fn);
}

/** Run as an authenticated user (RLS-enforced) with the given auth uid. */
export function asUser<T>(userId: string, fn: (db: SqlExecutor) => Promise<T>): Promise<T> {
  return withRole("authenticated", { sub: userId, role: "authenticated" }, fn);
}

/**
 * Run on the privileged server path (bypasses RLS). Use ONLY after the actor's
 * role has been authorized server-side (the service layer re-checks it too).
 */
export function asService<T>(fn: (db: SqlExecutor) => Promise<T>): Promise<T> {
  return withRole("service_role", { role: "service_role" }, fn);
}
