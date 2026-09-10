/**
 * Provider-neutral discovery types (M7.1; docs/30, ADR-020 design intent).
 *
 * These objects model the smallest end-to-end discovery flow — discover →
 * fetch → normalize — WITHOUT any provider-specific concept (no Crossref, no
 * PubMed, no HTML). The whole point is that an M7.2 Crossref adapter, and later
 * PubMed / Europe PMC adapters, plug into these same shapes without changing
 * them.
 *
 * The LOCKED M7 separations are structural here:
 *
 *   DISCOVERY ≠ PUBLICATION      a discovered item is not a research record
 *   FETCH     ≠ ACCEPTANCE       fetching detail never accepts a candidate
 *   CANDIDATE ≠ RESEARCH RECORD  normalized ≠ canonical published data
 *   RELEVANCE ≠ EFFICACY         discovery carries NO outcome/efficacy field
 *
 * So there is deliberately NO outcome, evidence-quality, criticism, confidence,
 * or efficacy field anywhere in this file. Those are human-reviewed dimensions
 * that live far downstream of discovery.
 *
 * Source metadata is UNTRUSTED (docs/16 §8): it is never assumed correct and
 * never rendered as HTML. `SourceItem` preserves it verbatim (bounded/sanitized
 * as text); `NormalizedSourceItem` is the sanitized, canonicalised view.
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports.
 */
import type { DiscoveryError } from "./errors.js";

/** Stable key identifying a configured source, e.g. "mock" or "crossref". */
export type SourceKey = string;

/**
 * The provider kinds the registry knows about. Only `MOCK` is IMPLEMENTED in
 * M7.1; `CROSSREF`, `PUBMED`, and `EUROPE_PMC` are named so the registry can
 * fail closed with `NOT_CONFIGURED` until their adapters ship (M7.2+).
 */
export type DiscoveryProviderType = "MOCK" | "CROSSREF" | "PUBMED" | "EUROPE_PMC";

/** The identifier kinds a source item may carry (provider-neutral). */
export type SourceIdentifierType = "DOI" | "PMID" | "PMCID" | "ARXIV" | "URL" | "SOURCE_ID";

/** A single external identifier as reported by a source (UNTRUSTED, raw). */
export interface SourceIdentifier {
  readonly type: SourceIdentifierType;
  /** The raw value as the source supplied it (sanitized as text, not verified). */
  readonly value: string;
}

/**
 * A discriminated result for every provider operation. Expected failures are
 * data, not exceptions: the FAILURE branch carries a `DiscoveryError`.
 */
export type DiscoveryResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DiscoveryError };

/** Opaque, provider-defined pagination token. Never interpreted by callers. */
export type DiscoveryCursor = string;

/**
 * A provider-neutral discovery request. A provider uses whichever fields it
 * supports and ignores the rest; unsupported fields never change results in a
 * way that leaks provider identity.
 */
export interface DiscoveryRequest {
  /** Free-text query, provider-neutral. Optional. */
  readonly query?: string;
  /** Seek specific items by identifier (e.g. a set of DOIs). Optional. */
  readonly identifiers?: readonly SourceIdentifier[];
  /** Requested page size; the provider clamps to its descriptor limit. */
  readonly pageSize?: number;
  /** Opaque cursor from a previous page; omit/null for the first page. */
  readonly cursor?: DiscoveryCursor | null;
  /** ISO lower bound (`YYYY-MM-DD`) on publication date, when supported. */
  readonly since?: string | null;
}

/**
 * One item as discovered from a source. This preserves SOURCE IDENTITY and the
 * raw (untrusted) metadata; it is NOT a research record and carries no
 * classification. All strings are bounded/sanitized text, never markup.
 */
