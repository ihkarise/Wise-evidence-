/**
 * Provider-independent metadata contract (docs/26 §5, ADR-014).
 *
 * `NormalizedMetadata` is the single sanitized shape the research editor
 * consumes. It is intentionally narrower than the future
 * `NormalizedResearchInput` (docs/11 §4): M3 only needs the manual DOI path and
 * only bibliographic identity fields. External metadata is NEVER authoritative
 * for classification — human editing is (docs/10 §11, master prompt §16).
 *
 * This module is framework-independent: no Astro, React, Supabase, or AI
 * imports, and no I/O.
 */

/** A single author name as reported by a provider (already sanitized). */
export interface MetadataAuthor {
  /** Best available display name, e.g. "Jane Q. Smith". Never empty. */
  readonly displayName: string;
  /** Zero-based order as reported by the provider. */
  readonly order: number;
}

/**
 * The sanitized, bounded bibliographic record returned by a provider. Every
 * string here has been length-capped and stripped of control characters; the
 * DOI is canonical and matches the requested DOI; any URL is http(s).
 */
export interface NormalizedMetadata {
  /** Canonical DOI (from @wise-evidence/domain), e.g. `10.1234/abcd`. */
  readonly doi: string;
  /** Article title. May be empty string if the provider reported none. */
  readonly title: string;
  /** Ordered authors (possibly empty). */
  readonly authors: readonly MetadataAuthor[];
  /** Container / journal title, or null. */
  readonly journalTitle: string | null;
  /** Publisher, or null. */
  readonly publisher: string | null;
  /** ISO `YYYY-MM-DD` (or `YYYY-MM` / `YYYY`) publication date, or null. */
  readonly publicationDate: string | null;
  /** Plain-text abstract with any markup removed, or null. */
  readonly abstract: string | null;
  /** Canonical resource URL (http/https) the provider supplied, or null. */
  readonly url: string | null;
  /** The provider that produced this record, e.g. "crossref" or "mock". */
  readonly provider: string;
}

/** Machine-readable reason a lookup did not yield metadata. */
export type MetadataLookupErrorReason =
  | "invalid-doi" // the input was not a valid DOI
  | "not-found" // provider has no record for this DOI (e.g. HTTP 404)
  | "timeout" // the request exceeded the time budget
  | "too-large" // the response exceeded the size budget
  | "network" // transport failure (DNS, connection reset, etc.)
  | "provider-error" // provider returned an unexpected status / body
  | "invalid-metadata"; // response parsed but failed validation (e.g. DOI mismatch)

export interface MetadataLookupSuccess {
  readonly ok: true;
  readonly metadata: NormalizedMetadata;
}

export interface MetadataLookupFailure {
  readonly ok: false;
  readonly reason: MetadataLookupErrorReason;
  /** Safe, non-sensitive detail for logs/UX. Never leaks secrets. */
  readonly detail?: string;
}

export type MetadataLookupResult = MetadataLookupSuccess | MetadataLookupFailure;

/**
 * A source of bibliographic metadata. Implementations MUST NOT throw for the
 * expected failure cases above — they return a discriminated failure instead —
 * so callers always handle the not-found / timeout / invalid paths explicitly.
 */
export interface MetadataProvider {
  /** Stable provider name, stored as provenance. */
  readonly name: string;
  /** Look up sanitized metadata for a DOI (any accepted DOI form). */
  fetchByDoi(doi: string): Promise<MetadataLookupResult>;
}
