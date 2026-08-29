-- WiseEvidence — Milestone 3 Manual Research MVP
-- Migration 0010: reviewer/admin WRITE Row-Level Security + the publication guard.
--
-- M2 (0008) shipped read-only RLS: anon/authenticated got SELECT only, and every
-- mutation went through service_role. M3 adds the MINIMUM write policies needed
-- for the documented reviewer workflow (docs/26 §10, docs/12), WITHOUT weakening
-- public isolation:
--   * every write policy requires app.is_reviewer_or_admin();
--   * a signed-in non-staff user still cannot mutate anything;
--   * anon still cannot mutate anything (no grant, no policy);
--   * app_user stays non-writable by authenticated → no self-promotion;
--   * a BEFORE UPDATE guard on research_study enforces the publication state
--     machine, restricts transitions INTO published/archived to ADMIN (or the
--     trusted service_role server path), and REJECTS publishing demo records.
--
-- The guard fires only on UPDATE transitions, so the M2 demo fixtures — which
-- INSERT already-published demo rows as the owner for the public-read tests —
-- keep working unchanged (docs/26 §20).
--
-- This is the same canonical SQL that deploys to a real Supabase project; the
-- anon/authenticated/service_role roles are provided by Supabase in production
-- and by the test shim in CI (never shipped in a migration).

-- ---------------------------------------------------------------------------
-- Human-authored summary (docs/26 §17). The M2 schema had no free-text summary
-- field; M3 adds one on research_study so it is (a) editable by staff and
-- (b) exposed to the public read path for PUBLISHED studies (the existing
-- research_study SELECT policies already govern visibility). It is NOT a score
-- and carries no classification meaning.
-- ---------------------------------------------------------------------------
alter table research_study add column if not exists human_summary text;

-- ---------------------------------------------------------------------------
-- Publication guard. SECURITY DEFINER helpers from 0008 (app.is_admin) resolve
-- the acting app_user by auth.uid(). service_role (trusted server path) has no
-- auth.uid(), so it is recognised by current_user instead — the service layer
-- has already verified the ADMIN actor before using that path (docs/26 §4, §19).
-- ---------------------------------------------------------------------------
create or replace function app.enforce_publication_transition()
returns trigger
language plpgsql
as $$
declare
  is_privileged boolean := app.is_admin() or current_user = 'service_role';
begin
  -- Only care about changes to the public-facing publication_state.
  if new.publication_state is not distinct from old.publication_state then
    return new;
  end if;

  -- Entering PUBLISHED.
  if new.publication_state = 'PUBLISHED'
     and old.publication_state is distinct from 'PUBLISHED' then
    -- Demo records can NEVER be published (docs/26 §20).
    if new.is_demo then
      raise exception 'refusing to publish a demo record (is_demo = true)'
        using errcode = 'restrict_violation';
    end if;
    -- Only ADMIN (or the trusted server) may publish.
    if not is_privileged then
      raise exception 'only ADMIN may publish research'
        using errcode = 'insufficient_privilege';
    end if;
    -- Fail-closed state machine: publish only from PENDING_REVIEW.
    if old.publication_state is distinct from 'PENDING_REVIEW' then
      raise exception 'a study must be PENDING_REVIEW before it can be PUBLISHED (was %)',
        old.publication_state
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  -- Entering ARCHIVED is an ADMIN/server-only privileged operation.
  if new.publication_state = 'ARCHIVED'
     and old.publication_state is distinct from 'ARCHIVED' then
    if not is_privileged then
      raise exception 'only ADMIN may archive research'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- Leaving PUBLISHED (un-publishing) is likewise ADMIN/server-only.
  if old.publication_state = 'PUBLISHED'
     and new.publication_state is distinct from 'PUBLISHED' then
    if not is_privileged then
      raise exception 'only ADMIN may change a PUBLISHED study''s state'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- All remaining transitions among DRAFT / PENDING_REVIEW / REJECTED are
  -- permitted for reviewers (the row-level UPDATE policy already required
  -- app.is_reviewer_or_admin()).
  return new;
end;
$$;

create trigger trg_research_study_publication_guard
  before update on research_study
  for each row execute function app.enforce_publication_transition();

