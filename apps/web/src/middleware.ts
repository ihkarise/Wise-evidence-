/**
 * Route-protection + context middleware (docs/26 §3, §8).
 *
 * Runs on on-demand (SSR) requests. It resolves the session user and role ONCE
 * and attaches them to `locals`, then enforces the admin/API boundary as a UX
 * layer. This is NOT the security boundary — RLS and the service layer are
 * (docs/26 §4). Prerendered public pages never reach this code.
 */
import { defineMiddleware } from "astro:middleware";
import { createAuthClient, resolveActor } from "./lib/auth.js";

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, url, locals, request } = context;

  locals.userId = null;
  locals.role = null;
  locals.actor = null;

  const auth = createAuthClient(cookies, request);
  if (auth) {
    try {
      const { data } = await auth.auth.getUser();
      if (data.user) {
        locals.userId = data.user.id;
        const actor = await resolveActor(data.user.id);
        if (actor) {
          locals.role = actor.role;
          locals.actor = actor;
        }
      }
    } catch {
      // Malformed/expired session → treated as anonymous. Never throws upward.
    }
  }

  const path = url.pathname;
  const isStaff = locals.actor !== null;

  // Admin API: JSON 401/403.
  if (path.startsWith("/api/admin")) {
    if (!locals.userId) {
      return json({ error: "authentication required" }, 401);
    }
    if (!isStaff) {
      return json({ error: "forbidden" }, 403);
    }
  }

  // Admin pages: redirect to sign-in / 403. The sign-in page itself is public.
  if (path.startsWith("/admin") && path !== "/admin/sign-in") {
    if (!locals.userId) {
      return context.redirect("/admin/sign-in?next=" + encodeURIComponent(path), 302);
    }
    if (!isStaff) {
      return new Response("Forbidden — your account is not a reviewer or admin.", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  return next();
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
