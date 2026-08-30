/**
 * SourceDescriptor — provider-neutral source configuration & capabilities
 * (M7.1; docs/30, ADR-020 design intent).
 *
 * A descriptor is PUBLIC configuration: everything the app needs to know about a
 * source's identity, limits, and policy — and NOTHING secret. Secrets (API keys,
 * tokens) are handled by reference on the server side (cf. the AI `secretRef`
 * pattern, ADR-019) and never appear on a descriptor. A test asserts that a
 * descriptor structurally cannot carry a secret-shaped field.
 *
 * Crossref/PubMed behaviour is NOT baked into this type — a descriptor only
 * declares capabilities, hosts, and limits. An adapter interprets them.
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports; no I/O.
 */
import type { DiscoveryProviderType, SourceIdentifierType, SourceKey } from "./types.js";

/** Token-bucket-ish rate configuration a provider must respect. */
export interface RateLimitConfig {
  /** Sustained request rate ceiling. */
  readonly requestsPerSecond: number;
  /** Maximum burst above the sustained rate. */
  readonly burst: number;
}

/** What operations a source supports. Callers negotiate against this. */
export interface DiscoveryCapabilities {
  readonly canDiscover: boolean;
  readonly canFetch: boolean;
  readonly canPaginate: boolean;
  /** Whether the source is expected to supply abstracts. */
  readonly providesAbstracts: boolean;
}

/**
 * Provider-neutral configuration for one configured source. Contains only
 * identity, capability, policy, and limit information — no secrets, no
 * Crossref-specific fields.
 */
export interface SourceDescriptor {
  /** Stable source key, e.g. "mock" or "crossref". */
  readonly key: SourceKey;
  /** Human-readable name for admin UI. */
  readonly displayName: string;
  /** Which adapter kind backs this source. */
  readonly providerType: DiscoveryProviderType;
  /** Exact hostnames (and their sub-domains) the source may be reached at. */
  readonly allowedHosts: readonly string[];
  /** Require https for all requests (except a permitted local endpoint). */
  readonly requireHttps: boolean;
  /** Opt-in to private/loopback hosts (dev/self-hosted only). Default false. */
  readonly allowLocalNetwork: boolean;
  /** Per-request time budget in milliseconds. */
  readonly timeoutMs: number;
  /** Hard cap on a single response body size in bytes. */
  readonly maxResponseBytes: number;
  /** Maximum items a single discovery page may return. */
  readonly maxItemsPerRequest: number;
  /** Safety ceiling on candidates produced by one discovery run. */
  readonly maxCandidatesPerRun: number;
  /** Rate-limit policy the provider must respect. */
  readonly rateLimit: RateLimitConfig;
  /** Identifier kinds this source can be queried by / reports. */
  readonly supportedIdentifierTypes: readonly SourceIdentifierType[];
  /** Declared capabilities. */
  readonly capabilities: DiscoveryCapabilities;
}

/** Conservative defaults shared by descriptors unless a source overrides them. */
export const DEFAULT_DESCRIPTOR_LIMITS = {
  requireHttps: true,
  allowLocalNetwork: false,
  timeoutMs: 10_000,
  maxResponseBytes: 5_000_000,
  maxItemsPerRequest: 50,
  maxCandidatesPerRun: 500,
  rateLimit: { requestsPerSecond: 1, burst: 2 },
} as const;

/**
 * The built-in descriptor for the offline mock source. It allow-lists no real
 * host and requires https by policy — the mock makes NO network request, so the
 * fields are declarative only, proving the shape a real source will fill in.
 */
export const MOCK_SOURCE_DESCRIPTOR: SourceDescriptor = {
  key: "mock",
  displayName: "Mock Discovery Source (offline)",
  providerType: "MOCK",
  allowedHosts: [],
  requireHttps: DEFAULT_DESCRIPTOR_LIMITS.requireHttps,
  allowLocalNetwork: DEFAULT_DESCRIPTOR_LIMITS.allowLocalNetwork,
  timeoutMs: DEFAULT_DESCRIPTOR_LIMITS.timeoutMs,
  maxResponseBytes: DEFAULT_DESCRIPTOR_LIMITS.maxResponseBytes,
  maxItemsPerRequest: 10,
  maxCandidatesPerRun: 100,
  rateLimit: DEFAULT_DESCRIPTOR_LIMITS.rateLimit,
  supportedIdentifierTypes: ["DOI", "SOURCE_ID", "URL"],
  capabilities: {
    canDiscover: true,
    canFetch: true,
    canPaginate: true,
    providesAbstracts: true,
  },
};
