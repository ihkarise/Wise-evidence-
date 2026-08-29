/**
 * The constant benchmark input — the DEMO study (M6.1 master prompt §8, §11).
 *
 * The benchmark MUST use the DEMO study and MUST NOT touch real, private, or
 * unpublished research (master prompt §11). This module mirrors the MINIMISED,
 * per-task input that the production coordinator builds from canonical DB fields
 * in `@wise-evidence/database` `service/ai.ts` → `getEnrichmentInput()` for the
 * first demo study:
 *
 *   research_study 20000000-…-000000000001  "[DEMO] Positive reported outcome trial"
 *
 * (see `supabase/seed/demo_fixtures.sql`). It is embedded here — rather than read
 * from a live database — so the benchmark is fully deterministic and reproducible
 * offline, and so the model-comparison holds the input EXACTLY constant across
 * every model. Data minimisation is preserved (docs/29 §12): only the bounded
 * bibliographic fields each task needs, never a PDF, credentials, or audit data.
 *
 * Every value is clearly-labelled DEMO data (the "[DEMO]" prefix, the invented
 * abstract) and asserts no real scientific claim.
 */
import type { AITaskId } from "@wise-evidence/ai";

/** Stable id of the demo study these inputs describe (provenance only). */
export const DEMO_STUDY_ID = "20000000-0000-0000-0000-000000000001";
export const DEMO_STUDY_LABEL = "[DEMO] Positive reported outcome trial";

/** The bibliographic fields the four "common" tasks receive (docs/29 §12). */
const COMMON_INPUT = {
  title: "[DEMO] Positive reported outcome trial",
  abstract: "[DEMO] Invented abstract for a positive-outcome demonstration record.",
  studyType: "RCT",
  subjectType: "HUMAN",
  journal: null,
  publicationYear: 2021,
} as const;

/**
 * The minimised input for one task, mirroring `getEnrichmentInput(study, task)`.
 * Returned objects are frozen so a run can never mutate the shared fixture.
 */
export function demoInputForTask(task: AITaskId): Record<string, unknown> {
  switch (task) {
    case "research-summary":
    case "outcome-classification":
    case "evidence-quality":
    case "criticism-extraction":
      return { ...COMMON_INPUT };
    case "metadata-extraction":
      return {
        title: COMMON_INPUT.title,
        abstract: COMMON_INPUT.abstract,
        journal: COMMON_INPUT.journal,
        publicationYear: COMMON_INPUT.publicationYear,
      };
    case "duplicate-detection":
      // The demo study's normalized title is unique in the fixture set, so there
      // are no in-catalogue candidates (no scraping, no discovery — docs/29 §12).
      return {
        target: {
          title: COMMON_INPUT.title,
          normalizedTitle: "demo positive reported outcome trial",
          year: COMMON_INPUT.publicationYear,
        },
        candidates: [] as { id: string; title: string; year: number | null }[],
      };
  }
}
