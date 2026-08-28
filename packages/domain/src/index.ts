/**
 * @wise-evidence/domain — portable, framework-independent domain logic.
 *
 * This package must never import Astro, React, Supabase, or any AI SDK, and
 * must never perform I/O. It holds the credibility-critical, testable core
 * that the rest of the platform builds on.
 */
export {
  normalizeDoi,
  toCanonicalDoi,
  isValidDoi,
  type DoiNormalizationResult,
  type DoiNormalizationSuccess,
  type DoiNormalizationFailure,
  type DoiNormalizationErrorReason,
} from "./doi/normalizeDoi.js";
