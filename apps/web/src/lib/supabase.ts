import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Public Supabase connection strategy (Milestone 1 — connection only).
 *
 * This module reads ONLY the public, browser-safe variables and is therefore
 * safe to import from client-side island code:
 *   - PUBLIC_SUPABASE_URL
 *   - PUBLIC_SUPABASE_ANON_KEY
 *
 * The service-role key (and any other privileged secret) MUST NEVER appear in
 * frontend code or in this module — see docs/16-SECURITY.md §5. Privileged,
 * server-side access will live in a separate server-only module in a later
 * milestone, guarded so it is never bundled into the client.
 *
 * No database schema, queries, or auth flows are implemented here yet
 * (that is Milestone 2+). This is the connection strategy only.
 */

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/** Whether the public Supabase environment variables are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

let cachedClient: SupabaseClient | null = null;

/**
 * Return a memoized public Supabase client built from the PUBLIC_ env vars.
 * Throws a clear error if the environment is not configured, so misconfiguration
 * fails loudly rather than silently (docs/16 §12).
 */
export function getPublicSupabaseClient(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY (see .env.example).'
    );
  }
  if (!cachedClient) {
    cachedClient = createClient(url, anonKey, {
      auth: { persistSession: false },
    });
  }
  return cachedClient;
}
