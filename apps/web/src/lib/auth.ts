/**
 * Server-side authentication + role resolution (docs/26 §1-2).
 *
 * Authentication is Supabase Auth over @supabase/ssr with httpOnly cookie
 * sessions. The browser never receives a privileged secret. The role is NEVER
 * taken from a client claim: it is resolved server-side as
 * auth.uid() → app_user → role.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import type { Actor } from "@wise-evidence/database";
import { asService } from "./db.js";

const SUPABASE_URL = import.meta.env.SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  import.meta.env.SUPABASE_ANON_KEY ?? import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/** Whether Supabase Auth is configured for this deployment. */
export const isAuthConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** A minimal shape so we do not depend on the full supabase-js type surface. */
export interface ServerAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: unknown; error: { message: string } | null }>;
    signOut(): Promise<{ error: unknown }>;
  };
}

/**
 * Build a request-scoped Supabase Auth client bound to the request's cookies.
 * `getAll` reads the incoming Cookie header (AstroCookies has no enumerate API);
 * `setAll` writes httpOnly cookies via AstroCookies. Returns null when auth is
 * not configured (dev without a project).
 */
export function createAuthClient(cookies: AstroCookies, request: Request): ServerAuthClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get("cookie")),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          cookies.set(name, value, {
            ...(options as CookieOptions),
            httpOnly: true,
            sameSite: "lax",
            path: "/",
          });
        }
      },
    },
  }) as unknown as ServerAuthClient;
}

/** Parse a Cookie request header into the { name, value }[] shape ssr expects. */
function parseCookieHeader(header: string | null): { name: string; value: string }[] {
  if (!header) return [];
  const out: { name: string; value: string }[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out.push({ name, value: decodeURIComponent(part.slice(eq + 1).trim()) });
  }
  return out;
}

/**
 * Resolve the application role for a Supabase user id. Reads app_user via the
 * privileged path (after the session is already verified). A signed-in user
 * with no app_user row is non-staff → null (fail-closed).
 */
export async function resolveActor(userId: string): Promise<Actor | null> {
  const actor = await asService((db) =>
    db
      .query<{ role: Actor["role"] }>("select role from app_user where id = $1", [userId])
      .then((r) => r.rows[0] ?? null),
  );
  if (!actor) return null;
  if (actor.role !== "REVIEWER" && actor.role !== "ADMIN") return null;
  return { id: userId, role: actor.role };
}
