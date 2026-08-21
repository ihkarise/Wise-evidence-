-- 0001_enums.sql
-- Closed, spec-defined vocabularies as PostgreSQL enums (docs/05 §15, docs/06-09).
-- Admin-manageable/growable taxonomy lives in TABLES (see 0002), not here.

-- Identity / roles
create type app_role as enum ('PUBLIC', 'REVIEWER', 'ADMIN');

-- Research lifecycle (research_study) and publication state (publication)
create type lifecycle_state as enum (
  'DISCOVERED', 'IMPORTED', 'PROCESSING', 'PENDING_REVIEW', 'PUBLISHED',
  'IMPORT_FAILED', 'DUPLICATE_CANDIDATE', 'REJECTED', 'ARCHIVED'
);
create type publication_state as enum (
  'DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED'
);

-- Classification dimensions and their value vocabularies (docs/07, docs/08)
create type classification_dimension as enum (
  'OUTCOME', 'EVIDENCE_LEVEL', 'QUALITY', 'CONFIDENCE', 'STUDY_TYPE'
);
create type outcome_value as enum (
  'STRONG_POSITIVE', 'POSITIVE', 'LEANING_POSITIVE', 'NEUTRAL_INCONCLUSIVE',
  'LEANING_NEGATIVE', 'NEGATIVE', 'STRONG_NEGATIVE'
);
create type confidence_level as enum ('LOW', 'MODERATE', 'HIGH');
create type quality_assessment as enum ('ADEQUATE', 'UNCLEAR', 'INADEQUATE', 'NOT_APPLICABLE');

-- Criticism (docs/09) — separate dimension from outcome
create type criticism_category as enum (
  'METHODOLOGY', 'RANDOMIZATION', 'BLINDING', 'SAMPLE_SIZE', 'STATISTICS',
  'CONTROLS', 'REPLICATION', 'PUBLICATION_BIAS', 'REPORTING', 'INTERPRETATION',
  'GENERALIZABILITY', 'OTHER'
);
create type criticism_origin as enum (
  'AUTHOR_REPORTED', 'EXTERNAL_PUBLICATION', 'REVIEWER_ASSESSED', 'AI_SUGGESTED'
);

-- Subject type facet (docs/06 §6)
create type subject_type as enum ('HUMAN', 'ANIMAL', 'IN_VITRO', 'MIXED', 'NOT_APPLICABLE');

-- Provenance / identifiers (docs/05 §ResearchIdentifier, docs/11)
create type identifier_type as enum ('DOI', 'PMID', 'PMCID', 'EUROPEPMC', 'URL', 'OTHER');
create type import_method as enum ('MANUAL', 'CONNECTOR');
create type import_state as enum (
  'DISCOVERED', 'FETCHING', 'FETCHED', 'NORMALIZED', 'DUPLICATE_CANDIDATE',
  'IMPORTED', 'FAILED', 'REVIEW_REQUIRED'
);

-- AI subsystem (docs/10)
create type ai_operation as enum (
  'SUMMARIZE', 'CLASSIFY_OUTCOME', 'CLASSIFY_STUDY_TYPE', 'ASSESS_QUALITY',
  'EXTRACT_CRITICISM', 'EXTRACT_METADATA', 'GENERATE_KEYWORDS', 'DETECT_DUPLICATE'
);
create type ai_status as enum ('PENDING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- Review / correction workflow (docs/12, docs/13)
create type review_action as enum ('APPROVE', 'REJECT', 'REQUEST_CHANGES', 'EDIT');
create type correction_status as enum ('OPEN', 'ACCEPTED', 'REJECTED', 'MERGED');
