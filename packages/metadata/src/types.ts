/** Identifier kinds mirrored from the database identifier_type enum. */
export type MetadataIdentifierType = 'DOI' | 'PMID' | 'PMCID' | 'URL' | 'OTHER';

/**
 * Normalized bibliographic metadata. This is a *suggestion* to prefill the
 * editor — never an authoritative scientific interpretation (docs/23 Phase 5-6).
 * All string fields are sanitized and length-capped; treat as untrusted.
 */
export interface BibliographicMetadata {
  doi: string | null;
  title: string | null;
  authors: string[];
  journal: string | null;
  /** ISO-ish date: 'YYYY', 'YYYY-MM', or 'YYYY-MM-DD'. */
  publicationDate: string | null;
  publisher: string | null;
  /** A safe http(s) resource URL, if the provider supplied one. */
  url: string | null;
  identifiers: { type: MetadataIdentifierType; value: string }[];
}

export type MetadataErrorCode =
  | 'INVALID_DOI'
  | 'NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE';

export type MetadataResult =
  | { ok: true; source: string; metadata: BibliographicMetadata }
  | { ok: false; error: MetadataErrorCode; message: string };

/** Replaceable provider interface (docs/11 §4, docs/23 Phase 6). */
export interface MetadataProvider {
  readonly name: string;
  fetchByDoi(doi: string): Promise<MetadataResult>;
}
