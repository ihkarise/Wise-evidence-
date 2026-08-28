/**
 * @wise-evidence/metadata — provider-independent bibliographic metadata lookup.
 *
 * Public surface: the MetadataProvider contract and sanitized types, the
 * host-pinned/bounded Crossref provider, the deterministic mock, and the
 * sanitizers. This package imports nothing from Astro, React, Supabase, or any
 * AI SDK; DOI canonicalisation is reused from @wise-evidence/domain.
 */
export type {
  MetadataProvider,
  MetadataLookupResult,
  MetadataLookupSuccess,
  MetadataLookupFailure,
  MetadataLookupErrorReason,
  NormalizedMetadata,
  MetadataAuthor,
} from "./types.js";

export {
  CrossrefMetadataProvider,
  type CrossrefProviderOptions,
  type FetchLike,
  type FetchLikeResponse,
} from "./crossref.js";

export { MockMetadataProvider, DEFAULT_MOCK_FIXTURES, type MockFixture } from "./mock.js";

export { sanitizeText, sanitizeMarkupToText, sanitizeHttpUrl, LIMITS } from "./sanitize.js";
