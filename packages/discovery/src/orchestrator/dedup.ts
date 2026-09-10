/**
 * Conservative deduplication (M7.3; docs/30 §Phase 10-11, master prompt §16,
 * docs/05 §11). Applies the approved GRADED order and NEVER auto-merges or
 * deletes anything:
 *
 *   1. exact DOI                      → DEFINITE_DUPLICATE
 *   2. exact persistent id (PMID/PMCID) → DEFINITE_DUPLICATE
 *   3. exact source id                → handled by idempotency (store), not here
 *   4. normalized title + year        → PROBABLE_DUPLICATE (reviewable)
 *   5. normalized title (no year)     → POSSIBLE_DUPLICATE (reviewable)
 *
 * There is NO fuzzy/similarity library and NO automatic linking beyond recording
 * a DEFINITE match's related study id for the reviewer. PROBABLE/POSSIBLE stay
 * reviewable; the new candidate is never deleted, and no existing record is
 * touched.
 *
 * Study lookups go through a read-only PORT (`KnownStudyIndex`) so this package
 * never imports the database; the real adapter reads `research_identifier` /
 * `publication`, the tests use an in-memory index.
 */
import type { NormalizedSourceItem } from "../types.js";
import type { DedupDecision } from "./types.js";

/** Read-only lookups against existing CANONICAL studies. Never writes. */
export interface KnownStudyIndex {
  /** Study id whose canonical DOI equals `doi`, or null. */
  findStudyByDoi(doi: string): Promise<string | null>;
  /** Study id carrying identifier `type=value` (e.g. PMID), or null. */
  findStudyByIdentifier(type: string, value: string): Promise<string | null>;
  /** Study id whose normalized title + year match, or null. */
  findStudyByTitleYear(normalizedTitle: string, year: string): Promise<string | null>;
  /** Study id whose normalized title matches (year unknown), or null. */
  findStudyByTitle(normalizedTitle: string): Promise<string | null>;
}

/** Extract a 4-digit year from a `YYYY[-MM[-DD]]` date, or null. */
export function yearOf(publicationDate: string | null): string | null {
  if (publicationDate === null) return null;
  const m = publicationDate.match(/^(\d{4})/);
  return m ? m[1]! : null;
}

/**
 * Classify a normalized candidate against existing canonical studies using the
 * graded order. Returns NEW when nothing matches. Source-id idempotency is NOT
 * decided here (the candidate store owns it).
 */
export async function classifyDuplicate(
  normalized: NormalizedSourceItem,
  index: KnownStudyIndex,
): Promise<DedupDecision> {
  // 1. exact DOI
  if (normalized.canonicalDoi !== null) {
    const studyId = await index.findStudyByDoi(normalized.canonicalDoi);
    if (studyId !== null) {
      return {
        verdict: "DEFINITE_DUPLICATE",
        matchedBy: "DOI",
        relatedStudyId: studyId,
        reason: `exact DOI match with study ${studyId}`,
      };
    }
  }

  // 2. exact persistent identifier (PMID / PMCID / ARXIV)
  for (const id of normalized.identifiers) {
    if (id.type === "PMID" || id.type === "PMCID" || id.type === "ARXIV") {
      const studyId = await index.findStudyByIdentifier(id.type, id.value);
      if (studyId !== null) {
        return {
          verdict: "DEFINITE_DUPLICATE",
          matchedBy: "PERSISTENT_ID",
          relatedStudyId: studyId,
          reason: `exact ${id.type} match with study ${studyId}`,
        };
      }
    }
  }

  // 4. normalized title + year
  if (normalized.normalizedTitle !== null) {
    const year = yearOf(normalized.publicationDate);
    if (year !== null) {
      const studyId = await index.findStudyByTitleYear(normalized.normalizedTitle, year);
      if (studyId !== null) {
        return {
          verdict: "PROBABLE_DUPLICATE",
          matchedBy: "TITLE_YEAR",
          relatedStudyId: studyId,
          reason: `normalized title + year (${year}) match with study ${studyId}`,
        };
      }
    }
    // 5. normalized title only
    const byTitle = await index.findStudyByTitle(normalized.normalizedTitle);
    if (byTitle !== null) {
      return {
        verdict: "POSSIBLE_DUPLICATE",
        matchedBy: "TITLE",
        relatedStudyId: byTitle,
        reason: `normalized title match with study ${byTitle} (year unconfirmed)`,
      };
    }
  }

  return { verdict: "NEW", matchedBy: null, relatedStudyId: null, reason: "no existing match" };
}
