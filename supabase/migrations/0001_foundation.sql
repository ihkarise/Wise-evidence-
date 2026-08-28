-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0001: foundation — helper schema, enum types, generic triggers.
--
-- Authoritative store: PostgreSQL (ADR-002). All schema changes are
-- version-controlled migrations (docs/19 §6). This file is deployable to a real
-- Supabase project unchanged; it invents no Supabase-specific roles or functions.
--
-- See docs/25-DATABASE-FOUNDATION.md for the full design checkpoint.

-- ---------------------------------------------------------------------------
-- Helper schema. Holds role-check helpers (added in 0008) and generic triggers.
-- ---------------------------------------------------------------------------
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enum types (fixed, credibility-critical vocabularies — docs/25 §4, ADR-013).
-- Growing, admin-curated taxonomies are reference TABLES, not enums.
-- ---------------------------------------------------------------------------

-- Research lifecycle state (docs/05 §6).
create type study_lifecycle_state as enum (
  'DISCOVERED', 'IMPORTED', 'PROCESSING', 'PENDING_REVIEW', 'PUBLISHED',
  'IMPORT_FAILED', 'DUPLICATE_CANDIDATE', 'REJECTED', 'ARCHIVED'
);

-- Publication state; only PUBLISHED is exposed on the public read path (docs/05 §7).
create type publication_state as enum (
  'DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED'
);

-- Subject facet, stored even when study type is ambiguous (docs/06 §6).
create type subject_type as enum (
  'HUMAN', 'ANIMAL', 'IN_VITRO', 'MIXED', 'NOT_APPLICABLE'
);

-- Canonical stored outcome scale (docs/07 §2). Labels are a presentation concern.
-- UNCLASSIFIED means "not yet assessed", never shown as a scientific outcome.
-- This is NOT a numeric efficacy score and carries no positive-minus-negative math.
create type outcome_value as enum (
  'STRONG_POSITIVE', 'POSITIVE', 'LEANING_POSITIVE', 'NEUTRAL_INCONCLUSIVE',
  'LEANING_NEGATIVE', 'NEGATIVE', 'STRONG_NEGATIVE', 'UNCLASSIFIED'
);

-- The independent classification dimensions (docs/05 §9). Never collapsed.
create type classification_dimension as enum (
  'OUTCOME', 'EVIDENCE_LEVEL', 'QUALITY', 'CONFIDENCE', 'STUDY_TYPE'
);

-- Confidence in a classification — independent of the outcome value (docs/07 §9).
create type confidence_level as enum ('LOW', 'MODERATE', 'HIGH');

-- Per-dimension methodological quality vocabulary (docs/08 §3).
create type quality_assessment_value as enum (
  'ADEQUATE', 'UNCLEAR', 'INADEQUATE', 'NOT_APPLICABLE'
);

create type quality_dimension as enum (
  'STUDY_DESIGN', 'SAMPLE_SIZE', 'RANDOMIZATION', 'ALLOCATION_CONCEALMENT',
  'BLINDING', 'CONTROL_QUALITY', 'ATTRITION', 'STATISTICAL_METHODS',
  'REPORTING_COMPLETENESS', 'REPLICATION', 'PUBLICATION_BIAS', 'OTHER'
);

-- Coarse, descriptive overall quality summary (docs/08 §4) — not a truth score.
create type quality_summary as enum ('HIGH', 'MODERATE', 'LOW', 'UNCLEAR');

-- Criticism vocabulary (docs/09 §2, §3, §5). Criticism is never a negative outcome.
create type criticism_category as enum (
  'METHODOLOGY', 'RANDOMIZATION', 'BLINDING', 'SAMPLE_SIZE', 'STATISTICS',
  'CONTROLS', 'REPLICATION', 'PUBLICATION_BIAS', 'REPORTING', 'INTERPRETATION',
  'GENERALIZABILITY', 'OTHER'
);

create type criticism_origin as enum (
  'AUTHOR_REPORTED', 'EXTERNAL_PUBLICATION', 'REVIEWER_ASSESSED', 'AI_SUGGESTED'
);

create type criticism_status as enum ('ACTIVE', 'WITHDRAWN', 'SUPERSEDED');

-- Identifier types; DOI canonicalisation is shared with @wise-evidence/domain.
create type identifier_type as enum (
  'DOI', 'PMID', 'PMCID', 'EUROPEPMC', 'URL', 'OTHER'
);

create type intervention_type as enum ('REMEDY', 'POTENCY', 'REGIMEN', 'OTHER');

create type import_method as enum ('MANUAL', 'CONNECTOR');

-- Application roles (docs/16 §3). Reviewers never receive DB-admin privileges.
create type app_role as enum ('PUBLIC', 'REVIEWER', 'ADMIN');

create type review_action as enum (
  'APPROVE', 'REJECT', 'REQUEST_CHANGES', 'EDIT', 'PUBLISH'
);

create type correction_status as enum ('OPEN', 'ACCEPTED', 'REJECTED', 'MERGED');

create type import_job_trigger as enum ('MANUAL', 'SCHEDULED');

create type import_job_state as enum ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

create type import_candidate_state as enum (
  'DISCOVERED', 'FETCHING', 'FETCHED', 'NORMALIZED', 'DUPLICATE_CANDIDATE',
  'IMPORTED', 'FAILED', 'REVIEW_REQUIRED'
);

-- AI job/result states (docs/10 §4, §6, §9). Results are immutable (see 0006).
create type ai_job_status as enum (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED'
);

create type ai_validation_status as enum ('PENDING', 'VALID', 'INVALID');

-- ---------------------------------------------------------------------------
-- Generic triggers.
-- ---------------------------------------------------------------------------

-- Maintain updated_at on any table that has such a column.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Reject UPDATE/DELETE so append-only tables stay immutable even for privileged
-- roles (docs/05 §10, docs/10 §4). Attached to audit_log and ai_result in 0006.
create or replace function app.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'append-only table %.%: % is not permitted',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;
