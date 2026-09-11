/**
 * Manual "Run discovery now" service (M7.8; docs/30 §14, ADR-020 M7.8 amendment).
 *
 * This is the ONE composition point that lets an authenticated staff user start
 * the EXISTING bounded discovery orchestrator (`runDiscovery` from
 * `@wise-evidence/discovery`) against the EXISTING persistence adapters
 * (`DatabaseDiscoveryStore` / `DatabaseStudyIndex`, M7.4A). It creates no second
 * discovery implementation — it wires the registry, the persistence ports, and
 * the caller's server-resolved actor into the orchestrator, then returns the
 * safe, structured run result.
 *
 * Trust boundary (M7.8): the CLIENT is never trusted for actor identity, role,
 * discovery state, study identity, persistence decisions, budgets, or any URL.
 * The `actor` is resolved server-side and re-checked here (`requireStaff`, and
 * the orchestrator refuses a non-staff `DiscoveryActor` again). The client may
 * choose only a provider from a fixed ALLOWLIST and pass a bounded free-text
 * query — no base URL, no host, and no budget crosses this boundary; each
 * connector is host-pinned internally and the budget is the conservative
 * `DEFAULT_BUDGET` (never client-supplied).
 *
 * Preserved LOCKED boundaries (inherited unchanged from the orchestrator/adapter,
 * test-covered here and in `@wise-evidence/discovery`): a manual run discovers,
 * normalizes, conservatively deduplicates, and PERSISTS REVIEWABLE CANDIDATES
 * only. It NEVER publishes, classifies (outcome/quality/confidence/evidence),
 * scores, accepts, merges, deletes, calls AI, downloads PDFs, or scrapes; it
 * creates NO canonical `research_study` / `publication` / `classification`. There
 * is deliberately NO scheduler, worker, queue, cron, or background job — a run
 * happens only when a human presses the button.
 *
 * Framework-independent: imports only `@wise-evidence/discovery` and local
 * modules (no Astro/React/Supabase-client). Egress is NEVER ambient here — a
 * networked provider's `fetch` must be injected by the caller (the web layer);
 * without it the registry fails closed (`NOT_CONFIGURED`) and the run is FAILED.
 */
import {
  runDiscovery,
  createDefaultDiscoveryRegistry,
  type DiscoveryProviderRegistry,
  type DiscoveryProviderType,
  type DiscoveryRunResult,
  type DiscoveryRunTrigger,
  type FetchLike,
} from "@wise-evidence/discovery";
import { type Actor, type SqlExecutor, ServiceError, requireStaff } from "../executor.js";
import { DatabaseDiscoveryStore, DatabaseStudyIndex } from "./discovery.js";

// Re-export the safe run-result type so API/UI callers can type the return value
// without importing `@wise-evidence/discovery` directly.
export type { DiscoveryRunResult } from "@wise-evidence/discovery";

/**
 * The provider types a staff user may launch from the manual control. This is a
 * closed allowlist: the client can pick nothing outside it (no arbitrary URL, no
 * arbitrary provider string). MOCK is the offline default that always runs; the
 * three real connectors are host-pinned inside `@wise-evidence/discovery` and
 * require an injected fetch (else they fail closed).
 */
export const MANUAL_DISCOVERY_PROVIDERS = [
  "MOCK",
  "CROSSREF",
  "EUROPE_PMC",
  "PUBMED",
] as const satisfies readonly DiscoveryProviderType[];

export type ManualDiscoveryProvider = (typeof MANUAL_DISCOVERY_PROVIDERS)[number];

/** Longest free-text query accepted from the control (defense against abuse). */
export const MANUAL_DISCOVERY_MAX_QUERY_LENGTH = 500;

/**
 * Validate an untrusted provider selection against the closed allowlist.
 * Throws `ServiceError("invalid-input")` for anything else — the client can
 * never select an unknown provider or smuggle in a URL/host.
 */
export function parseManualDiscoveryProvider(
  raw: string | undefined | null,
): ManualDiscoveryProvider {
  const value = (raw ?? "").trim().toUpperCase();
  if ((MANUAL_DISCOVERY_PROVIDERS as readonly string[]).includes(value)) {
    return value as ManualDiscoveryProvider;
  }
  throw new ServiceError("invalid-input", "unknown or unsupported discovery provider");
}

/** Normalize an optional free-text query: trim, bound length, empty → undefined. */
function normalizeQuery(raw: string | undefined | null): string | undefined {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, MANUAL_DISCOVERY_MAX_QUERY_LENGTH);
}

/** What the staff user asked the manual run to do (already server-validated). */
export interface ManualDiscoveryInput {
  /** Provider to run — validated against `MANUAL_DISCOVERY_PROVIDERS`. */
  readonly provider: string;
  /** Optional free-text query passed to the provider (bounded, may be omitted). */
  readonly query?: string;
}

/**
 * Injected composition dependencies. Production supplies `fetch` (the web layer's
 * server-side egress) and an optional polite-pool `contactEmail`; tests inject a
 * fake fetch / registry / clock. Egress is never taken from an ambient global in
 * this package.
 */
