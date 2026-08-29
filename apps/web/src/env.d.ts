/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// Public, browser-safe environment variables. Astro exposes only `PUBLIC_*`
// variables to client code. Server-only secrets (below) must never be prefixed
// with `PUBLIC_` and never appear here.
interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;

  // ---- SERVER-ONLY (never sent to the browser) ----
  // Supabase project URL + anon key used by the SSR auth client (cookie
  // sessions). The anon key is RLS-protected; it is read server-side here.
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  // The service-role key bypasses RLS — used ONLY by privileged server writes
  // (publication, audit). It must never reach client/island code.
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  // Direct PostgreSQL connection string for the data-access executor. Server
  // only. When absent, data surfaces degrade to a "not configured" notice.
  readonly SUPABASE_DB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Per-request context resolved by middleware (docs/26 §3).
declare namespace App {
  interface Locals {
    /** The signed-in Supabase user id, or null. */
    userId: string | null;
    /** The resolved application role (never from a client claim). */
    role: import("@wise-evidence/database").Actor["role"] | null;
    /** Convenience: the resolved staff actor, or null when not staff. */
    actor: import("@wise-evidence/database").Actor | null;
  }
}
