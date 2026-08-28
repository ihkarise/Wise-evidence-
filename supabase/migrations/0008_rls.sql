-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0008: Row-Level Security — the authoritative security boundary
-- (docs/16 §4, docs/05 §13). Security never depends on client-side hiding.
--
-- Roles used (anon, authenticated, service_role) are provided by Supabase in
-- production; this migration does NOT create them (see docs/25 §11-12). In the
-- deterministic test harness they are created by a clearly-labelled test shim
-- that replicates Supabase — never shipped in a migration.
--
-- M2 posture: anon/authenticated get SELECT only (RLS-filtered). NO INSERT/
-- UPDATE/DELETE is granted to them — every mutation goes through service_role
-- (server-side), which bypasses RLS. Reviewer write flows arrive in M3.

-- ---------------------------------------------------------------------------
-- Role-resolution helpers. SECURITY DEFINER + empty search_path so they read
-- app_user regardless of the caller's RLS and cannot be hijacked via search_path
-- (avoids RLS recursion on app_user). auth.uid() is provided by Supabase.
-- ---------------------------------------------------------------------------
create or replace function app.is_reviewer_or_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_user u
    where u.id = auth.uid()
      and u.role in ('REVIEWER'::public.app_role, 'ADMIN'::public.app_role)
  );
$$;

create or replace function app.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_user u
    where u.id = auth.uid() and u.role = 'ADMIN'::public.app_role
  );
$$;

create or replace function app.study_is_published(p_study_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.research_study s
    where s.id = p_study_id
      and s.publication_state = 'PUBLISHED'::public.publication_state
  );
$$;

