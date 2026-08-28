/**
 * DOI normalization — the shared canonicalizer used across WiseEvidence.
 *
 * Contract (docs/20-TESTING.md §5, CLAUDE-CODE-MASTER-PROMPT.md §50):
 * these input forms all converge to a single canonical DOI:
 *
 *   doi:10.1234/abcd
 *   https://doi.org/10.1234/abcd
 *   http://doi.org/10.1234/abcd
 *   https://dx.doi.org/10.1234/abcd   (legacy handle-resolver host)
 *   10.1234/abcd
 *
 * Canonical output form: the bare, lower-cased DOI `10.1234/abcd`.
 *
 * This module is intentionally framework-independent: it imports nothing from
 * Astro, React, Supabase, or any AI SDK, and performs no I/O. It is the single
 * source of truth reused by import normalization (docs/11 §6) and search
 * DOI-priority matching (docs/14 §4).
 */

/** Why a value could not be normalized to a canonical DOI. */
export type DoiNormalizationErrorReason =
  | "empty" // null/undefined/non-string, empty, or whitespace-only input
  | "invalid-format"; // present, but not a recognizable DOI

/** A successfully normalized, canonical DOI. */
export interface DoiNormalizationSuccess {
  readonly ok: true;
  /** Canonical lower-cased DOI, e.g. `10.1234/abcd`. */
  readonly doi: string;
}

/** A rejected input, with a machine-readable reason. */
export interface DoiNormalizationFailure {
  readonly ok: false;
  readonly reason: DoiNormalizationErrorReason;
}

export type DoiNormalizationResult = DoiNormalizationSuccess | DoiNormalizationFailure;

/**
 * Canonical DOI shape: the `10.` prefix, a numeric registrant code, a slash,
 * then a non-empty suffix that contains no whitespace. Kept deliberately
 * permissive on suffix characters (the DOI spec allows a wide range) while
 * rejecting whitespace and obviously malformed values.
 */
const CANONICAL_DOI = /^10\.\d{4,}\/\S+$/;

/** Strip a leading `doi:` scheme (with optional surrounding space). */
const DOI_SCHEME = /^doi:\s*/;

/** Strip a leading resolver URL: `http(s)://(dx.)doi.org/` or a bare host. */
const DOI_RESOLVER_URL = /^(?:https?:\/\/)?(?:dx\.)?doi\.org\//;

/**
 * Normalize an arbitrary DOI-like string into its canonical form.
 *
 * Never throws. Returns a discriminated result so callers must handle the
 * invalid case explicitly rather than trusting a possibly-malformed string.
 */
export function normalizeDoi(input: string): DoiNormalizationResult {
  // Defensive boundary guard: this is a library entry point that may receive
  // untrusted or wrongly-typed input at runtime.
  if (typeof input !== "string") {
    return { ok: false, reason: "empty" };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }

  // DOIs are case-insensitive; canonicalize to lower case up front so all
  // input forms converge.
  let candidate = trimmed.toLowerCase();
  candidate = candidate.replace(DOI_SCHEME, "");
  candidate = candidate.replace(DOI_RESOLVER_URL, "");
  candidate = candidate.trim();

  if (!CANONICAL_DOI.test(candidate)) {
    return { ok: false, reason: "invalid-format" };
  }

  return { ok: true, doi: candidate };
}

/**
 * Convenience wrapper: return the canonical DOI string, or `null` if the input
 * is not a valid DOI. Useful where a discriminated result is more than callers
 * need.
 */
export function toCanonicalDoi(input: string): string | null {
  const result = normalizeDoi(input);
  return result.ok ? result.doi : null;
}

/** Type guard: is `input` a valid DOI in any accepted form? */
export function isValidDoi(input: string): boolean {
  return normalizeDoi(input).ok;
}
