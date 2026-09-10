/**
 * Discovery orchestrator types (M7.3; docs/30, ADR-020).
 *
 * The orchestrator controls one bounded discovery RUN: it drives a registry-
 * selected `DiscoveryProvider` through discover → (fetch) → normalize →
 * identifier resolution → deduplication → a candidate DECISION, and persists
 * REVIEWABLE candidates through a persistence PORT. It writes NOTHING canonical,
 * never publishes, never classifies outcome/quality/efficacy, and never calls AI.
 *
 * Persistence is expressed as PORT INTERFACES only (see store.ts) so the
 * orchestrator — and this whole package — keeps its M7.1 boundary: it imports no
 * `@wise-evidence/database`, no Astro/React, no AI. The real database adapter for
 * `import_job` / `import_candidate` is implemented elsewhere (server-side, via
 * `service_role`); an in-memory adapter backs the offline tests.
 *
 * NOTE (M7.3 schema firewall): DB-enforced candidate idempotency on
 * `(source_key, stable_source_id)` is NOT supported by the current
 * `import_candidate` schema and is BLOCKED on an approved migration — see
 * `docs/reports/M7.3-DISCOVERY-RUN.md`. These types model the intended shape so
 * the future adapter is a drop-in.
 */
import type { DiscoveryProviderType, SourceIdentifier } from "../types.js";

/** Lifecycle state of a discovery run (maps to `import_job_state`). */
export type DiscoveryRunState = "RUNNING" | "COMPLETED" | "FAILED";

/** How a run was triggered (maps to `import_job_trigger`). Never anonymous. */
export type DiscoveryRunTrigger = "MANUAL" | "SCHEDULED";

/** The minimal actor identity used only to refuse non-staff callers. */
export interface DiscoveryActor {
  readonly role: "PUBLIC" | "REVIEWER" | "ADMIN";
}

/**
 * Hard-bounded run budget. Every field has a conservative default and a hard
 * maximum the caller cannot exceed (see budget.ts). A run can never be unbounded.
 */
export interface DiscoveryBudget {
  /** Maximum discovery pages to request. */
  readonly maxPages: number;
  /** Maximum source items to process across the whole run. */
  readonly maxItems: number;
  /** Maximum candidates to persist. */
  readonly maxCandidates: number;
  /** Maximum provider requests (discover + fetch + retries). */
  readonly maxRequests: number;
  /** Maximum wall-clock duration in milliseconds. */
  readonly maxDurationMs: number;
  /** Maximum retries per individual provider request. */
  readonly maxRetriesPerRequest: number;
  /** Requested page size (clamped by the provider descriptor too). */
  readonly pageSize: number;
}

/** What the caller asks a run to do. */
export interface DiscoveryRunRequest {
  /** Which provider to run — resolved through the registry (never hard-coded). */
  readonly providerType: DiscoveryProviderType;
  /** Optional source key override (a source may reuse an adapter). */
  readonly sourceKey?: string;
  /** Free-text query passed to the provider. */
  readonly query?: string;
  /** Seek specific items by identifier (e.g. DOIs). */
  readonly identifiers?: readonly SourceIdentifier[];
  /** Whether to call `provider.fetch` for each discovered item (default false). */
  readonly fetchDetail?: boolean;
  /** Run trigger recorded on the job (default MANUAL). */
  readonly trigger?: DiscoveryRunTrigger;
  /** Partial budget overrides (each clamped to its hard maximum). */
  readonly budget?: Partial<DiscoveryBudget>;
}

/** Per-run counters. Every number is an observed count — never fabricated. */
export interface RunCounters {
  readonly pages: number;
  readonly discovered: number;
  readonly fetched: number;
  readonly normalized: number;
  readonly invalid: number;
  readonly duplicates: number;
  readonly candidates: number;
  readonly failed: number;
  readonly skipped: number;
  readonly requests: number;
  readonly retries: number;
}

/** A safe, non-secret error entry recorded on the run. */
export interface RunErrorEntry {
  readonly phase: "resolve" | "discover" | "fetch" | "normalize" | "persist" | "item";
  readonly code: string;
  readonly message: string;
  /** The source item id the error relates to, when known. */
  readonly sourceId: string | null;
}

/** The graded duplicate verdict for a candidate (docs/30, master prompt §16). */
export type DuplicateVerdict =
  "NEW" | "DEFINITE_DUPLICATE" | "PROBABLE_DUPLICATE" | "POSSIBLE_DUPLICATE";

