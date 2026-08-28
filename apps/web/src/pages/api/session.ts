/**
 * Session endpoints (docs/26 §1). POST signs in with email/password via Supabase
 * Auth (cookie session); DELETE signs out. No password is ever stored by us.
 */
import type { APIRoute } from "astro";
import { createAuthClient } from "../../lib/auth.js";
import { parseBody, seeOther, backWithMessage } from "../../lib/http.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const auth = createAuthClient(cookies, request);
  if (!auth) {
    return backWithMessage("/admin/sign-in", "error", "Authentication is not configured.");
  }
  const body = await parseBody(request);

  if (body.action === "signout") {
    await auth.auth.signOut().catch(() => undefined);
    return seeOther("/admin/sign-in");
  }

  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  const next = safeNext(body.next);
  if (!email || !password) {
    return backWithMessage("/admin/sign-in", "error", "Email and password are required.");
  }

  const { error } = await auth.auth.signInWithPassword({ email, password });
  if (error) {
    return backWithMessage("/admin/sign-in", "error", "Invalid email or password.");
  }
  return seeOther(next);
};

export const DELETE: APIRoute = async ({ cookies, request }) => {
  const auth = createAuthClient(cookies, request);
  if (auth) {
    await auth.auth.signOut().catch(() => undefined);
  }
  return seeOther("/admin/sign-in");
};

// Sign-out is also reachable via POST to /api/session?action=signout from a form.
export const PUT: APIRoute = DELETE;

/** Only allow same-site path redirects (no open redirect). */
function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/admin";
}
