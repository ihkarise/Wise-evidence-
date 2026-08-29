/**
 * SqlExecutor — the minimal database boundary the service layer runs on
 * (docs/26 §4, §13-19).
 *
 * The same interface is implemented by:
 *   - the deterministic PGlite test harness (real RLS + roles), and
 *   - the Astro server (a Postgres-backed executor, per-request role context).
 *
 * Keeping the service functions on this narrow interface means the exact same
 * business logic + SQL runs in tests and in production. It performs no I/O
 * itself and imports nothing framework-specific.
 */
import type { AppRole } from "./constants.js";

/** A query surface: parameterized SQL in, typed rows out. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * The authenticated actor performing a workflow operation, as resolved
 * server-side from the Supabase session (auth.uid() → app_user). The role is
 * NEVER taken from a client claim (docs/26 §2).
 */
export interface Actor {
  readonly id: string;
  readonly role: AppRole;
}

/** Machine-readable service-layer failure reasons (surfaced to API/UI). */
export type ServiceErrorReason =
  | "forbidden" // actor lacks the required role
  | "not-found" // target study/entity does not exist
  | "invalid-input" // bad argument (e.g. malformed DOI)
  | "duplicate" // an existing record already owns this identifier
  | "invalid-state" // operation not allowed from the current lifecycle state
  | "precondition-failed" // fail-closed publish requirement unmet
  | "demo-protected"; // refused because the record is demo data

/** A typed, non-secret-leaking service error. */
export class ServiceError extends Error {
  readonly reason: ServiceErrorReason;
  constructor(reason: ServiceErrorReason, message: string) {
    super(message);
    this.name = "ServiceError";
    this.reason = reason;
  }
}

/** Guard: require the actor to be a reviewer or admin. */
export function requireStaff(actor: Actor): void {
  if (actor.role !== "REVIEWER" && actor.role !== "ADMIN") {
    throw new ServiceError("forbidden", "reviewer or admin role required");
  }
}

/** Guard: require the actor to be an admin (publish/archive). */
export function requireAdmin(actor: Actor): void {
  if (actor.role !== "ADMIN") {
    throw new ServiceError("forbidden", "admin role required");
  }
}
