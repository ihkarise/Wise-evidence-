/**
 * Supabase connection strategy — Milestone 1.
 *
 * IMPORTANT: this is the *connection strategy only*. Milestone 1 ships no
 * database schema, no migrations, no tables, and no Row-Level Security policies
 * (see supabase/README.md). This module exists so the public/anon client can be
 * constructed consistently once the M2 schema lands — and to make the
 * public-vs-secret credential boundary explicit and enforced from day one.
 *
 * Security boundary (docs/16-SECURITY.md §5):
 *   - Only the PUBLIC anon key pair is ever read here. Astro exposes `PUBLIC_*`
 *     variables to the browser; the anon key is protected by RLS in later
 *     milestones.
 *   - The Supabase SERVICE-ROLE key bypasses RLS and MUST remain server-side
 *     only. It must never be imported into this file, prefixed with `PUBLIC_`,
 *     or referenced from any client/island code. Security must not depend on
 *     hiding things in the browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/**
 * Whether the public Supabase environment is configured. In M1 this is
 * expected to be `false` in most environments — the static site does not
 * require a backend yet.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Lazily create the public (anon) Supabase browser client.
 *
 * Returns `null` when the public environment is not configured, so callers must
 * handle the not-configured case explicitly rather than crashing the static
 * site. This never constructs a privileged client.
 */
export function getPublicSupabaseClient(): SupabaseClient | null {
  if (!url || !anonKey) {
    return null;
  }
  return createClient(url, anonKey, {
    auth: {
      // Public browsing needs no session persistence at this stage.
      persistSession: false,
    },
  });
}
