/**
 * Conservative research deduplication & matching (M7.3 order; M7.5 explainability).
 *
 * Answers ONE question about a normalized candidate: "does this appear to
 * represent research already in WiseEvidence?" It applies the approved GRADED
 * hierarchy and NEVER auto-merges, deletes, publishes, or classifies anything:
 *
 *   LEVEL 1  exact canonical DOI              → DEFINITE_DUPLICATE  (DOI_EXACT_MATCH)
 *   LEVEL 2  exact persistent id (PMID/PMCID/ARXIV) → DEFINITE_DUPLICATE (PERSISTENT_IDENTIFIER_MATCH)
 *   LEVEL 3  normalized title + compatible year → PROBABLE_DUPLICATE (TITLE_YEAR_MATCH)
 *   LEVEL 4  normalized title, year unconfirmed/conflicting → POSSIBLE_DUPLICATE (TITLE_EXACT_MATCH)
 *   (none)   no comparable identity at all      → NEW (INSUFFICIENT_METADATA)
 *   (none)   checked, nothing matched           → NEW (NO_MATCH)
 *
 * LEVEL 5 (fuzzy title similarity) is DELIBERATELY NOT IMPLEMENTED — it is the
 * highest false-positive risk and would need an unauthorized index/migration or
 * an unbounded scan. WiseEvidence prefers a missed duplicate (reviewable later)
 * over a wrong merge (destroys provenance). See docs/reports/M7.5-DEDUPLICATION.md.
 *
 * Study ≠ Publication: a DOI/persistent-id match means this candidate's
 * publication identity is already recorded against a study; the candidate may
 * still be a *different* publication of that study (protocol, primary report,
 * secondary analysis, erratum, …). The engine therefore only FLAGS a related
 * study and routes to human review; it never collapses records.
 *
 * The matcher is a PURE function: same input + same index state ⇒ same decision.
 * No randomness, no clock, no network, no AI. Study lookups go through a
 * read-only PORT (`KnownStudyIndex`) so this package never imports the database.
 */
import type { NormalizedSourceItem } from "../types.js";
import type { DedupDecision, DedupExplanation } from "./types.js";

/** A read-only match against an existing canonical study (never writes). */
export interface KnownStudyMatch {
  readonly studyId: string;
  /** The study's known publication years (`YYYY`), deduped; empty when unknown. */
  readonly years: readonly string[];
}

/** Read-only lookups against existing CANONICAL studies. Never writes. */
export interface KnownStudyIndex {
  /** Study id whose canonical DOI equals `doi`, or null. */
  findStudyByDoi(doi: string): Promise<string | null>;
  /** Study id carrying identifier `type=value` (e.g. PMID), or null. */
  findStudyByIdentifier(type: string, value: string): Promise<string | null>;
  /**
   * Study whose normalized title matches, with its known publication years, or
   * null. Year comparison is done by the matcher (not the index) so the decision
   * stays pure and explainable. Must be deterministic when several studies share
   * a normalized title (pick one stable study; the match still routes to review).
   */
  findStudyByTitle(normalizedTitle: string): Promise<KnownStudyMatch | null>;
}

/** Extract a 4-digit year from a `YYYY[-MM[-DD]]` date, or null. */
export function yearOf(publicationDate: string | null): string | null {
  if (publicationDate === null) return null;
  const m = publicationDate.match(/^(\d{4})/);
  return m ? m[1]! : null;
}

/** The persistent-identifier types that count as a LEVEL 2 DEFINITE match. */
const PERSISTENT_ID_TYPES: ReadonlySet<string> = new Set(["PMID", "PMCID", "ARXIV"]);

function decision(
  verdict: DedupDecision["verdict"],
  matchedBy: DedupDecision["matchedBy"],
  relatedStudyId: string | null,
  reason: string,
  explanation: DedupExplanation,
): DedupDecision {
  return { verdict, matchedBy, relatedStudyId, reason, explanation };
}

/**
 * Classify a normalized candidate against existing canonical studies using the
 * graded hierarchy. Returns NEW when nothing matches. Source-item idempotency
 * (have we imported this exact source item before?) is a SEPARATE concern owned
 * by the candidate store — it is NOT decided here.
 */
