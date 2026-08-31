/**
 * @wise-evidence/discovery — provider-neutral automated-discovery foundation
 * (M7.1; docs/30, ADR-020 design intent).
 *
 * Public surface: the `DiscoveryProvider` contract, the `SourceDescriptor` and
 * host policy, the typed discovery objects and errors, the source/provider
 * registry seam, the pure normalizer, and the deterministic offline
 * `MockDiscoveryProvider` with its fixtures.
 *
 * The LOCKED M7 boundary holds here: discovery may discover / fetch / normalize
 * / (eventually) queue candidates — it NEVER publishes, classifies, assigns
 * outcome/efficacy, accepts a candidate, or writes canonical research. This
 * package imports nothing from Astro, React, Supabase, web UI, or any AI SDK;
 * it reuses only DOI/title canonicalisation from @wise-evidence/domain.
 */

// Contracts & types
export type {
  SourceKey,
  DiscoveryProviderType,
  SourceIdentifierType,
  SourceIdentifier,
  DiscoveryResult,
  DiscoveryCursor,
  DiscoveryRequest,
  SourceItem,
  SourceItemRef,
  DiscoveryPage,
  FetchResult,
  Provenance,
  NormalizedSourceItem,
} from "./types.js";

export type { DiscoveryProvider } from "./provider.js";

// Errors
export {
  DiscoveryError,
  isDiscoveryError,
  redactMessage,
  type DiscoveryErrorCode,
  type DiscoveryErrorOptions,
} from "./errors.js";

// Descriptor & host policy
export {
  MOCK_SOURCE_DESCRIPTOR,
  DEFAULT_DESCRIPTOR_LIMITS,
  type SourceDescriptor,
  type RateLimitConfig,
  type DiscoveryCapabilities,
} from "./descriptor.js";

export { isPrivateHost, isHostAllowed, isUrlAllowed, assertUrlAllowed } from "./host-policy.js";

// Sanitizers & hashing (untrusted-input handling + provenance)
export {
  sanitizeText,
  sanitizeMarkupToText,
  sanitizeHttpUrl,
  DISCOVERY_LIMITS,
} from "./sanitize.js";

export { canonicalize, sha256Hex, hashRawPayload } from "./hash.js";

// Normalization
export { normalizeSourceItem, type NormalizationContext } from "./normalize.js";

// Registry / seam
export {
  DiscoveryProviderRegistry,
  createDefaultDiscoveryRegistry,
  KNOWN_PROVIDER_TYPES,
  type DiscoveryProviderFactory,
  type DiscoveryProviderFactoryContext,
} from "./registry.js";

// Injected HTTP transport (for networked connectors)
export {
  ResponseTooLargeError,
  readBoundedText,
  isJsonContentType,
  type FetchLike,
  type FetchLikeResponse,
} from "./http.js";

// Deterministic offline mock
export {
  MockDiscoveryProvider,
  MOCK_DISCOVERY_VERSION,
  FIXED_MOCK_CLOCK,
  type MockDiscoveryProviderOptions,
} from "./mock/provider.js";

// Crossref connector (M7.2) — first real DiscoveryProvider
export {
  CrossrefDiscoveryProvider,
  CROSSREF_SOURCE_DESCRIPTOR,
  CROSSREF_HOST,
  CROSSREF_DISCOVERY_VERSION,
  type CrossrefDiscoveryProviderOptions,
} from "./crossref/provider.js";

// Discovery orchestrator (M7.3) — bounded controlled run + persistence ports
export {
  runDiscovery,
  OrchestratorError,
  type RunDiscoveryDeps,
} from "./orchestrator/orchestrator.js";

export { DEFAULT_BUDGET, HARD_MAX_BUDGET, resolveBudget } from "./orchestrator/budget.js";

export { classifyDuplicate, yearOf, type KnownStudyIndex } from "./orchestrator/dedup.js";

export { withRetry, parseRetryAfterMs, type RetryOptions } from "./orchestrator/retry.js";

export {
  InMemoryDiscoveryStore,
  InMemoryStudyIndex,
  type DiscoveryRunStore,
  type CandidateStore,
  type CreateRunInput,
  type FinalizeRunInput,
  type CandidateRecordInput,
  type StoredRun,
  type StoredCandidate,
  type SeedStudy,
} from "./orchestrator/store.js";

export type {
  DiscoveryActor,
  DiscoveryBudget,
  DiscoveryRunRequest,
  DiscoveryRunResult,
  DiscoveryRunState,
  DiscoveryRunTrigger,
  RunCounters,
  RunErrorEntry,
  DedupDecision,
  DuplicateVerdict,
  DuplicateMatchedBy,
} from "./orchestrator/types.js";

export {
  DEFAULT_DISCOVERY_DATASET,
  EMPTY_DISCOVERY_DATASET,
  CLEAN_DISCOVERY_DATASET,
  type MockDiscoveryDataset,
  type RawMockItem,
  type MockFetchBehavior,
  type MockFetchErrorCode,
} from "./mock/fixtures.js";
