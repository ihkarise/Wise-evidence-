/**
 * The DiscoveryProvider contract (M7.1; docs/30, ADR-020 design intent).
 *
 * This is the provider-neutral seam every source adapter implements. It models
 * three conceptual operations and nothing more:
 *
 *   discover()  — enumerate items from the source, one page at a time
 *   fetch()     — retrieve one item's detail record (enrichment, not acceptance)
 *   normalize() — turn a raw source item into a sanitized, canonicalised view
 *
 * A provider MUST NOT throw for expected failures: `discover`/`fetch` return a
 * `DiscoveryResult` FAILURE carrying a typed `DiscoveryError`, and `normalize`
 * (pure, synchronous) does the same. Only truly exceptional/programming faults
 * throw.
 *
 * What a provider is FORBIDDEN to do (the LOCKED M7 boundary):
 *   - publish or create canonical research
 *   - assign outcome / efficacy / evidence-quality / criticism
 *   - accept or approve a candidate
 *   - write to the canonical DB or bypass RLS
 *   - expose a generic "fetch any URL" capability
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports.
 */
import type { SourceDescriptor } from "./descriptor.js";
import type {
  DiscoveryPage,
  DiscoveryRequest,
  DiscoveryResult,
  FetchResult,
  NormalizedSourceItem,
  SourceItem,
  SourceItemRef,
  SourceKey,
} from "./types.js";

export interface DiscoveryProvider {
  /** Stable source key (matches `descriptor.key`), stored as provenance. */
  readonly key: SourceKey;
  /** The provider-neutral configuration & capabilities for this source. */
  readonly descriptor: SourceDescriptor;
  /** Connector/provider version recorded in provenance, e.g. "mock-discovery/1". */
  readonly version: string;

  /**
   * Enumerate one page of items. Pagination is via the opaque
   * `request.cursor`; the returned page's `nextCursor` is null when exhausted.
   * Never throws for source-down / malformed / rate-limited cases.
   */
  discover(request: DiscoveryRequest): Promise<DiscoveryResult<DiscoveryPage>>;

  /**
   * Retrieve a single item's detail record. Enrichment only — this never
   * accepts the item as a candidate and never writes anything canonical.
   */
  fetch(ref: SourceItemRef): Promise<DiscoveryResult<FetchResult>>;

  /**
   * Pure, synchronous normalization of a raw source item into a sanitized,
   * canonicalised `NormalizedSourceItem` with provenance. Returns a FAILURE for
   * structurally broken (`NORMALIZATION_FAILED`) or too-thin
   * (`INSUFFICIENT_METADATA`) items. Performs no I/O.
   */
  normalize(item: SourceItem): DiscoveryResult<NormalizedSourceItem>;
}
