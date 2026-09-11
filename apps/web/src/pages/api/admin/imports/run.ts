/**
 * Manual "Run discovery now" endpoint (M7.8; docs/30 §14). A single staff-only
 * POST that starts the EXISTING bounded discovery orchestrator through the
 * `runManualDiscovery` service (which wires the existing persistence adapters and
 * registry). It creates no second discovery implementation and adds no scheduler.
 *
 * Trust boundary: the actor (identity + role) comes ONLY from the server-resolved
 * session (`locals.actor`); middleware already 401/403s `/api/admin/*`, and the
 * service re-checks staff. The client sends only a provider selection (validated
 * against a closed allowlist) and an optional bounded free-text query — never a
 * URL, host, budget, actor, or persistence decision. The server supplies egress
 * (`globalThis.fetch`) for the networked connectors; in an egress-restricted
 * environment those simply fail closed and the run is reported as FAILED — no
 * secret is involved (the connectors need no API key) and none is echoed.
 *
 * On success it redirects back to /admin/imports with a flash summary of the run
 * (state + candidate/duplicate/discovered counts). It never publishes, classifies,
 * scores, accepts, or calls AI — it only enqueues REVIEWABLE candidates.
 */
import type { APIRoute } from "astro";
import { runManualDiscovery, type DiscoveryRunResult, type Actor } from "@wise-evidence/database";
import { parseBody, backWithMessage } from "../../../../lib/http.js";
import { asService, isDatabaseConfigured } from "../../../../lib/db.js";

export const prerender = false;

const BACK = "/admin/imports";

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.actor;
  if (!actor) return backWithMessage(BACK, "error", "Not authorized.");
  if (!isDatabaseConfigured) {
    return backWithMessage(BACK, "error", "Database is not configured in this environment.");
  }

  const body = await parseBody(request);

  let result: DiscoveryRunResult;
  try {
    result = await asService((db) =>
      runManualDiscovery(
        db,
        actor as Actor,
        { provider: body.provider ?? "", query: body.query },
        {
          // Server-side egress for the networked connectors (host-pinned inside
          // the discovery package). MOCK ignores it. Never taken from the client.
          fetch: globalThis.fetch?.bind(globalThis),
          contactEmail: contactEmail(),
        },
      ),
    );
  } catch (error) {
    // Map to a safe flash message (never leak internals/secrets).
    return backWithMessage(BACK, "error", safeMessage(error));
  }

  return backWithMessage(BACK, result.state === "FAILED" ? "error" : "ok", summarize(result));
};

/** Optional polite-pool contact email (not a secret; absent → no header). */
function contactEmail(): string | null {
  const value = import.meta.env.DISCOVERY_CONTACT_EMAIL;
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** A short, human-friendly summary of the run for the admin flash message. */
function summarize(result: DiscoveryRunResult): string {
  const c = result.counters;
  if (result.state === "FAILED") {
    return `Discovery run for ${result.sourceKey} did not complete (${result.stopReason}). No candidates were added.`;
  }
  const parts = [
    `${c.candidates} candidate${c.candidates === 1 ? "" : "s"} added for review`,
    `${c.discovered} found`,
  ];
  if (c.duplicates > 0) parts.push(`${c.duplicates} flagged as possible duplicate`);
  if (c.skipped > 0) parts.push(`${c.skipped} already known`);
  return `Discovery run (${result.sourceKey}) complete: ${parts.join(", ")}. Review them below — nothing was published or classified.`;
}

/** Extract a safe message from a thrown error without leaking internals. */
function safeMessage(error: unknown): string {
  if (error instanceof Error && error.name === "ServiceError") {
    return error.message;
  }
  return "The discovery run could not be started.";
}
