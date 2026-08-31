/**
 * The discovery orchestrator (M7.3; docs/30 §Phase 2-3, 15-16, 21, 24-25).
 *
 * `runDiscovery` controls ONE bounded discovery run. It selects a provider
 * through the registry (never hard-coded per source), then for each discovered
 * item runs: (optional) fetch → normalize → identifier resolution → idempotency
 * check → conservative deduplication → a candidate DECISION → persistence through
 * the store PORT. It records an `import_job`-shaped run and `import_candidate`-
 * shaped candidates via the injected stores.
 *
 * LOCKED boundaries enforced here (and by tests): the run never publishes, never
 * creates canonical `research_study`/`publication`, never classifies
 * outcome/quality/efficacy, never calls AI, and refuses non-staff callers. One
 * bad item never aborts the run (failure isolation); the whole run stays bounded
 * by an enforced budget; retries are bounded.
 *
 * It imports no `@wise-evidence/database`, no Astro/React, and no AI — persistence
 * is the injected port. The real DB adapter (server-side, `service_role`) is
 * BLOCKED on an approved migration for candidate idempotency; see
 * `docs/reports/M7.3-DISCOVERY-RUN.md`.
 */
import { isDiscoveryError } from "../errors.js";
import type { DiscoveryProvider } from "../provider.js";
import type { DiscoveryProviderRegistry, DiscoveryProviderFactoryContext } from "../registry.js";
import type { NormalizedSourceItem, SourceItem } from "../types.js";
import { resolveBudget } from "./budget.js";
import { classifyDuplicate, type KnownStudyIndex } from "./dedup.js";
import { withRetry } from "./retry.js";
import type { CandidateStore, DiscoveryRunStore } from "./store.js";
import {
  ZERO_COUNTERS,
  type DiscoveryActor,
  type DiscoveryRunRequest,
  type DiscoveryRunResult,
  type DiscoveryRunTrigger,
  type RunCounters,
  type RunErrorEntry,
} from "./types.js";

/** A typed orchestrator failure that is NOT a per-item data failure. */
export class OrchestratorError extends Error {
  readonly reason: "forbidden";
  constructor(reason: "forbidden", message: string) {
    super(message);
    this.name = "OrchestratorError";
    this.reason = reason;
  }
}

/** Everything the orchestrator needs injected — nothing ambient. */
export interface RunDiscoveryDeps {
  readonly registry: DiscoveryProviderRegistry;
  /** Context handed to the registry factory (injected fetch, contact, clock). */
  readonly providerContext?: DiscoveryProviderFactoryContext;
  readonly runStore: DiscoveryRunStore;
  readonly candidateStore: CandidateStore;
  readonly studyIndex: KnownStudyIndex;
  /** Actor performing the run — must be staff. Never anonymous. */
  readonly actor: DiscoveryActor;
  /** Wall-clock source in ms (injected for deterministic tests). */
  readonly now?: () => number;
  /** Delay function for retry backoff (injected; no real timers in tests). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source for retry backoff. */
  readonly rng?: () => number;
}

const NEW_STATE = "REVIEW_REQUIRED";
const DUPLICATE_STATE = "DUPLICATE_CANDIDATE";