export async function classifyDuplicate(
  normalized: NormalizedSourceItem,
  index: KnownStudyIndex,
): Promise<DedupDecision> {
  const candidateYear = yearOf(normalized.publicationDate);
  // A title only counts as a signal when it is non-empty after normalization.
  // A punctuation-only / empty title normalizes to "" and must NEVER match (it
  // would otherwise collide with any study whose normalized_title is empty).
  const normalizedTitle =
    normalized.normalizedTitle !== null && normalized.normalizedTitle.trim() !== ""
      ? normalized.normalizedTitle
      : null;
  const persistentIds = normalized.identifiers.filter((id) => PERSISTENT_ID_TYPES.has(id.type));

  // LEVEL 1 — exact canonical DOI.
  if (normalized.canonicalDoi !== null) {
    const studyId = await index.findStudyByDoi(normalized.canonicalDoi);
    if (studyId !== null) {
      return decision(
        "DEFINITE_DUPLICATE",
        "DOI",
        studyId,
        `exact DOI match with study ${studyId}`,
        {
          reasonCode: "DOI_EXACT_MATCH",
          matchedIdentifierType: "DOI",
          matchedIdentifierValue: normalized.canonicalDoi,
          titleMatched: false,
          candidateYear,
          matchedStudyYears: [],
          yearConflict: false,
        },
      );
    }
  }

  // LEVEL 2 — exact persistent identifier (PMID / PMCID / ARXIV).
  for (const id of persistentIds) {
    const studyId = await index.findStudyByIdentifier(id.type, id.value);
    if (studyId !== null) {
      return decision(
        "DEFINITE_DUPLICATE",
        "PERSISTENT_ID",
        studyId,
        `exact ${id.type} match with study ${studyId}`,
        {
          reasonCode: "PERSISTENT_IDENTIFIER_MATCH",
          matchedIdentifierType: id.type,
          matchedIdentifierValue: id.value,
          titleMatched: false,
          candidateYear,
          matchedStudyYears: [],
          yearConflict: false,
        },
      );
    }
  }

  // LEVEL 3 / 4 — normalized title (with year comparison for grading).
  if (normalizedTitle !== null) {
    const match = await index.findStudyByTitle(normalizedTitle);
    if (match !== null) {
      const yearAgrees = candidateYear !== null && match.years.includes(candidateYear);
      if (yearAgrees) {
        return decision(
          "PROBABLE_DUPLICATE",
          "TITLE_YEAR",
          match.studyId,
          `normalized title + year (${candidateYear}) match with study ${match.studyId}`,
          {
            reasonCode: "TITLE_YEAR_MATCH",
            matchedIdentifierType: null,
            matchedIdentifierValue: null,
            titleMatched: true,
            candidateYear,
            matchedStudyYears: match.years,
            yearConflict: false,
          },
        );
      }
      // Title matches but the year could not be confirmed (absent on either side
      // or different) → stay conservative at POSSIBLE and explain the mismatch.
      const yearNote =
        candidateYear === null
          ? "candidate year unknown"
          : match.years.length === 0
            ? "study year unknown"
            : `year mismatch (candidate ${candidateYear} vs study ${match.years.join("/")})`;
      return decision(
        "POSSIBLE_DUPLICATE",
        "TITLE",
        match.studyId,
        `normalized title match with study ${match.studyId} (${yearNote})`,
        {
          reasonCode: "TITLE_EXACT_MATCH",
          matchedIdentifierType: null,
          matchedIdentifierValue: null,
          titleMatched: true,
          candidateYear,
          matchedStudyYears: match.years,
          yearConflict: true,
        },
      );
    }
  }

  // NEW — nothing matched. Distinguish "could not check" from "checked, no match".
  const hadComparableIdentity =
    normalized.canonicalDoi !== null || persistentIds.length > 0 || normalizedTitle !== null;
  return decision(
    "NEW",
    null,
    null,
    hadComparableIdentity ? "no existing match" : "no comparable identity to match on",
    {
      reasonCode: hadComparableIdentity ? "NO_MATCH" : "INSUFFICIENT_METADATA",
      matchedIdentifierType: null,
      matchedIdentifierValue: null,
      titleMatched: false,
      candidateYear,
      matchedStudyYears: [],
      yearConflict: false,
    },
  );
}
