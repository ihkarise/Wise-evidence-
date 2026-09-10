/**
 * Source-item normalization (M7.1; docs/30).
 *
 * A pure function that turns an UNTRUSTED `SourceItem` into a sanitized,
 * canonicalised `NormalizedSourceItem` with provenance. It reuses the portable
 * DOI/title canonicalisation from @wise-evidence/domain (the same functions the
 * manual MVP and dedup order use, docs/05 §11) so discovery and the rest of the
 * platform agree on identity.
 *
 * This is the CANDIDATE boundary: the output is source-derived metadata only. It
 * carries NO outcome, evidence-quality, criticism, confidence, efficacy, or AI
 * value, and it is NOT a research record. Normalization never accepts, dedupes,
 * publishes, or writes anything — it only shapes and traces.
 *
 * Failure is data: too-thin items yield INSUFFICIENT_METADATA and structurally
 * broken items yield NORMALIZATION_FAILED, never a thrown error.
 *
 * Framework-independent: imports only @wise-evidence/domain; no I/O.
 */
import { normalizeTitle, toCanonicalDoi } from "@wise-evidence/domain";
import { DiscoveryError } from "./errors.js";
import {
  DISCOVERY_LIMITS,
  sanitizeHttpUrl,
  sanitizeMarkupToText,
  sanitizeText,
} from "./sanitize.js";
import type {
  DiscoveryResult,
  NormalizedSourceItem,
  Provenance,
  SourceIdentifier,
  SourceItem,
} from "./types.js";

/** Context a caller supplies so provenance is complete and deterministic. */
export interface NormalizationContext {
  /** ISO timestamp the item was discovered. */
  readonly discoveredAt: string;
  /** ISO timestamp the item was fetched, or null if not fetched. */
  readonly fetchedAt?: string | null;
  /** Connector/provider version producing the item. */
  readonly providerVersion: string;
  /** Hash of the raw payload, or null when none was retained. */
  readonly rawHash?: string | null;
}

function dedupeIdentifiers(identifiers: readonly SourceIdentifier[]): SourceIdentifier[] {
  const seen = new Set<string>();
  const out: SourceIdentifier[] = [];
  for (const id of identifiers.slice(0, DISCOVERY_LIMITS.maxIdentifiers)) {
    const value = sanitizeText(id.value, DISCOVERY_LIMITS.identifier);
    if (value === null) continue;
    const key = `${id.type}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: id.type, value });
  }
  return out;
}

/**
 * Normalize one source item. Returns FAILURE when:
 *   - the item has no stable `sourceId` (structural fault) → NORMALIZATION_FAILED
 *   - the item yields neither a canonical DOI nor a title    → INSUFFICIENT_METADATA
 */
export function normalizeSourceItem(
  item: SourceItem,
  context: NormalizationContext,
): DiscoveryResult<NormalizedSourceItem> {
  const sourceId = sanitizeText(item.sourceId, DISCOVERY_LIMITS.identifier);
  if (sourceId === null) {
    return {
      ok: false,
      error: new DiscoveryError(
        "NORMALIZATION_FAILED",
        `source '${item.sourceKey}': item has no stable source id`,
        { source: item.sourceKey },
      ),
    };
  }

  const canonicalDoi = item.doi !== null ? toCanonicalDoi(item.doi) : null;
  const title = sanitizeText(item.title, DISCOVERY_LIMITS.title);

  if (canonicalDoi === null && title === null) {
    return {
      ok: false,
      error: new DiscoveryError(
        "INSUFFICIENT_METADATA",
        `source '${item.sourceKey}' item '${sourceId}': neither a valid DOI nor a title`,
        { source: item.sourceKey },
      ),
    };
  }

  const authors = item.authors
    .slice(0, DISCOVERY_LIMITS.maxAuthors)
    .map((name) => sanitizeText(name, DISCOVERY_LIMITS.authorName))
    .filter((name): name is string => name !== null);

  const identifiers = dedupeIdentifiers(
    canonicalDoi !== null
      ? [{ type: "DOI", value: canonicalDoi }, ...item.identifiers]
      : item.identifiers,
  );

  const url = item.sourceUrl !== null ? sanitizeHttpUrl(item.sourceUrl) : null;

  const provenance: Provenance = {
    sourceKey: item.sourceKey,
    sourceId,
    sourceUrl: url,
    doi: canonicalDoi,
    discoveredAt: context.discoveredAt,
    fetchedAt: context.fetchedAt ?? null,
    providerVersion: context.providerVersion,
    rawHash: context.rawHash ?? null,
  };

  const normalized: NormalizedSourceItem = {
    canonicalDoi,
    normalizedTitle: title !== null ? normalizeTitle(title) : null,
    title: title ?? "",
    authors,
    journal: sanitizeText(item.journal, DISCOVERY_LIMITS.journal),
    publicationDate: sanitizeText(item.publicationDate, DISCOVERY_LIMITS.date),
    abstract: sanitizeMarkupToText(item.abstract, DISCOVERY_LIMITS.abstract),
    url,
    identifiers,
    provenance,
  };

  return { ok: true, value: normalized };
}