export interface ManualDiscoveryDeps {
  /** Server-side fetch for the networked connectors (unused by MOCK). */
  readonly fetch?: FetchLike;
  /** Contact email for a polite-pool User-Agent (not a secret). */
  readonly contactEmail?: string | null;
  /** Registry override (tests); defaults to the shipped adapters. */
  readonly registry?: DiscoveryProviderRegistry;
  /** Deterministic clock/backoff/jitter overrides (tests). */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly rng?: () => number;
}

/**
 * Shared composition for one bounded discovery run. The ONLY difference between
 * a manual (M7.8) and a scheduled (M7.9) run is the recorded `trigger`; every
 * safety property — staff re-check, closed provider allowlist, no client budget,
 * host-pinned egress, reviewable-candidate-only persistence — is identical, so
 * both entry points share this exact wiring and there is no second discovery
 * implementation. The scheduled overlap guard lives in the persistence adapter
 * (`DatabaseDiscoveryStore.createRun`, gated on `trigger === "SCHEDULED"`), so a
 * scheduled run that would overlap an in-progress run throws `invalid-state`
 * before any `import_job` row is created.
 */
async function runComposedDiscovery(
  db: SqlExecutor,
  actor: Actor,
  input: ManualDiscoveryInput,
  trigger: DiscoveryRunTrigger,
  deps: ManualDiscoveryDeps,
): Promise<DiscoveryRunResult> {
  // Defense in depth: middleware already gated the entry point, and the
  // orchestrator refuses a non-staff DiscoveryActor — this refuses one more
  // time, at the DB boundary, before any run row is created.
  requireStaff(actor);

  const provider = parseManualDiscoveryProvider(input.provider);
  const query = normalizeQuery(input.query);

  // The persistence ports (server-side, service_role) and the read-only study
  // index — the SAME adapters the M7.4A end-to-end run uses. The store also
  // re-checks staff on construction.
  const store = new DatabaseDiscoveryStore(db, actor);
  const studyIndex = new DatabaseStudyIndex(db);
  const registry = deps.registry ?? createDefaultDiscoveryRegistry();

  return runDiscovery(
    {
      providerType: provider,
      query,
      trigger,
      // NO client-supplied budget: the orchestrator applies the conservative
      // DEFAULT_BUDGET. A run can never be unbounded or client-tuned.
    },
    {
      registry,
      providerContext: {
        // Egress is injected, never ambient. MOCK ignores it; the networked
        // connectors fail closed (NOT_CONFIGURED → FAILED run) without it.
        fetch: deps.fetch,
        contactEmail: deps.contactEmail ?? null,
      },
      runStore: store,
      candidateStore: store,
      studyIndex,
      actor: { role: actor.role },
      now: deps.now,
      sleep: deps.sleep,
      rng: deps.rng,
    },
  );
}

/**
 * Start ONE bounded, human-triggered (MANUAL) discovery run and return its safe
 * result. Recorded as a MANUAL `import_job`; not subject to the scheduled
 * overlap guard (M7.8 behaviour is unchanged).
 *
 * It re-checks the staff role (defense in depth over middleware + RLS), validates
 * the provider selection, wires the existing persistence adapters and registry
 * into the existing orchestrator with the conservative default budget, and never
 * exceeds the discovery boundary. The client's chosen provider and bounded query
 * are the ONLY inputs that cross from the request; identity, role, budget, host,
 * and every persistence decision are server-controlled.
 */
export async function runManualDiscovery(
  db: SqlExecutor,
  actor: Actor,
  input: ManualDiscoveryInput,
  deps: ManualDiscoveryDeps = {},
): Promise<DiscoveryRunResult> {
  return runComposedDiscovery(db, actor, input, "MANUAL", deps);
}

/**
 * Start ONE bounded, SCHEDULED discovery run and return its safe result (M7.9;
 * docs/30 §15, ADR-020 M7.9 amendment).
 *
 * This is the entry point a trusted, non-browser scheduled invocation uses (the
 * `/api/internal/discovery/run` endpoint, authenticated by a shared secret and
 * acting under a server-configured real staff actor). It reuses the EXACT M7.8
 * composition — the same orchestrator, registry, persistence adapters, closed
 * provider allowlist, and conservative `DEFAULT_BUDGET` — differing only in that
 * the run is recorded as a SCHEDULED `import_job` and is subject to the overlap
 * guard: if a run for the same source is still in progress the persistence
 * adapter throws `invalid-state` and NO new run row is created.
 *
 * Every LOCKED boundary is inherited unchanged: it discovers, normalizes,
 * conservatively deduplicates, and PERSISTS REVIEWABLE CANDIDATES ONLY. It never
 * publishes, classifies, scores, accepts, merges, deletes, calls AI, downloads
 * PDFs, or scrapes, and writes no canonical research/publication/classification.
 * The `actor` is resolved and role-checked server-side (never from the request);
 * the caller controls no URL, host, or budget.
 */
export async function runScheduledDiscovery(
  db: SqlExecutor,
  actor: Actor,
  input: ManualDiscoveryInput,
  deps: ManualDiscoveryDeps = {},
): Promise<DiscoveryRunResult> {
  return runComposedDiscovery(db, actor, input, "SCHEDULED", deps);
}
