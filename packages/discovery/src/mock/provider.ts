/**
 * MockDiscoveryProvider — deterministic, offline discovery for CI and local dev
 * (M7.1; docs/20, docs/30). It makes NO network request, uses NO randomness, and
 * takes an injected clock, so every run is reproducible.
 *
 * It implements the full `DiscoveryProvider` contract against a fixture
 * `MockDiscoveryDataset`: paged discovery, single-item fetch with simulated
 * failures, and pure normalization (delegated to `normalizeSourceItem`). It
 * exercises the M7.1 scenarios — success, multiple pages, empty result,
 * duplicate item, malformed item, missing/invalid DOI, fetch failure, timeout,
 * and rate limiting — WITHOUT any real source.
 *
 * It writes nothing canonical, classifies nothing, and accepts nothing:
 * discovery ≠ publication, fetch ≠ acceptance, candidate ≠ research record.
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports.
 */
import { DiscoveryError, type DiscoveryErrorCode } from "../errors.js";
import { normalizeSourceItem } from "../normalize.js";
import type { DiscoveryProvider } from "../provider.js";
import { MOCK_SOURCE_DESCRIPTOR, type SourceDescriptor } from "../descriptor.js";
import {
  DISCOVERY_LIMITS,
  sanitizeHttpUrl,
  sanitizeMarkupToText,
  sanitizeText,
} from "../sanitize.js";
import { hashRawPayload } from "../hash.js";
import type {
  DiscoveryPage,
  DiscoveryRequest,
  DiscoveryResult,
  FetchResult,
  NormalizedSourceItem,
  SourceIdentifier,
  SourceItem,
  SourceItemRef,
} from "../types.js";
import {
  DEFAULT_DISCOVERY_DATASET,
  type MockDiscoveryDataset,
  type MockFetchErrorCode,
  type RawMockItem,
} from "./fixtures.js";

/** The connector version recorded in provenance. Bump when the mock changes. */
export const MOCK_DISCOVERY_VERSION = "mock-discovery/1";

/** A fixed, deterministic clock so timestamps never vary between runs. */
export const FIXED_MOCK_CLOCK = (): string => "2026-01-01T00:00:00.000Z";

export interface MockDiscoveryProviderOptions {
  /** Override the source key (default "mock"). */
  readonly key?: string;
  /** The descriptor to expose (default `MOCK_SOURCE_DESCRIPTOR`). */
  readonly descriptor?: SourceDescriptor;
  /** The fixture dataset (default `DEFAULT_DISCOVERY_DATASET`). */
  readonly dataset?: MockDiscoveryDataset;
  /** Deterministic clock returning an ISO timestamp (default `FIXED_MOCK_CLOCK`). */
  readonly clock?: () => string;
  /**
   * Simulate rate limiting: after this many successful `discover()` calls the
   * next call returns `RATE_LIMITED`. Deterministic per call sequence.
   */
  readonly maxDiscoverCalls?: number;
  /** Connector version for provenance (default `MOCK_DISCOVERY_VERSION`). */
  readonly version?: string;
}

/** Map the fixture's fetch-error codes onto the public discovery error codes. */
const FETCH_ERROR_CODE: Record<MockFetchErrorCode, DiscoveryErrorCode> = {
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  FETCH_FAILED: "FETCH_FAILED",
  MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
};

export class MockDiscoveryProvider implements DiscoveryProvider {
  readonly key: string;
  readonly descriptor: SourceDescriptor;
  readonly version: string;

  readonly #dataset: MockDiscoveryDataset;
  readonly #clock: () => string;
  readonly #maxDiscoverCalls: number;
  #discoverCalls = 0;

  constructor(options: MockDiscoveryProviderOptions = {}) {
    const descriptor = options.descriptor ?? MOCK_SOURCE_DESCRIPTOR;
    this.key = options.key ?? descriptor.key;
    this.descriptor = descriptor;
    this.version = options.version ?? MOCK_DISCOVERY_VERSION;
    this.#dataset = options.dataset ?? DEFAULT_DISCOVERY_DATASET;
    this.#clock = options.clock ?? FIXED_MOCK_CLOCK;
    this.#maxDiscoverCalls = options.maxDiscoverCalls ?? Number.POSITIVE_INFINITY;
  }