/** What a duplicate was matched by, in the approved graded order. */
export type DuplicateMatchedBy = "DOI" | "PERSISTENT_ID" | "TITLE_YEAR" | "TITLE" | null;

/**
 * An enumerated, auditable reason for a deduplication verdict (M7.5). Every
 * decision carries exactly one code so a reviewer sees WHY the engine reached its
 * verdict without parsing prose. The codes map 1:1 onto the matching hierarchy:
 *
 *   DOI_EXACT_MATCH             → LEVEL 1  (DEFINITE)
 *   PERSISTENT_IDENTIFIER_MATCH → LEVEL 2  (DEFINITE)
 *   TITLE_YEAR_MATCH            → LEVEL 3  (PROBABLE)
 *   TITLE_EXACT_MATCH           → LEVEL 4  (POSSIBLE — includes the year-conflict case)
 *   INSUFFICIENT_METADATA       → no comparable identity was available to check
 *   NO_MATCH                    → checked, nothing matched (NEW)
 *
 * `TITLE_SIMILAR` (LEVEL 5, fuzzy similarity) is deliberately NOT implemented in
 * M7.5 — it is the highest false-positive risk and would require either an
 * unauthorized `pg_trgm` migration or an unbounded scan (see
 * docs/reports/M7.5-DEDUPLICATION.md). It is intentionally absent from this union.
 */
export type DedupReasonCode =
  | "DOI_EXACT_MATCH"
  | "PERSISTENT_IDENTIFIER_MATCH"
  | "TITLE_YEAR_MATCH"
  | "TITLE_EXACT_MATCH"
  | "INSUFFICIENT_METADATA"
  | "NO_MATCH";

/**
 * Structured, reviewer-facing explanation of a deduplication decision (M7.5).
 * It records WHICH signals contributed so a human can adjudicate — it is an
 * identity signal ONLY and never implies outcome, quality, confidence, efficacy,
 * or scientific validity. All values are safe (canonical identifiers / years),
 * never raw untrusted markup.
 */
export interface DedupExplanation {
  /** The enumerated reason for the verdict. */
  readonly reasonCode: DedupReasonCode;
  /** Identifier type that matched (DOI/PMID/PMCID/ARXIV), or null. */
  readonly matchedIdentifierType: string | null;
  /** The canonical identifier value that matched, or null. */
  readonly matchedIdentifierValue: string | null;
  /** Whether the normalized title matched an existing study. */
  readonly titleMatched: boolean;
  /** The candidate's publication year (`YYYY`), or null when unknown. */
  readonly candidateYear: string | null;
  /** The matched study's known publication years (empty when none/unknown). */
  readonly matchedStudyYears: readonly string[];
  /**
   * True when the title matched but the candidate's year could not be confirmed
   * against the matched study (year absent on either side, or years differ). A
   * year conflict is why a title match stays POSSIBLE, never PROBABLE.
   */
  readonly yearConflict: boolean;
}

/** The conservative deduplication decision for one candidate. */
export interface DedupDecision {
  readonly verdict: DuplicateVerdict;
  readonly matchedBy: DuplicateMatchedBy;
  /** Existing canonical study this candidate may duplicate (never merged). */
  readonly relatedStudyId: string | null;
  /** Safe, human-readable reason preserved for the reviewer. */
  readonly reason: string;
  /** Structured explainability for the reviewer (M7.5). */
  readonly explanation: DedupExplanation;
}

/** The safe, structured result of a run (observability; no secrets/raw payloads). */
export interface DiscoveryRunResult {
  readonly runId: string;
  readonly sourceKey: string;
  readonly providerType: DiscoveryProviderType;
  readonly state: DiscoveryRunState;
  readonly trigger: DiscoveryRunTrigger;
  readonly counters: RunCounters;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly errors: readonly RunErrorEntry[];
  /** Why the run stopped (budget hit, exhausted pages, fatal error). */
  readonly stopReason: string;
}

/** The zeroed counter set. */
export const ZERO_COUNTERS: RunCounters = {
  pages: 0,
  discovered: 0,
  fetched: 0,
  normalized: 0,
  invalid: 0,
  duplicates: 0,
  candidates: 0,
  failed: 0,
  skipped: 0,
  requests: 0,
  retries: 0,
};
