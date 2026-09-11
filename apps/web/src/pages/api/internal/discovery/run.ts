/**
 * Trusted SCHEDULED "run discovery" endpoint (M7.9; docs/30 §15, ADR-020 M7.9
 * amendment).
 *
 * This is the ONLY non-browser entry point into the existing discovery engine.
 * It exists so an external scheduler (a GitHub Actions cron job — see
 * .github/workflows/discovery.yml) can start ONE bounded run on a recurring
 * schedule. It adds NO in-app scheduler/cron/worker/queue: a run happens only
 * when this endpoint is called.
 *
 * Trust boundary (fail-closed at every step; nothing trusted from the request
 * except a provider chosen from the closed allowlist):
 *   1. `DISCOVERY_RUN_TOKEN` (server-only shared secret) authenticates the
 *      CALLER as the trusted scheduler, compared in CONSTANT TIME and never
 *      echoed. Unset → the feature is disabled and this route 404s (it must not
 *      reveal that it exists).
 *   2. The run executes under a REAL staff actor configured server-side
 *      (`DISCOVERY_RUN_ACTOR_ID`), resolved against `app_user` exactly like a
 *      browser session (role NEVER from the request). A non-staff/unknown id
 *      fails closed (403) — the token authenticates the machine; the actor
 *      supplies authority + append-only audit attribution.
 *   3. The search QUERY is server-configured (`DISCOVERY_SCHEDULED_QUERY`,
 *      default "homeopathy"), never from the request body.
 *   4. The budget is the conservative `DEFAULT_BUDGET` inside the orchestrator —
 *      never client-supplied. Each connector is host-pinned internally; no URL
 *      or host ever crosses this boundary.
 *
 * It reuses `runScheduledDiscovery` (the M7.8 composition + a SCHEDULED trigger +
 * the adapter's overlap guard). It persists REVIEWABLE candidates only — it
 * never publishes, classifies, scores, accepts, merges, deletes, calls AI,
 * downloads PDFs, or scrapes, and writes no canonical research data. Errors are
 * mapped to safe messages; no secret or internal ever appears in a response.
 */
import type { APIRoute } from "astro";
import {
  runScheduledDiscovery,
  authorizeScheduledInvocation,
  resolveScheduledProvider,
  resolveScheduledQuery,
  type Actor,
  type DiscoveryRunResult,
} from "@wise-evidence/database";
import { parseBody, json, errorResponse } from "../../../../lib/http.js";
import { asService, isDatabaseConfigured } from "../../../../lib/db.js";
import { resolveActor } from "../../../../lib/auth.js";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // 1) Authenticate the trusted scheduler (constant-time secret) and confirm the
  //    feature is configured. This never reveals config state to an
  //    unauthenticated caller (unset token → 404).
  const auth = authorizeScheduledInvocation(request.headers.get("authorization"), {
    expectedToken: import.meta.env.DISCOVERY_RUN_TOKEN,
    actorId: import.meta.env.DISCOVERY_RUN_ACTOR_ID,
    dbConfigured: isDatabaseConfigured,
  });
  if (!auth.ok) {
    return json({ error: auth.message }, auth.status);
  }

  // 2) Resolve the server-configured actor against app_user (role is NEVER taken
  //    from the request). Fail closed if it is missing or not staff.
  const actorId = (import.meta.env.DISCOVERY_RUN_ACTOR_ID ?? "").trim();
  const actor = await resolveActor(actorId);
  if (!actor) {
    return json({ error: "the configured discovery actor is not a reviewer or admin" }, 403);
  }

  // 3) Provider (closed allowlist, validated downstream) + server-configured
  //    query. A trusted caller may pick a provider so one workflow can target a
  //    specific source; it can never supply a URL, host, budget, or query.
  const body = await parseBody(request).catch(() => ({}) as Record<string, string>);
  const provider = resolveScheduledProvider(
    body.provider,
    import.meta.env.DISCOVERY_SCHEDULED_PROVIDER,
  );
  const query = resolveScheduledQuery(import.meta.env.DISCOVERY_SCHEDULED_QUERY);

  let result: DiscoveryRunResult;
  try {
    result = await asService((db) =>
      runScheduledDiscovery(
        db,
        actor as Actor,
        { provider, query },
        {
          // Server-side egress for the networked connectors (host-pinned inside
          // the discovery package). MOCK ignores it. Never from the request.
          fetch: globalThis.fetch?.bind(globalThis),
          contactEmail: contactEmail(),
        },
      ),
    );
  } catch (error) {
    // ServiceError → safe status/message (e.g. an in-progress run → 409
    // "already in progress"; a bad provider → 400). Anything else → generic 500.
    return errorResponse(error);
  }

  // A completed OR failed RUN both return 200 (the request was handled); the
  // body reports the run state and counters. No secret/internal is included.
  return json({
    ok: result.state !== "FAILED",
    state: result.state,
    trigger: result.trigger,
    sourceKey: result.sourceKey,
    stopReason: result.stopReason,
    counters: result.counters,
  });
};

/** Optional polite-pool contact email (not a secret; absent → no header). */
function contactEmail(): string | null {
  const value = import.meta.env.DISCOVERY_CONTACT_EMAIL;
  return value && value.trim().length > 0 ? value.trim() : null;
}
