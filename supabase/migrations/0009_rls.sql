-- 0009_rls.sql
-- Row-Level Security (docs/16 §4, docs/05 §13). Security is enforced here at the
-- database boundary, never by client-side hiding.
--
-- `auth.uid()` and the roles anon / authenticated / service_role are provided by
-- Supabase in production and by the minimal test shim locally (ADR-012). They are
-- intentionally NOT created in this migration, so it deploys to Supabase as-is.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read app_user under RLS).
-- ---------------------------------------------------------------------------
create schema if not exists app;

create or replace function app.current_app_role() returns app_role
  language sql stable security definer set search_path = public
as $$
  select role from app_user where auth_id = auth.uid()
$$;

create or replace function app.is_reviewer_or_admin() returns boolean
  language sql stable security definer set search_path = public, app
as $$
  select coalesce(app.current_app_role() in ('REVIEWER', 'ADMIN'), false)
$$;

create or replace function app.is_admin() returns boolean
  language sql stable security definer set search_path = public, app
as $$
  select coalesce(app.current_app_role() = 'ADMIN', false)
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table (default-deny until a policy allows).
-- ---------------------------------------------------------------------------
alter table app_user enable row level security;
alter table study_type enable row level security;
alter table evidence_level enable row level security;
alter table condition enable row level security;
alter table intervention enable row level security;
alter table tag enable row level security;
alter table author enable row level security;
alter table journal enable row level security;
alter table research_source enable row level security;
alter table research_study enable row level security;
alter table publication enable row level security;
alter table publication_author enable row level security;
alter table research_identifier enable row level security;
alter table study_condition enable row level security;
alter table study_intervention enable row level security;
alter table study_tag enable row level security;
alter table ai_job enable row level security;
alter table ai_result enable row level security;
alter table classification enable row level security;
alter table criticism enable row level security;
alter table review enable row level security;
alter table correction enable row level security;
alter table import_job enable row level security;
alter table import_candidate enable row level security;
alter table audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- Reference/taxonomy tables: public read; admin write.
-- ---------------------------------------------------------------------------
create policy study_type_read on study_type for select to anon, authenticated using (true);
create policy study_type_admin on study_type for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy evidence_level_read on evidence_level for select to anon, authenticated using (true);
create policy evidence_level_admin on evidence_level for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy condition_read on condition for select to anon, authenticated using (true);
create policy condition_admin on condition for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy intervention_read on intervention for select to anon, authenticated using (true);
create policy intervention_admin on intervention for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy tag_read on tag for select to anon, authenticated using (true);
create policy tag_admin on tag for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy author_read on author for select to anon, authenticated using (true);
create policy author_admin on author for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy journal_read on journal for select to anon, authenticated using (true);
create policy journal_admin on journal for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy research_source_read on research_source for select to anon, authenticated using (true);
create policy research_source_admin on research_source for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- Research: public reads only PUBLISHED; staff read all; admin writes.
-- ---------------------------------------------------------------------------
create policy study_public_read on research_study for select to anon, authenticated
  using (lifecycle_state = 'PUBLISHED');
create policy study_staff_read on research_study for select to authenticated
  using (app.is_reviewer_or_admin());
create policy study_admin_write on research_study for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy pub_public_read on publication for select to anon, authenticated
  using (publication_state = 'PUBLISHED');
create policy pub_staff_read on publication for select to authenticated
  using (app.is_reviewer_or_admin());
create policy pub_admin_write on publication for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- Helper predicate used by dependent tables: is a study publicly visible?
-- Expressed inline per policy (a study is public when PUBLISHED).
create policy pubauthor_public_read on publication_author for select to anon, authenticated
  using (exists (select 1 from publication p where p.id = publication_author.publication_id and p.publication_state = 'PUBLISHED'));
create policy pubauthor_staff on publication_author for all to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

create policy ident_public_read on research_identifier for select to anon, authenticated
  using (
    exists (select 1 from publication p where p.id = research_identifier.publication_id and p.publication_state = 'PUBLISHED')
    or exists (select 1 from research_study s where s.id = research_identifier.study_id and s.lifecycle_state = 'PUBLISHED')
  );
create policy ident_staff on research_identifier for all to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

create policy study_condition_public_read on study_condition for select to anon, authenticated
  using (exists (select 1 from research_study s where s.id = study_condition.study_id and s.lifecycle_state = 'PUBLISHED'));
