-- 0016_discovery_fields_rls.sql
-- Milestone 7 (Automated Research Discovery, docs/25). Discovery is a controlled,
-- STAFF-triggered candidate-generation mechanism. This migration:
--   1. records honest per-job counts,
--   2. gives an import candidate the provenance + review fields the workflow needs,
--   3. widens import_job/import_candidate WRITE from admin-only to reviewer-or-admin.
-- Nothing here lets discovery publish or classify: approval still routes through
-- the M3 createDraft service (study stays IMPORTED/DRAFT), and publication remains
-- ADMIN-only + fail-closed. All changes are additive.

-- 1. Honest counts on the import job (docs/25 §failure handling).
alter table import_job
  add column if not exists normalized_count int not null default 0,
  add column if not exists duplicate_count  int not null default 0,
  add column if not exists candidate_count  int not null default 0,
  add column if not exists error_count      int not null default 0;

-- 2. Candidate provenance + review fields. raw/normalized payloads already exist;
--    these promote the review-critical values to columns for RLS/audit clarity.
alter table import_candidate
  add column if not exists source_record_id  text,
  add column if not exists reviewed_by       uuid references app_user (id),
  add column if not exists reviewed_at       timestamptz,
  add column if not exists review_reason     text,
  add column if not exists imported_study_id uuid references research_study (id);

comment on column import_candidate.source_record_id is 'External source record identifier (provenance); preserved even when no DOI exists.';
comment on column import_candidate.imported_study_id is 'The research_study a human-approved candidate produced via createDraft. Never set automatically without approval.';

-- 3. Widen write access: discovery is staff-triggered (reviewer or admin), matching
--    who may run the review workflow. Read was already reviewer-or-admin (0009).
drop policy if exists import_job_admin_write on import_job;
drop policy if exists import_candidate_admin_write on import_candidate;

create policy import_job_staff_write on import_job for all to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());
create policy import_candidate_staff_write on import_candidate for all to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());