-- ---------------------------------------------------------------------------
-- Write grants for authenticated. RLS policies below narrow these to
-- reviewers/admins; the grant is only the first gate (docs/25 §11).
-- service_role already has `grant all` from 0008 and bypasses RLS.
-- ---------------------------------------------------------------------------

-- Bibliographic entities a reviewer may create/curate while editing.
grant insert, update on author, journal, research_source to authenticated;

-- Core research the workflow writes.
grant insert, update on research_study, publication, research_identifier,
                        classification, evidence_quality_assessment, criticism
  to authenticated;

-- Join tables: insert + delete (link / unlink from the editor's +Add / Remove).
grant insert, delete on publication_author, study_condition,
                        study_intervention, study_tag
  to authenticated;

-- Review log: a reviewer records their own decisions. audit_log stays
-- append-only and is written only via the privileged server path (no
-- authenticated insert), preserving its trusted-provenance guarantee.
grant insert on review to authenticated;

-- ---------------------------------------------------------------------------
-- Write policies. Every one requires app.is_reviewer_or_admin(); none of them
-- is granted to anon. app_user has NO write policy → roles are immutable from
-- the authenticated path (self-promotion is impossible).
-- ---------------------------------------------------------------------------

-- Reference / bibliographic tables ------------------------------------------
create policy author_write_staff  on author for insert to authenticated with check (app.is_reviewer_or_admin());
create policy author_update_staff on author for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());
create policy journal_write_staff  on journal for insert to authenticated with check (app.is_reviewer_or_admin());
create policy journal_update_staff on journal for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());
create policy source_write_staff  on research_source for insert to authenticated with check (app.is_reviewer_or_admin());
create policy source_update_staff on research_source for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

-- ResearchStudy: staff create only non-demo DRAFTs; the publication guard
-- (trigger above) governs transitions into published/archived on UPDATE.
create policy study_insert_staff on research_study for insert to authenticated
  with check (app.is_reviewer_or_admin() and publication_state = 'DRAFT' and is_demo = false);
create policy study_update_staff on research_study for update to authenticated
  using (app.is_reviewer_or_admin())
  with check (app.is_reviewer_or_admin());

-- Publication + identifiers + classification + quality + criticism.
create policy pub_insert_staff on publication for insert to authenticated with check (app.is_reviewer_or_admin());
create policy pub_update_staff on publication for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

create policy ident_insert_staff on research_identifier for insert to authenticated with check (app.is_reviewer_or_admin());
create policy ident_update_staff on research_identifier for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

create policy class_insert_staff on classification for insert to authenticated with check (app.is_reviewer_or_admin());
create policy class_update_staff on classification for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

create policy eqa_insert_staff on evidence_quality_assessment for insert to authenticated with check (app.is_reviewer_or_admin());
create policy eqa_update_staff on evidence_quality_assessment for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

create policy crit_insert_staff on criticism for insert to authenticated with check (app.is_reviewer_or_admin());
create policy crit_update_staff on criticism for update to authenticated using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

-- Join tables (insert + delete for link / unlink).
create policy pubauthor_insert_staff on publication_author for insert to authenticated with check (app.is_reviewer_or_admin());
create policy pubauthor_delete_staff on publication_author for delete to authenticated using (app.is_reviewer_or_admin());
create policy scond_insert_staff on study_condition for insert to authenticated with check (app.is_reviewer_or_admin());
create policy scond_delete_staff on study_condition for delete to authenticated using (app.is_reviewer_or_admin());
create policy sinterv_insert_staff on study_intervention for insert to authenticated with check (app.is_reviewer_or_admin());
create policy sinterv_delete_staff on study_intervention for delete to authenticated using (app.is_reviewer_or_admin());
create policy stag_insert_staff on study_tag for insert to authenticated with check (app.is_reviewer_or_admin());
create policy stag_delete_staff on study_tag for delete to authenticated using (app.is_reviewer_or_admin());

-- Review log: a reviewer/admin may insert their own review rows.
create policy review_insert_staff on review for insert to authenticated
  with check (app.is_reviewer_or_admin());
