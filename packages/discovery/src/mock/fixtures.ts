/**
 * Deterministic fixtures for the offline MockDiscoveryProvider (M7.1; docs/20,
 * docs/30). Everything here is static data — no randomness, no clock, no network
 * — so tests and local dev are reproducible.
 *
 * DOIs use the reserved, non-existent `10.0000/…` registrant so they can never
 * collide with a real DOI (same convention as the DEMO fixtures, docs/25 §9).
 *
 * The default dataset deliberately spans the scenarios M7.1 must exercise:
 * multiple pages, a normal item with a DOI, a missing-DOI item, an
 * invalid-DOI item, a duplicate item (same DOI as an earlier one), and a
 * malformed item (no source id / no title). Named per-behaviour datasets cover
 * the empty case; per-item fetch behaviours cover fetch failure / timeout /
 * rate limiting.
 */
import type { SourceIdentifierType } from "../types.js";

/** A relaxed, source-shaped raw item. Values are sanitized when read out. */
export interface RawMockItem {
  /** Stable id within the source. Omitted/empty models a malformed item. */
  readonly sourceId?: string;
  readonly sourceUrl?: string | null;
  readonly doi?: string | null;
  readonly identifiers?: readonly { readonly type: SourceIdentifierType; readonly value: string }[];
  readonly title?: string | null;
  readonly authors?: readonly string[];
  readonly journal?: string | null;
  readonly publicationDate?: string | null;
  readonly abstract?: string | null;
  /** Source-specific extra fields carried verbatim (untrusted). */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** How the mock should behave when `fetch()` is called for a given source id. */
export type MockFetchBehavior =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly code: MockFetchErrorCode; readonly message?: string };

/** The fetch-time error codes the mock can simulate. */
export type MockFetchErrorCode =
  "SOURCE_UNAVAILABLE" | "RATE_LIMITED" | "TIMEOUT" | "FETCH_FAILED" | "MALFORMED_RESPONSE";

/** A complete, self-contained dataset: ordered pages plus fetch behaviours. */
export interface MockDiscoveryDataset {
  /** Ordered pages; each inner array is one discovery page. */
  readonly pages: readonly (readonly RawMockItem[])[];
  /** Per-source-id fetch behaviours (default: ok). */
  readonly fetchBehaviors?: Readonly<Record<string, MockFetchBehavior>>;
}

/**
 * The default two-page dataset. Page 1 carries the well-formed and edge-case
 * items; page 2 proves pagination and includes the duplicate + malformed items.
 */
export const DEFAULT_DISCOVERY_DATASET: MockDiscoveryDataset = {
  pages: [
    [
      {
        sourceId: "mock-0001",
        doi: "10.0000/wise.discovery.alpha",
        sourceUrl: "https://doi.org/10.0000/wise.discovery.alpha",
        identifiers: [{ type: "DOI", value: "10.0000/wise.discovery.alpha" }],
        title: "An individualized intervention: a randomized placebo-controlled trial",
        authors: ["Jane Q. Smith", "Robert A. Müller"],
        journal: "Journal of Example Research",
        publicationDate: "2021-03-01",
        abstract:
          "<jats:p>A fictional randomized controlled trial used for offline discovery tests.</jats:p>",
        extra: { sourceScore: 0.87, sourceType: "journal-article" },
      },
      {
        // Missing DOI — still discoverable and normalizable via its title.
        sourceId: "mock-0002",
        doi: null,
        title: "An observational cohort with no DOI on record",
        authors: ["A. Researcher"],
        journal: "Proceedings of Example Studies",
        publicationDate: "2019",
      },
      {
        // Invalid DOI — normalization derives no canonical DOI but keeps the title.
        sourceId: "mock-0003",
        doi: "not-a-valid-doi",
        title: "A record whose supplied DOI is malformed",
        authors: [],
        publicationDate: "2020-07",
      },
    ],
    [
      {
        // Duplicate of mock-0001 by DOI — discovery surfaces it; dedup is a
        // downstream review concern (DUPLICATE ≠ DELETE), never done here.
        sourceId: "mock-0004",
        doi: "10.0000/wise.discovery.alpha",
        sourceUrl: "https://example.org/reprint/alpha",
        title: "An individualized intervention (reprint)",
        authors: ["Jane Q. Smith"],
        journal: "Reprints of Example Research",
        publicationDate: "2021-05-01",
      },
      {
        // Malformed item: no source id AND no title. Discovery still returns it
        // (untrusted); normalization rejects it (NORMALIZATION_FAILED).
        doi: null,
        authors: ["Nobody"],
        extra: { note: "broken record with no identity" },
      },
    ],
  ],
  fetchBehaviors: {
    "mock-0001": { kind: "ok" },
    "mock-fetch-unavailable": { kind: "error", code: "SOURCE_UNAVAILABLE" },
    "mock-fetch-timeout": { kind: "error", code: "TIMEOUT" },
    "mock-fetch-ratelimited": { kind: "error", code: "RATE_LIMITED" },
    "mock-fetch-failed": { kind: "error", code: "FETCH_FAILED" },
    "mock-fetch-malformed": { kind: "error", code: "MALFORMED_RESPONSE" },
  },
};

/** An empty dataset — discovery returns a single empty page with no cursor. */
export const EMPTY_DISCOVERY_DATASET: MockDiscoveryDataset = {
  pages: [[]],
};

/**
 * A single-page dataset of only well-formed items — handy for provenance and
 * normalization tests that do not want the edge cases.
 */
export const CLEAN_DISCOVERY_DATASET: MockDiscoveryDataset = {
  pages: [
    [
      {
        sourceId: "clean-0001",
        doi: "10.0000/wise.discovery.clean",
        sourceUrl: "https://doi.org/10.0000/wise.discovery.clean",
        title: "A clean, well-formed record",
        authors: ["First Author", "Second Author"],
        journal: "Journal of Clean Records",
        publicationDate: "2022-01-15",
        abstract: "A tidy abstract with no markup.",
      },
    ],
  ],
  fetchBehaviors: { "clean-0001": { kind: "ok" } },
};
