/**
 * Research discovery connector contract (M7, docs/25). A connector answers
 * "what research exists that we have not yet considered?" — it produces review
 * CANDIDATES only. It never classifies, never publishes, never decides identity
 * by title similarity. All connector output is untrusted external data and is
 * normalized/sanitized before use. This package imports no framework and no DB;
 * DOI handling reuses `@wise-evidence/domain` (never a second algorithm).
 */

/** What a caller asks a source to discover. Bounded — no unbounded crawling. */
export interface DiscoveryCriteria {
  /** Free-text query passed to the source's structured search. */
  query: string;
  /** Hard cap on results for one request (connector clamps to its own max). */
  maxResults: number;
}

/** A raw record as returned by a source (untrusted; shape is source-specific). */
export interface RawDiscoveryRecord {
  /** Stable source-specific record id (e.g. the DOI, or a source key). */
  sourceRecordId: string;
  /** The unmodified source payload (bounded), kept for provenance/review. */
  raw: unknown;
}

/** A normalized, sanitized candidate ready for deduplication + review. */
export interface NormalizedDiscoveryRecord {
  /** Canonical DOI (lowercased `10.x/...`) if the source supplied a valid one. */
  doi: string | null;
  sourceRecordId: string;
  title: string | null;
  authors: string[];
  journal: string | null;
  /** 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'. */
  publicationDate: string | null;
  /** A safe http(s) URL if supplied. */
  url: string | null;
  /** Abstract only where the source legally/reliably provides it. */
  abstract: string | null;
}

export type DiscoveryErrorCode = 'SOURCE_ERROR' | 'TIMEOUT' | 'MALFORMED_RESPONSE' | 'INVALID_CRITERIA' | 'NOT_CONFIGURED';

/**
 * One discovery run's result. `records` are the raw source records (each will be
 * normalized). `malformed` counts records the source returned that could not be
 * read at all — reported honestly, never hidden. A hard failure is `ok: false`.
 */
export type DiscoveryResult =
  | { ok: true; source: string; records: RawDiscoveryRecord[]; malformed: number }
  | { ok: false; error: DiscoveryErrorCode; message: string };

/** A replaceable source connector. Selected by configuration in the app server. */
export interface ResearchDiscoveryConnector {
  readonly name: string;
  /** The most results this connector will ever return in one call. */
  readonly maxResultsCap: number;
  /** Ask the source what exists for `criteria` (bounded). Network happens here. */
  discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult>;
  /** Normalize + sanitize one raw record into a candidate (pure; no network). */
  normalize(record: RawDiscoveryRecord): NormalizedDiscoveryRecord;
}
