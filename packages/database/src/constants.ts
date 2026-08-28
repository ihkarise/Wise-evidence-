/**
 * Canonical enum vocabularies — the single TypeScript source of truth that
 * mirrors the PostgreSQL ENUM types created in `supabase/migrations/0001`.
 *
 * This module is framework-independent: no Astro, React, Supabase, or AI
 * imports, and no I/O. Keeping the enum values here lets the data-access layer,
 * tests, and later application code share one definition (docs/25 §10).
 *
 * These are stored machine values. Public presentation labels (e.g. the outcome
 * scale in docs/07 §2) are a UI concern and deliberately not encoded here.
 */

/** Research lifecycle state (docs/05 §6). */
export const LIFECYCLE_STATES = [
  "DISCOVERED",
  "IMPORTED",
  "PROCESSING",
  "PENDING_REVIEW",
  "PUBLISHED",
  "IMPORT_FAILED",
  "DUPLICATE_CANDIDATE",
  "REJECTED",
  "ARCHIVED",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Publication state; only PUBLISHED is public (docs/05 §7). */
export const PUBLICATION_STATES = [
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "ARCHIVED",
  "REJECTED",
] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

/** Subject facet (docs/06 §6). */
export const SUBJECT_TYPES = ["HUMAN", "ANIMAL", "IN_VITRO", "MIXED", "NOT_APPLICABLE"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/**
 * Canonical stored outcome scale (docs/07 §2). This is NOT a numeric efficacy
 * score and carries no positive-minus-negative arithmetic.
 */
export const OUTCOME_VALUES = [
  "STRONG_POSITIVE",
  "POSITIVE",
  "LEANING_POSITIVE",
  "NEUTRAL_INCONCLUSIVE",
  "LEANING_NEGATIVE",
  "NEGATIVE",
  "STRONG_NEGATIVE",
  "UNCLASSIFIED",
] as const;
export type OutcomeValue = (typeof OUTCOME_VALUES)[number];

/** The independent classification dimensions (docs/05 §9). Never collapsed. */
export const CLASSIFICATION_DIMENSIONS = [
  "OUTCOME",
  "EVIDENCE_LEVEL",
  "QUALITY",
  "CONFIDENCE",
  "STUDY_TYPE",
] as const;
export type ClassificationDimension = (typeof CLASSIFICATION_DIMENSIONS)[number];

/** Confidence in a classification — independent of outcome (docs/07 §9). */
export const CONFIDENCE_LEVELS = ["LOW", "MODERATE", "HIGH"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Per-dimension methodological quality value (docs/08 §3). */
export const QUALITY_ASSESSMENT_VALUES = [
  "ADEQUATE",
  "UNCLEAR",
  "INADEQUATE",
  "NOT_APPLICABLE",
] as const;
export type QualityAssessmentValue = (typeof QUALITY_ASSESSMENT_VALUES)[number];

/** Coarse, descriptive overall quality summary (docs/08 §4) — not a truth score. */
export const QUALITY_SUMMARIES = ["HIGH", "MODERATE", "LOW", "UNCLEAR"] as const;
export type QualitySummary = (typeof QUALITY_SUMMARIES)[number];

/** Criticism categories (docs/09 §2). Criticism is never a negative outcome. */
export const CRITICISM_CATEGORIES = [
  "METHODOLOGY",
  "RANDOMIZATION",
  "BLINDING",
  "SAMPLE_SIZE",
  "STATISTICS",
  "CONTROLS",
  "REPLICATION",
  "PUBLICATION_BIAS",
  "REPORTING",
  "INTERPRETATION",
  "GENERALIZABILITY",
  "OTHER",
] as const;
export type CriticismCategory = (typeof CRITICISM_CATEGORIES)[number];

/** Criticism origin — always distinguishable (docs/09 §3). */
export const CRITICISM_ORIGINS = [
  "AUTHOR_REPORTED",
  "EXTERNAL_PUBLICATION",
  "REVIEWER_ASSESSED",
  "AI_SUGGESTED",
] as const;
export type CriticismOrigin = (typeof CRITICISM_ORIGINS)[number];

/** Identifier types (docs/05 §5). */
export const IDENTIFIER_TYPES = ["DOI", "PMID", "PMCID", "EUROPEPMC", "URL", "OTHER"] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** Application roles (docs/16 §3). Reviewers never receive DB-admin privileges. */
export const APP_ROLES = ["PUBLIC", "REVIEWER", "ADMIN"] as const;
export type AppRole = (typeof APP_ROLES)[number];
