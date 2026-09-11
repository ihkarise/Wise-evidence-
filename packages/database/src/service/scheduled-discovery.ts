/**
 * Trusted scheduled-invocation authorization + configuration (M7.9; docs/30 §15,
 * ADR-020 M7.9 amendment).
 *
 * A scheduled discovery run has NO browser session and NO staff cookie — it is
 * driven by an external scheduler (a GitHub Actions cron job) that POSTs to a
 * server endpoint. This module holds the small, PURE, framework-independent
 * decision logic that authorizes such an invocation and resolves its
 * (non-secret) configuration, so the security-critical parts are unit-tested in
 * the deterministic package suite rather than hidden inside an Astro route.
 *
 * Trust model:
 *   - A shared secret (`DISCOVERY_RUN_TOKEN`, server-only) authenticates the
 *     CALLER as the trusted scheduler. It is compared in constant time and never
 *     echoed. If it is unset, the feature is DISABLED and the endpoint is
 *     indistinguishable from a missing route (fail closed).
 *   - The run still executes under a REAL, server-configured staff actor
 *     (`DISCOVERY_RUN_ACTOR_ID`, resolved against `app_user` by the caller, not
 *     here) — the token authenticates the machine; the actor supplies authority
 *     and audit attribution. This module only checks that an actor id is
 *     configured; the endpoint resolves it and fails closed if it is not staff.
 *   - The search QUERY is server-configured (default: the platform's domain),
 *     never taken from the request body. The provider may be chosen only from the
 *     closed allowlist (`parseManualDiscoveryProvider`); no URL/host/budget ever
 *     crosses the boundary.
 *
 * This module performs NO I/O and imports nothing framework-specific.
 */
import { timingSafeEqual } from "node:crypto";

/**
 * The default recurring search when no query is configured. WiseEvidence is a
 * homeopathy evidence platform, so the domain term is the safe, on-topic default
 * (a scheduled run always searches SOMETHING bounded, never an open feed).
 */
export const SCHEDULED_DISCOVERY_DEFAULT_QUERY = "homeopathy";

/**
 * The default provider for a scheduled run when none is configured/requested.
 * MOCK is the offline, keyless default (matches the CI/default posture); a real
 * connector is opt-in via configuration.
 */
export const SCHEDULED_DISCOVERY_DEFAULT_PROVIDER = "MOCK";

/** Result of authorizing a trusted scheduled invocation. */
export type ScheduledAuthResult =
  { readonly ok: true } | { readonly ok: false; readonly status: number; readonly message: string };

/** The (already-read) server configuration an authorization decision needs. */
export interface ScheduledAuthEnv {
  /** `DISCOVERY_RUN_TOKEN` — the shared secret. Unset/blank → feature disabled. */
  readonly expectedToken: string | null | undefined;
  /** `DISCOVERY_RUN_ACTOR_ID` — the staff user the run acts as. */
  readonly actorId: string | null | undefined;
  /** Whether the server data layer is configured (a DB connection exists). */
  readonly dbConfigured: boolean;
}

/** Extract the bearer credential from an `Authorization` header, or null. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = match[1]!.trim();
  return token.length > 0 ? token : null;
}

/**
 * Constant-time secret comparison. Returns false for any length mismatch WITHOUT
 * a short-circuit that would leak length via timing beyond the unavoidable
 * length check, and never throws. Both inputs are compared as UTF-8 bytes.
 */
export function verifySharedSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Decide whether a scheduled invocation is authorized, fail-closed and in an
 * order that never reveals configuration state to an UNAUTHENTICATED caller:
 *   1. token not configured  → 404 (feature disabled; looks like no route)
 *   2. bearer missing/wrong   → 401 (now the caller is unauthenticated)
 *   3. DB not configured      → 503 (authenticated, but server can't run)
 *   4. actor id not configured→ 503
 *   5. → ok
 * The caller still resolves the actor id against `app_user` and fails closed
 * (403) when it is not a reviewer/admin.
 */
export function authorizeScheduledInvocation(
  authorizationHeader: string | null | undefined,
  env: ScheduledAuthEnv,
): ScheduledAuthResult {
  const expected = (env.expectedToken ?? "").trim();
  if (expected.length === 0) {
    // Feature not enabled. Do not reveal that it exists.
    return { ok: false, status: 404, message: "not found" };
  }
  const provided = parseBearerToken(authorizationHeader);
  if (!verifySharedSecret(provided, expected)) {
    return { ok: false, status: 401, message: "unauthorized" };
  }
  if (!env.dbConfigured) {
    return { ok: false, status: 503, message: "discovery is not configured" };
  }
  if ((env.actorId ?? "").trim().length === 0) {
    return { ok: false, status: 503, message: "discovery is not configured" };
  }
  return { ok: true };
}

/** Resolve the (non-secret) search query for a scheduled run. */
export function resolveScheduledQuery(configured: string | null | undefined): string {
  const trimmed = (configured ?? "").trim();
  return trimmed.length > 0 ? trimmed : SCHEDULED_DISCOVERY_DEFAULT_QUERY;
}

/**
 * Resolve the provider string for a scheduled run. A trusted caller may request
 * one (validated downstream against the closed allowlist); otherwise the
 * server-configured default, otherwise MOCK. This never accepts a URL/host — the
 * downstream `parseManualDiscoveryProvider` rejects anything off the allowlist.
 */
export function resolveScheduledProvider(
  requested: string | null | undefined,
  configuredDefault: string | null | undefined,
): string {
  const req = (requested ?? "").trim();
  if (req.length > 0) return req;
  const def = (configuredDefault ?? "").trim();
  return def.length > 0 ? def : SCHEDULED_DISCOVERY_DEFAULT_PROVIDER;
}