export interface SourceItem {
  /** Which configured source produced this item. */
  readonly sourceKey: SourceKey;
  /** Stable identifier of this item WITHIN the source (may be empty if broken). */
  readonly sourceId: string;
  /** Canonical resource URL the source supplied (http/https), or null. */
  readonly sourceUrl: string | null;
  /** DOI exactly as supplied by the source (raw, UNVERIFIED), or null. */
  readonly doi: string | null;
  /** All identifiers the source reported (raw). */
  readonly identifiers: readonly SourceIdentifier[];
  /** Title as reported (sanitized text), or null. */
  readonly title: string | null;
  /** Author display names as reported (sanitized text), in source order. */
  readonly authors: readonly string[];
  /** Journal / container title as reported, or null. */
  readonly journal: string | null;
  /** Publication date as reported (`YYYY`, `YYYY-MM`, or `YYYY-MM-DD`), or null. */
  readonly publicationDate: string | null;
  /** Abstract as reported (sanitized text, markup stripped), or null. */
  readonly abstract: string | null;
  /** Source-specific extra fields, preserved verbatim but treated as UNTRUSTED. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** A minimal reference used to fetch a single item's detail record. */
export interface SourceItemRef {
  readonly sourceKey: SourceKey;
  readonly sourceId: string;
}

/**
 * One page of discovered items plus the cursor to continue. `nextCursor` is
 * null when there are no further pages.
 */
export interface DiscoveryPage {
  readonly source: SourceKey;
  readonly items: readonly SourceItem[];
  readonly nextCursor: DiscoveryCursor | null;
  /** ISO timestamp the page was produced (injected clock — deterministic). */
  readonly discoveredAt: string;
}

/**
 * The result of fetching a single item's detail record. Fetching enriches an
 * item; it NEVER accepts it as a candidate or writes anything canonical.
 */
export interface FetchResult {
  readonly sourceKey: SourceKey;
  readonly sourceId: string;
  /** The (possibly detail-enriched) source item. */
  readonly item: SourceItem;
  /** ISO timestamp the item was fetched. */
  readonly fetchedAt: string;
  /** Hash of the raw payload, for provenance/audit (see hash.ts). */
  readonly rawHash: string;
}

/**
 * Where a normalized item came from. Every normalized item is traceable back to
 * its source, identifier, URL, discovery/fetch time, connector version, DOI (if
 * any), and a raw-payload hash. We store the hash, never full papers.
 */
export interface Provenance {
  readonly sourceKey: SourceKey;
  readonly sourceId: string;
  readonly sourceUrl: string | null;
  /** Canonical DOI if one could be derived, else null. */
  readonly doi: string | null;
  readonly discoveredAt: string;
  readonly fetchedAt: string | null;
  /** Connector/provider version that produced the item (e.g. "mock-discovery/1"). */
  readonly providerVersion: string;
  /** Hash of the raw payload, or null when no raw payload was retained. */
  readonly rawHash: string | null;
}

/**
 * The sanitized, canonicalised view of a source item — the shape a future
 * candidate-builder would consume. This is SOURCE-DERIVED metadata ONLY: it is
 * kept separate from AI-derived values (there are none in M7.1) and from
 * human-authored final values (which live in the canonical DB, never here).
 * It contains NO outcome/quality/criticism/efficacy — discovery ≠ classification.
 */
export interface NormalizedSourceItem {
  /** Canonical DOI via @wise-evidence/domain, or null when absent/invalid. */
  readonly canonicalDoi: string | null;
  /** Deduplication-friendly normalized title via @wise-evidence/domain, or null. */
  readonly normalizedTitle: string | null;
  /** Display title (sanitized). Empty string only when the source had none. */
  readonly title: string;
  /** Author display names (sanitized), in source order. */
  readonly authors: readonly string[];
  readonly journal: string | null;
  readonly publicationDate: string | null;
  readonly abstract: string | null;
  readonly url: string | null;
  /** All identifiers carried through (raw values, canonical DOI added if derived). */
  readonly identifiers: readonly SourceIdentifier[];
  readonly provenance: Provenance;
}
