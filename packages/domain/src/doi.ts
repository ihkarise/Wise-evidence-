/**
 * DOI normalization — the shared canonicalizer used by import and search.
 *
 * Implements the contract in `docs/20-TESTING.md` §5: a DOI supplied in any of
 * the accepted forms is reduced to one canonical representation so that exact
 * deduplication (`docs/11` §7, `docs/05` §11) and DOI-priority search
 * (`docs/14` §4) compare like with like.
 *
 * Accepted input forms:
 *   - `doi:10.xxxx/xxxx`
 *   - `https://doi.org/10.xxxx/xxxx`
 *   - `http://doi.org/10.xxxx/xxxx`
 *   - bare `10.xxxx/xxxx`
 * (The `dx.doi.org` host and a scheme-less `doi.org/` prefix are also tolerated
 * as common variants; all reduce to the same canonical form.)
 *
 * Canonicalization rules:
 *   1. Trim surrounding whitespace.
 *   2. Strip a leading resolver prefix (case-insensitively).
 *   3. Validate the remainder against the DOI shape `10.<registrant>/<suffix>`.
 *   4. Lowercase the result. DOIs are case-insensitive by specification, so the
 *      canonical form is lowercased for stable comparison.
 *
 * This module is pure and framework-free (`docs/23` §5) — no I/O, no globals.
 */

/** Reasons a value cannot be normalized to a canonical DOI. */
export type DoiNormalizationErrorCode = 'EMPTY' | 'INVALID_FORMAT';

export interface DoiNormalizationSuccess {
  readonly ok: true;
  /** Canonical DOI, e.g. `10.1234/abcd`. Always lowercase, no resolver prefix. */
  readonly doi: string;
}

export interface DoiNormalizationFailure {
  readonly ok: false;
  readonly error: DoiNormalizationErrorCode;
  /** The original input, unchanged, for diagnostics and review. */
  readonly input: string;
}

export type DoiNormalizationResult = DoiNormalizationSuccess | DoiNormalizationFailure;

/**
 * Resolver prefixes stripped before validation, longest/most-specific first so
 * that e.g. `https://doi.org/` is removed before a bare `doi.org/` could match.
 * Matched case-insensitively.
 */
const RESOLVER_PREFIXES: readonly string[] = [
  'https://doi.org/',
  'http://doi.org/',
  'https://dx.doi.org/',
  'http://dx.doi.org/',
  'doi.org/',
  'dx.doi.org/',
  'doi:',
];

/**
 * DOI syntax: `10.` then a registrant code (4+ digits, optionally
 * dot-separated sub-registrants) then `/` then a non-empty suffix with no
 * whitespace. Deliberately strict on the prefix, permissive on the suffix.
 */
const DOI_PATTERN = /^10\.\d{4,}(?:\.\d+)*\/\S+$/;

function stripResolverPrefix(value: string): string {
  const lower = value.toLowerCase();
  for (const prefix of RESOLVER_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return value;
}

/**
 * Normalize a DOI string to its canonical form.
 *
 * @param input a raw DOI in any accepted form.
 * @returns a discriminated result: `{ ok: true, doi }` on success, or
 *          `{ ok: false, error, input }` on empty/malformed input.
 */
export function normalizeDoi(input: string): DoiNormalizationResult {
  if (typeof input !== 'string') {
    return { ok: false, error: 'EMPTY', input: String(input ?? '') };
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, error: 'EMPTY', input };
  }

  const withoutPrefix = stripResolverPrefix(trimmed).trim();
  const candidate = withoutPrefix.toLowerCase();

  if (!DOI_PATTERN.test(candidate)) {
    return { ok: false, error: 'INVALID_FORMAT', input };
  }

  return { ok: true, doi: candidate };
}

/**
 * Convenience predicate: does the input normalize to a valid canonical DOI?
 */
export function isValidDoi(input: string): boolean {
  return normalizeDoi(input).ok;
}