create or replace function app.publication_study_is_published(p_pub_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.publication p
    join public.research_study s on s.id = p.study_id
    where p.id = p_pub_id
      and s.publication_state = 'PUBLISHED'::public.publication_state
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants. RLS is a second gate after privileges; anon/authenticated need SELECT
-- for the policies below to be evaluated at all. service_role gets everything
-- (and additionally bypasses RLS).
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;

grant execute on function app.is_reviewer_or_admin()             to anon, authenticated, service_role;
grant execute on function app.is_admin()                         to anon, authenticated, service_role;
grant execute on function app.study_is_published(uuid)           to anon, authenticated, service_role;
grant execute on function app.publication_study_is_published(uuid) to anon, authenticated, service_role;

-- Reference / bibliographic tables: public catalogue data.
grant select on taxonomy_version, evidence_level, study_type, condition,
                intervention, tag, author, journal, research_source
  to anon, authenticated;

-- Research tables: readable subject to the RLS policies below.
grant select on research_study, publication, publication_author,
                research_identifier, study_condition, study_intervention,
                study_tag, classification, evidence_quality_assessment, criticism
  to anon, authenticated;

-- Private tables: SELECT granted to authenticated only (RLS narrows to
-- reviewer/admin). anon receives NO grant at all — hard-denied.
grant select on app_user, review, correction, audit_log, import_job,
                import_candidate, ai_job, ai_result
  to authenticated;

-- service_role: full access to every table (also bypasses RLS).
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table.
-- ---------------------------------------------------------------------------
alter table taxonomy_version            enable row level security;
alter table evidence_level              enable row level security;
alter table study_type                  enable row level security;
alter table condition                   enable row level security;
alter table intervention                enable row level security;
alter table tag                         enable row level security;
alter table author                      enable row level security;
alter table journal                     enable row level security;
alter table research_source             enable row level security;
alter table research_study              enable row level security;
alter table publication                 enable row level security;
alter table publication_author          enable row level security;
alter table research_identifier         enable row level security;
alter table study_condition             enable row level security;
alter table study_intervention          enable row level security;
alter table study_tag                   enable row level security;
alter table classification              enable row level security;
alter table evidence_quality_assessment enable row level security;
alter table criticism                   enable row level security;
alter table app_user                    enable row level security;
alter table review                      enable row level security;
alter table correction                  enable row level security;
alter table audit_log                   enable row level security;
alter table import_job                  enable row level security;
alter table import_candidate            enable row level security;
alter table ai_job                      enable row level security;
alter table ai_result                   enable row level security;

-- ---------------------------------------------------------------------------
-- Reference / bibliographic: public read.
-- ---------------------------------------------------------------------------
create policy ref_read_taxonomy_version on taxonomy_version for select to anon, authenticated using (true);
create policy ref_read_evidence_level   on evidence_level   for select to anon, authenticated using (true);
create policy ref_read_study_type       on study_type       for select to anon, authenticated using (true);
create policy ref_read_condition        on condition        for select to anon, authenticated using (true);
create policy ref_read_intervention     on intervention     for select to anon, authenticated using (true);
create policy ref_read_tag              on tag              for select to anon, authenticated using (true);
create policy ref_read_author           on author           for select to anon, authenticated using (true);
create policy ref_read_journal          on journal          for select to anon, authenticated using (true);
create policy ref_read_source           on research_source  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Research: public read is limited to PUBLISHED studies and their children;
-- reviewers/admins additionally read everything (drafts included).
-- ---------------------------------------------------------------------------
create policy study_read_published on research_study for select to anon, authenticated
  using (publication_state = 'PUBLISHED');
create policy study_read_staff on research_study for select to authenticated
  using (app.is_reviewer_or_admin());

create policy pub_read_published on publication for select to anon, authenticated
  using (app.study_is_published(study_id));
create policy pub_read_staff on publication for select to authenticated
  using (app.is_reviewer_or_admin());

create policy pubauthor_read_published on publication_author for select to anon, authenticated
  using (app.publication_study_is_published(publication_id));
create policy pubauthor_read_staff on publication_author for select to authenticated
  using (app.is_reviewer_or_admin());

create policy ident_read_published on research_identifier for select to anon, authenticated
  using (
    (study_id is not null and app.study_is_published(study_id))
    or (publication_id is not null and app.publication_study_is_published(publication_id))
  );
create policy ident_read_staff on research_identifier for select to authenticated
  using (app.is_reviewer_or_admin());

create policy scond_read_published on study_condition for select to anon, authenticated
  using (app.study_is_published(study_id));
create policy scond_read_staff on study_condition for select to authenticated
  using (app.is_reviewer_or_admin());

create policy sinterv_read_published on study_intervention for select to anon, authenticated
  using (app.study_is_published(study_id));
create policy sinterv_read_staff on study_intervention for select to authenticated
  using (app.is_reviewer_or_admin());

create policy stag_read_published on study_tag for select to anon, authenticated
  using (app.study_is_published(study_id));
create policy stag_read_staff on study_tag for select to authenticated
  using (app.is_reviewer_or_admin());

-- Classification: public sees only human-reviewed final values (final_value not
-- null) on published studies. AI-only suggestions are never public here.
create policy class_read_published on classification for select to anon, authenticated
  using (final_value is not null and app.study_is_published(study_id));
create policy class_read_staff on classification for select to authenticated
  using (app.is_reviewer_or_admin());

create policy eqa_read_published on evidence_quality_assessment for select to anon, authenticated
  using (app.study_is_published(study_id));
create policy eqa_read_staff on evidence_quality_assessment for select to authenticated
  using (app.is_reviewer_or_admin());

-- Criticism: public sees ACTIVE criticism on published research.
create policy crit_read_published on criticism for select to anon, authenticated
  using (
    status = 'ACTIVE'
    and (
      (study_id is not null and app.study_is_published(study_id))
      or (publication_id is not null and app.publication_study_is_published(publication_id))
    )
  );
create policy crit_read_staff on criticism for select to authenticated
  using (app.is_reviewer_or_admin());

-- ---------------------------------------------------------------------------
-- Private tables: reviewer/admin read only; anon is hard-denied (no policy, no
-- grant). No write policies exist for anon/authenticated in M2.
-- ---------------------------------------------------------------------------
create policy user_read_self_or_admin on app_user for select to authenticated
  using (id = auth.uid() or app.is_admin());

create policy review_read_staff       on review           for select to authenticated using (app.is_reviewer_or_admin());
create policy correction_read_staff   on correction       for select to authenticated using (app.is_reviewer_or_admin());
create policy audit_read_staff        on audit_log        for select to authenticated using (app.is_reviewer_or_admin());
create policy importjob_read_staff    on import_job       for select to authenticated using (app.is_reviewer_or_admin());
create policy importcand_read_staff   on import_candidate for select to authenticated using (app.is_reviewer_or_admin());
create policy aijob_read_staff        on ai_job           for select to authenticated using (app.is_reviewer_or_admin());
create policy airesult_read_staff     on ai_result        for select to authenticated using (app.is_reviewer_or_admin());