/** Run one bounded discovery run and return a safe, structured result. */
export async function runDiscovery(
  request: DiscoveryRunRequest,
  deps: RunDiscoveryDeps,
): Promise<DiscoveryRunResult> {
  // Authorization: discovery is an internal staff operation, never anonymous.
  if (deps.actor.role !== "REVIEWER" && deps.actor.role !== "ADMIN") {
    throw new OrchestratorError("forbidden", "discovery runs require a reviewer or admin actor");
  }

  const now = deps.now ?? (() => Date.now());
  const budget = resolveBudget(request.budget);
  const trigger: DiscoveryRunTrigger = request.trigger ?? "MANUAL";
  const sourceKeyHint = request.sourceKey;

  const counters: Mutable<RunCounters> = { ...ZERO_COUNTERS };
  const errors: RunErrorEntry[] = [];
  const startMs = now();
  const startedAt = new Date(startMs).toISOString();

  // Resolve the provider from the registry (fail closed on NOT_CONFIGURED).
  let provider: DiscoveryProvider;
  try {
    provider = deps.registry.resolve(request.providerType, {
      ...(deps.providerContext ?? {}),
      key: sourceKeyHint ?? deps.providerContext?.key,
    });
  } catch (error) {
    const runId = (
      await deps.runStore.createRun({
        sourceKey: sourceKeyHint ?? request.providerType,
        trigger,
        startedAt,
      })
    ).runId;
    recordError(errors, "resolve", error, null);
    const endedAt = new Date(now()).toISOString();
    await deps.runStore.finalizeRun(runId, {
      state: "FAILED",
      counters,
      endedAt,
      errorSummary: summarize(errors),
    });
    return result(
      runId,
      sourceKeyHint ?? request.providerType,
      request,
      trigger,
      "FAILED",
      counters,
      startedAt,
      endedAt,
      startMs,
      now,
      errors,
      "provider not configured",
    );
  }

  const sourceKey = provider.key;
  const { runId } = await deps.runStore.createRun({ sourceKey, trigger, startedAt });

  let stopReason = "pages exhausted";
  let runState: "COMPLETED" | "FAILED" = "COMPLETED";
  let cursor: string | null = null;

  pageLoop: for (let page = 0; page < budget.maxPages; page += 1) {
    if (counters.requests >= budget.maxRequests) {
      stopReason = "request budget reached";
      break;
    }
    if (now() - startMs > budget.maxDurationMs) {
      stopReason = "duration budget reached";
      break;
    }

    const discovered = await withRetry(
      () => {
        counters.requests += 1;
        return provider.discover({
          query: request.query,
          identifiers: request.identifiers,
          pageSize: budget.pageSize,
          cursor,
        });
      },
      {
        maxRetries: budget.maxRetriesPerRequest,
        baseDelayMs: 50,
        maxDelayMs: budget.maxDurationMs,
        sleep: deps.sleep,
        rng: deps.rng,
        onRetry: () => {
          counters.retries += 1;
        },
        canRetry: () => counters.requests < budget.maxRequests,
      },
    );

    if (!discovered.result.ok) {
      recordError(errors, "discover", discovered.result.error, null);
      // A first-page failure is fatal; a later-page failure ends pagination.
      runState = page === 0 ? "FAILED" : "COMPLETED";
      stopReason = page === 0 ? "discover failed" : "discover failed after partial run";
      break;
    }

    const pageValue = discovered.result.value;
    counters.pages += 1;

    for (const item of pageValue.items) {
      if (counters.discovered >= budget.maxItems) {
        stopReason = "item budget reached";
        break pageLoop;
      }
      if (counters.candidates >= budget.maxCandidates) {
        stopReason = "candidate budget reached";
        break pageLoop;
      }
      counters.discovered += 1;
      try {
        await processItem(item, {
          provider,
          request,
          deps,
          budget,
          counters,
          errors,
          runId,
          sourceKey,
        });
      } catch (error) {
        // Failure isolation: one bad item never aborts the run.
        counters.failed += 1;
        recordError(errors, "item", error, item.sourceId || null);
      }
    }

    cursor = pageValue.nextCursor;
    if (cursor === null) {
      stopReason = "pages exhausted";
      break;
    }
  }

  const endedAt = new Date(now()).toISOString();
  await deps.runStore.finalizeRun(runId, {
    state: runState,
    counters,
    endedAt,
    errorSummary: summarize(errors),
  });

  return result(
    runId,
    sourceKey,
    request,
    trigger,
    runState,
    counters,
    startedAt,
    endedAt,
    startMs,
    now,
    errors,
    stopReason,
  );
}

interface ProcessCtx {
  readonly provider: DiscoveryProvider;
  readonly request: DiscoveryRunRequest;
  readonly deps: RunDiscoveryDeps;
  readonly budget: ReturnType<typeof resolveBudget>;
  readonly counters: Mutable<RunCounters>;
  readonly errors: RunErrorEntry[];
  readonly runId: string;
  readonly sourceKey: string;
}