  discover(request: DiscoveryRequest): Promise<DiscoveryResult<DiscoveryPage>> {
    this.#discoverCalls += 1;
    if (this.#discoverCalls > this.#maxDiscoverCalls) {
      return Promise.resolve(this.#fail("RATE_LIMITED", "discovery call budget exceeded"));
    }

    const pageIndex = this.#decodeCursor(request.cursor ?? null);
    if (pageIndex === null) {
      return Promise.resolve(this.#fail("MALFORMED_RESPONSE", "cursor is not a valid page token"));
    }

    const rawPage = this.#dataset.pages[pageIndex] ?? [];
    const limit = Math.min(
      request.pageSize ?? this.descriptor.maxItemsPerRequest,
      this.descriptor.maxItemsPerRequest,
    );
    const items = rawPage.slice(0, limit).map((raw) => this.#toSourceItem(raw));

    const hasNext = pageIndex + 1 < this.#dataset.pages.length;
    const page: DiscoveryPage = {
      source: this.key,
      items,
      nextCursor: hasNext ? String(pageIndex + 1) : null,
      discoveredAt: this.#clock(),
    };
    return Promise.resolve({ ok: true, value: page });
  }

  fetch(ref: SourceItemRef): Promise<DiscoveryResult<FetchResult>> {
    const behavior = this.#dataset.fetchBehaviors?.[ref.sourceId];
    if (behavior?.kind === "error") {
      const code = FETCH_ERROR_CODE[behavior.code];
      return Promise.resolve(
        this.#fail(code, behavior.message ?? `fetch failed for '${ref.sourceId}'`),
      );
    }

    const raw = this.#findRaw(ref.sourceId);
    if (raw === null) {
      return Promise.resolve(
        this.#fail("FETCH_FAILED", `no item with source id '${ref.sourceId}'`),
      );
    }

    const item = this.#toSourceItem(raw);
    const result: FetchResult = {
      sourceKey: this.key,
      sourceId: item.sourceId,
      item,
      fetchedAt: this.#clock(),
      rawHash: hashRawPayload(item.raw),
    };
    return Promise.resolve({ ok: true, value: result });
  }

  normalize(item: SourceItem): DiscoveryResult<NormalizedSourceItem> {
    return normalizeSourceItem(item, {
      discoveredAt: this.#clock(),
      fetchedAt: null,
      providerVersion: this.version,
      rawHash: hashRawPayload(item.raw),
    });
  }

  // --- internals -----------------------------------------------------------

  #fail(
    code: DiscoveryErrorCode,
    message: string,
  ): { readonly ok: false; readonly error: DiscoveryError } {
    return {
      ok: false,
      error: new DiscoveryError(code, `source '${this.key}': ${message}`, { source: this.key }),
    };
  }

  /** Decode our own opaque cursor (page index as string). null = invalid. */
  #decodeCursor(cursor: string | null): number | null {
    if (cursor === null) return 0;
    if (!/^\d+$/.test(cursor)) return null;
    return Number(cursor);
  }

  #findRaw(sourceId: string): RawMockItem | null {
    for (const page of this.#dataset.pages) {
      for (const raw of page) {
        if ((raw.sourceId ?? "") === sourceId && sourceId.length > 0) {
          return raw;
        }
      }
    }
    return null;
  }

  /** Turn a raw fixture item into a sanitized `SourceItem` (still untrusted). */
  #toSourceItem(raw: RawMockItem): SourceItem {
    const identifiers: SourceIdentifier[] = (raw.identifiers ?? [])
      .slice(0, DISCOVERY_LIMITS.maxIdentifiers)
      .map((id) => ({
        type: id.type,
        value: sanitizeText(id.value, DISCOVERY_LIMITS.identifier) ?? "",
      }))
      .filter((id) => id.value.length > 0);

    return {
      sourceKey: this.key,
      sourceId: sanitizeText(raw.sourceId, DISCOVERY_LIMITS.identifier) ?? "",
      sourceUrl: raw.sourceUrl != null ? sanitizeHttpUrl(raw.sourceUrl) : null,
      doi: raw.doi != null ? sanitizeText(raw.doi, DISCOVERY_LIMITS.identifier) : null,
      identifiers,
      title: sanitizeText(raw.title, DISCOVERY_LIMITS.title),
      authors: (raw.authors ?? [])
        .slice(0, DISCOVERY_LIMITS.maxAuthors)
        .map((name) => sanitizeText(name, DISCOVERY_LIMITS.authorName))
        .filter((name): name is string => name !== null),
      journal: sanitizeText(raw.journal, DISCOVERY_LIMITS.journal),
      publicationDate: sanitizeText(raw.publicationDate, DISCOVERY_LIMITS.date),
      abstract: sanitizeMarkupToText(raw.abstract, DISCOVERY_LIMITS.abstract),
      raw: { ...(raw.extra ?? {}) },
    };
  }
}
