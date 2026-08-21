-- 0011_reviewer_workflow_rls.sql
-- Extend RLS for the M3 manual-research workflow (docs/12 §9a, docs/16).
-- M2 made research_study/publication writes admin-only. M3 lets a REVIEWER
-- create and edit research and drive it up to PENDING_REVIEW / REJECTED, and
-- create the reference author/journal/research_source rows an import needs.
--
-- Publish and archive stay ADMIN-ONLY: a reviewer's UPDATE `WITH CHECK` forbids
-- setting PUBLISHED/ARCHIVED. Taxonomy, app_user, ai_*, import_*, and audit are
-- unchanged. Reviewers can already write publication_author, research_identifier,
-- study_* links, classification, criticism, and review (M2 policies). Fail-closed:
-- these are permissive additions; nothing that was denied to admins is loosened.
-- Table-level INSERT/UPDATE grants to `authenticated` already exist (0009).

-- research_study: reviewer create + edit (never PUBLISHED/ARCHIVED, never demo).
create policy study_reviewer_insert on research_study for insert to authenticated
  with check (
    app.is_reviewer_or_admin()
    and is_demo = false
    and lifecycle_state <> 'PUBLISHED'
    and lifecycle_state <> 'ARCHIVED'
  );
create policy study_reviewer_update on research_study for update to authenticated
  using (app.is_reviewer_or_admin())
  with check (
    app.is_admin()
    or (lifecycle_state <> 'PUBLISHED' and lifecycle_state <> 'ARCHIVED' and is_demo = false)
  );

-- publication: reviewer create + edit (never PUBLISHED/ARCHIVED).
create policy pub_reviewer_insert on publication for insert to authenticated
  with check (
    app.is_reviewer_or_admin()
    and publication_state <> 'PUBLISHED'
    and publication_state <> 'ARCHIVED'
  );
create policy pub_reviewer_update on publication for update to authenticated
  using (app.is_reviewer_or_admin())
  with check (
    app.is_admin()
    or (publication_state <> 'PUBLISHED' and publication_state <> 'ARCHIVED')
  );

-- Reference entities created during a manual import (not taxonomy). Reviewers
-- may insert/update; delete remains admin-only (no reviewer delete policy).
create policy author_reviewer_insert on author for insert to authenticated
  with check (app.is_reviewer_or_admin());
create policy author_reviewer_update on author for update to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());
create policy journal_reviewer_insert on journal for insert to authenticated
  with check (app.is_reviewer_or_admin());
create policy journal_reviewer_update on journal for update to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());
create policy source_reviewer_insert on research_source for insert to authenticated
  with check (app.is_reviewer_or_admin());
create policy source_reviewer_update on research_source for update to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

-- Grant the audit INSERT privilege the M2 policy relies on (0009 created the
-- audit_staff_insert policy but did not grant INSERT to authenticated). RLS still
-- restricts the insert to reviewer/admin. Audit is never updated or deleted.
grant insert on audit_log to authenticated;