/** Process one discovered item end-to-end. Throws only on unexpected faults. */
async function processItem(item: SourceItem, ctx: ProcessCtx): Promise<void> {
  const { provider, request, deps, budget, counters, errors, runId, sourceKey } = ctx;

  let working = item;

  // Optional detail fetch (enrichment, never acceptance).
  if (request.fetchDetail === true && provider.descriptor.capabilities.canFetch) {
    if (counters.requests >= budget.maxRequests) {
      counters.skipped += 1;
      return;
    }
    const fetched = await withRetry(
      () => {
        counters.requests += 1;
        return provider.fetch({ sourceKey, sourceId: item.sourceId });
      },
      {
        maxRetries: budget.maxRetriesPerRequest,
        baseDelayMs: 50,
        maxDelayMs: budget.maxDurationMs,
        sleep: deps.sleep,
        rng: deps.rng,
        onRetry: () => {
          counters.retries += 1;
        },
        canRetry: () => counters.requests < budget.maxRequests,
      },
    );
    if (!fetched.result.ok) {
      counters.failed += 1;
      recordError(errors, "fetch", fetched.result.error, item.sourceId || null);
      return;
    }
    counters.fetched += 1;
    working = fetched.result.value.item;
  }

  // Normalize through the existing boundary (no second normalization system).
  const normalizedResult = provider.normalize(working);
  if (!normalizedResult.ok) {
    counters.invalid += 1;
    recordError(errors, "normalize", normalizedResult.error, working.sourceId || null);
    return;
  }
  counters.normalized += 1;
  const normalized = normalizedResult.value;

  // Identifier resolution: the stable per-source id is the idempotency key.
  const stableSourceId = normalized.provenance.sourceId;
  if (stableSourceId.length === 0) {
    counters.invalid += 1;
    return;
  }

  // Idempotency: a re-run of the same source item must not create a 2nd candidate.
  const existing = await deps.candidateStore.findCandidateByIdentity(sourceKey, stableSourceId);
  if (existing !== null) {
    counters.skipped += 1;
    return;
  }

  // Conservative deduplication against existing canonical studies.
  const dedup = await classifyDuplicate(normalized, deps.studyIndex);
  if (dedup.verdict !== "NEW") {
    counters.duplicates += 1;
  }

  // Persist a REVIEWABLE candidate (never a canonical record; never published).
  const inserted = await deps.candidateStore.insertCandidate({
    runId,
    sourceKey,
    stableSourceId,
    normalizedPayload: minimisePayload(normalized),
    rawHash: normalized.provenance.rawHash,
    dedup,
    state: dedup.verdict === "NEW" ? NEW_STATE : DUPLICATE_STATE,
  });
  if (inserted.created) {
    counters.candidates += 1;
  } else {
    // Lost an idempotency race — treat as skipped, never a second candidate.
    counters.skipped += 1;
  }
}

/** A minimised, sanitized view of the normalized item for candidate storage. */
function minimisePayload(n: NormalizedSourceItem): Record<string, unknown> {
  return {
    canonicalDoi: n.canonicalDoi,
    title: n.title,
    normalizedTitle: n.normalizedTitle,
    authors: n.authors,
    journal: n.journal,
    publicationDate: n.publicationDate,
    abstract: n.abstract,
    url: n.url,
    identifiers: n.identifiers,
    provenance: n.provenance,
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function recordError(
  errors: RunErrorEntry[],
  phase: RunErrorEntry["phase"],
  error: unknown,
  sourceId: string | null,
): void {
  if (isDiscoveryError(error)) {
    errors.push({ phase, code: error.code, message: error.message, sourceId });
  } else if (error instanceof Error) {
    errors.push({ phase, code: "UNEXPECTED", message: error.message, sourceId });
  } else {
    errors.push({ phase, code: "UNEXPECTED", message: "unknown error", sourceId });
  }
}

function summarize(errors: readonly RunErrorEntry[]): string | null {
  if (errors.length === 0) return null;
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
  return [...counts.entries()].map(([code, n]) => `${code}:${n}`).join(", ");
}

function result(
  runId: string,
  sourceKey: string,
  request: DiscoveryRunRequest,
  trigger: DiscoveryRunTrigger,
  state: "COMPLETED" | "FAILED",
  counters: RunCounters,
  startedAt: string,
  endedAt: string,
  startMs: number,
  now: () => number,
  errors: readonly RunErrorEntry[],
  stopReason: string,
): DiscoveryRunResult {
  return {
    runId,
    sourceKey,
    providerType: request.providerType,
    state,
    trigger,
    counters: { ...counters },
    startedAt,
    endedAt,
    durationMs: Math.max(0, now() - startMs),
    errors: [...errors],
    stopReason,
  };
}