create policy study_condition_staff on study_condition for all to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());
create policy study_intervention_public_read on study_intervention for select to anon, authenticated
  using (exists (select 1 from research_study s where s.id = study_intervention.study_id and s.lifecycle_state = 'PUBLISHED'));
create policy study_intervention_staff on study_intervention for all to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());
create policy study_tag_public_read on study_tag for select to anon, authenticated
  using (exists (select 1 from research_study s where s.id = study_tag.study_id and s.lifecycle_state = 'PUBLISHED'));
create policy study_tag_staff on study_tag for all to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

-- ---------------------------------------------------------------------------
-- Classification & criticism: public reads for published studies; reviewers
-- and admins read all and may write (this is the review workflow).
-- ---------------------------------------------------------------------------
create policy classification_public_read on classification for select to anon, authenticated
  using (exists (select 1 from research_study s where s.id = classification.study_id and s.lifecycle_state = 'PUBLISHED'));
create policy classification_staff_read on classification for select to authenticated
  using (app.is_reviewer_or_admin());
create policy classification_staff_write on classification for insert to authenticated
  with check (app.is_reviewer_or_admin());
create policy classification_staff_update on classification for update to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

create policy criticism_public_read on criticism for select to anon, authenticated
  using (status = 'active' and exists (select 1 from research_study s where s.id = criticism.study_id and s.lifecycle_state = 'PUBLISHED'));
create policy criticism_staff_read on criticism for select to authenticated
  using (app.is_reviewer_or_admin());
create policy criticism_staff_write on criticism for insert to authenticated
  with check (app.is_reviewer_or_admin());
create policy criticism_staff_update on criticism for update to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

-- ---------------------------------------------------------------------------
-- Sensitive tables: NO anon access. AI results, review, corrections, imports,
-- and audit are reviewer/admin only. Audit is insert-only for staff.
-- ---------------------------------------------------------------------------
create policy ai_job_staff on ai_job for select to authenticated using (app.is_reviewer_or_admin());
create policy ai_job_admin_write on ai_job for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy ai_result_staff on ai_result for select to authenticated using (app.is_reviewer_or_admin());
create policy ai_result_admin_write on ai_result for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy review_staff_read on review for select to authenticated using (app.is_reviewer_or_admin());
create policy review_staff_write on review for insert to authenticated with check (app.is_reviewer_or_admin());

create policy correction_staff_read on correction for select to authenticated using (app.is_reviewer_or_admin());
create policy correction_staff_update on correction for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

create policy import_job_staff on import_job for select to authenticated using (app.is_reviewer_or_admin());
create policy import_job_admin_write on import_job for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy import_candidate_staff on import_candidate for select to authenticated using (app.is_reviewer_or_admin());
create policy import_candidate_admin_write on import_candidate for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy audit_staff_read on audit_log for select to authenticated using (app.is_reviewer_or_admin());
create policy audit_staff_insert on audit_log for insert to authenticated with check (app.is_reviewer_or_admin());

-- ---------------------------------------------------------------------------
-- app_user: a user reads only their own row; admins read/manage all.
-- ---------------------------------------------------------------------------
create policy app_user_self_read on app_user for select to authenticated
  using (auth_id = auth.uid() or app.is_admin());
create policy app_user_admin_write on app_user for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- Privilege grants. RLS filters further; these are the base table privileges.
-- service_role has BYPASSRLS (set on the role) plus full grants.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;
grant execute on all functions in schema app to anon, authenticated, service_role;

-- Public read surface for anon (RLS still filters to published/allowed rows).
grant select on
  study_type, evidence_level, condition, intervention, tag, author, journal,
  research_source, research_study, publication, publication_author,
  research_identifier, classification, criticism,
  study_condition, study_intervention, study_tag
to anon;

-- Authenticated users may read all tables (RLS restricts sensitive ones to staff).
grant select on all tables in schema public to authenticated;

-- Reviewer-writable tables (RLS restricts to reviewer/admin).
grant insert, update on review, classification, criticism, correction to authenticated;

-- Admin-writable tables (RLS restricts to admin).
grant insert, update, delete on
  study_type, evidence_level, condition, intervention, tag, author, journal,
  research_source, research_study, publication, publication_author,
  research_identifier, study_condition, study_intervention, study_tag,
  ai_job, ai_result, import_job, import_candidate, app_user
to authenticated;

-- service_role: full privileges (and bypasses RLS via the role attribute).
grant all on all tables in schema public to service_role;
