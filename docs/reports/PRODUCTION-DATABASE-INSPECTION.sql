-- ============================================================================
-- WiseEvidence — PRODUCTION DATABASE INSPECTION  (READ-ONLY)
-- ============================================================================
-- Purpose:  Let the owner verify the LIVE Supabase/PostgreSQL database against
--           the repository's documented intent (migrations 0001–0012) WITHOUT
--           changing anything. Run it in the Supabase SQL editor (or psql) as a
--           privileged user; read the result of each numbered section against
--           the "EXPECT" notes in PRODUCTION-DATABASE-INSPECTION.md.
--
-- SAFETY CONTRACT (do not weaken):
--   * READ-ONLY. Every statement is a SELECT against catalog / information_schema
--     or the app's own rows. There are NO INSERT / UPDATE / DELETE / TRUNCATE,
--     NO DDL (CREATE/ALTER/DROP), NO GRANT/REVOKE, NO SET ROLE / SET SESSION
--     AUTHORIZATION, and NO transaction-privilege changes.
--   * It collects NO secrets: it never reads keys, passwords, JWT secrets, or
--     connection strings. It only reports schema shape, RLS/policy/grant posture,
--     and non-sensitive row COUNTS (never row contents of private tables).
--   * It is idempotent and side-effect free: running it twice yields the same
--     answer and leaves the database untouched.
--
-- HOW TO READ IT:  each section is a labelled SELECT. Nothing here decides
--   "pass/fail" for you — it surfaces the true state so a human can compare it to
--   the documented expectations. This script NEVER promotes a PENDING gate to
--   VERIFIED; that judgement is the owner's, made from these results.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Context — server version and current identity (no secrets).
-- ----------------------------------------------------------------------------
select '0. context' as section,
       current_database()            as database,
       current_user                  as current_user,
       version()                     as postgres_version;


-- ----------------------------------------------------------------------------
-- 1. Migration ledger presence — is the Supabase CLI migration table present?
--    (It exists only if migrations were pushed with `supabase db push`.)
--    This section is intentionally a CATALOG existence check so the script never
--    errors on a database that lacks the table. If `ledger_present = true`, run
--    the one-line follow-up query documented in the companion .md to list the
--    recorded versions.
--    EXPECT (when present): versions for 0001 … 0012 and NOTHING beyond 0012
--            (there is no 0013 / 0014 in the repository). When absent, infer the
--            applied state from sections 2–4 (actual schema shape) instead.
-- ----------------------------------------------------------------------------
select '1. migration ledger' as section,
       (to_regclass('supabase_migrations.schema_migrations') is not null) as ledger_present;


-- ----------------------------------------------------------------------------
-- 2. Table inventory — every application table the migrations define, and
--    whether it exists in the live schema. `present = false` on any row means a
--    migration did not apply.
--    EXPECT: present = true for all 27 tables.
-- ----------------------------------------------------------------------------
with expected(table_name, visibility) as (
  values
    ('taxonomy_version','public'), ('study_type','public'), ('evidence_level','public'),
    ('condition','public'), ('intervention','public'), ('tag','public'),
    ('author','public'), ('journal','public'), ('research_source','public'),
    ('research_study','public'), ('publication','public'), ('publication_author','public'),
    ('research_identifier','public'), ('classification','public'), ('criticism','public'),
    ('evidence_quality_assessment','public'), ('study_condition','public'),
    ('study_intervention','public'), ('study_tag','public'),
    -- private / staff-only (anon must hold no grant; RLS denies)
    ('app_user','private'), ('review','private'), ('correction','private'),
    ('audit_log','private'), ('import_job','private'), ('import_candidate','private'),
    ('ai_job','private'), ('ai_result','private')
)
select '2. table inventory' as section,
       e.table_name,
       e.visibility,
       (to_regclass('public.' || e.table_name) is not null) as present
from expected e
order by e.visibility, e.table_name;


-- ----------------------------------------------------------------------------
-- 3. Enum inventory — every domain enum type the migrations define.
--    EXPECT: present = true for all 23 types.
-- ----------------------------------------------------------------------------
with expected(type_name) as (
  values
    ('app_role'), ('study_lifecycle_state'), ('publication_state'), ('identifier_type'),
    ('subject_type'), ('outcome_value'), ('quality_summary'), ('quality_dimension'),
    ('quality_assessment_value'), ('classification_dimension'), ('confidence_level'),
    ('criticism_category'), ('criticism_origin'), ('criticism_status'), ('correction_status'),
    ('review_action'), ('intervention_type'), ('import_method'), ('import_job_state'),
    ('import_job_trigger'), ('import_candidate_state'), ('ai_job_status'), ('ai_validation_status')
)
select '3. enum inventory' as section,
       e.type_name,
       exists (
         select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
         where t.typname = e.type_name and n.nspname = 'public'
       ) as present
from expected e
order by e.type_name;


-- ----------------------------------------------------------------------------
-- 4. Row-Level Security — RLS must be ENABLED on every application table.
--    EXPECT: rls_enabled = true for every row. Any false is a security gap.
-- ----------------------------------------------------------------------------
select '4. rls enabled' as section,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'taxonomy_version','study_type','evidence_level','condition','intervention','tag',
    'author','journal','research_source','research_study','publication','publication_author',
    'research_identifier','classification','criticism','evidence_quality_assessment',
    'study_condition','study_intervention','study_tag',
    'app_user','review','correction','audit_log','import_job','import_candidate',
    'ai_job','ai_result'
  )
order by c.relrowsecurity, c.relname;


-- ----------------------------------------------------------------------------
-- 5. Policy inventory — how many RLS policies each table carries, by command.
--    EXPECT: public read tables have SELECT policies; private tables restrict to
--            staff; research_study/publication/classification/criticism carry the
--            reviewer/admin write policies from migration 0010.
-- ----------------------------------------------------------------------------
select '5. policy inventory' as section,
       schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;


-- ----------------------------------------------------------------------------
-- 6. anon GRANT posture (least privilege) — the migration-0012 check.
--    EXPECT after 0012:
--      * anon has SELECT on PUBLIC catalogue/research tables, and NO
--        INSERT/UPDATE/DELETE/TRUNCATE anywhere.
--      * anon has NO privilege of any kind on the PRIVATE tables
--        (app_user, review, correction, audit_log, import_job, import_candidate,
--         ai_job, ai_result).
--    If a private table shows any `true` for anon, migration 0012 has NOT been
--    applied (or a later default grant re-granted it) — that is the decision
--    point in the owner runbook (STEP 3).
-- ----------------------------------------------------------------------------
with app_tables(table_name, visibility) as (
  values
    ('taxonomy_version','public'), ('study_type','public'), ('evidence_level','public'),
    ('condition','public'), ('intervention','public'), ('tag','public'),
    ('author','public'), ('journal','public'), ('research_source','public'),
    ('research_study','public'), ('publication','public'), ('publication_author','public'),
    ('research_identifier','public'), ('classification','public'), ('criticism','public'),
    ('evidence_quality_assessment','public'), ('study_condition','public'),
    ('study_intervention','public'), ('study_tag','public'),
    ('app_user','private'), ('review','private'), ('correction','private'),
    ('audit_log','private'), ('import_job','private'), ('import_candidate','private'),
    ('ai_job','private'), ('ai_result','private')
)
select '6. anon grants' as section,
       t.visibility,
       t.table_name,
       has_table_privilege('anon', 'public.' || t.table_name, 'SELECT') as anon_select,
       has_table_privilege('anon', 'public.' || t.table_name, 'INSERT') as anon_insert,
       has_table_privilege('anon', 'public.' || t.table_name, 'UPDATE') as anon_update,
       has_table_privilege('anon', 'public.' || t.table_name, 'DELETE') as anon_delete
from app_tables t
where to_regclass('public.' || t.table_name) is not null
order by t.visibility, t.table_name;


-- ----------------------------------------------------------------------------
-- 7. authenticated / service_role posture — a spot check that the write path
--    survived hardening (migration 0010/0012).
--    EXPECT: authenticated keeps SELECT on private tables (RLS narrows it) and
--            its M3 content-write grants; service_role retains full access.
-- ----------------------------------------------------------------------------
select '7. role posture' as section,
       'authenticated' as role,
       has_table_privilege('authenticated', 'public.research_study', 'INSERT') as can_insert_research,
       has_table_privilege('authenticated', 'public.ai_result', 'SELECT')      as can_select_ai_result,
       has_table_privilege('authenticated', 'public.research_study', 'TRUNCATE') as can_truncate_research
union all
select '7. role posture',
       'service_role',
       has_table_privilege('service_role', 'public.research_study', 'INSERT'),
       has_table_privilege('service_role', 'public.ai_result', 'SELECT'),
       has_table_privilege('service_role', 'public.audit_log', 'INSERT');


-- ----------------------------------------------------------------------------
-- 8. Guard functions — the fail-closed publication/authorization logic that RLS
--    and triggers depend on (migrations 0008/0010).
--    EXPECT: present = true for every row. `enforce_publication_transition` is
--            the demo-protected, DRAFT→…→PUBLISHED state-machine guard.
-- ----------------------------------------------------------------------------
with expected(fn) as (
  values
    ('app.is_admin'), ('app.is_reviewer_or_admin'), ('app.study_is_published'),
    ('app.publication_study_is_published'), ('app.enforce_publication_transition'),
    ('app.validate_classification_value'), ('app.reject_mutation'), ('app.touch_updated_at')
)
select '8. guard functions' as section,
       e.fn,
       (to_regprocedure(e.fn || '()') is not null
         or exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = split_part(e.fn, '.', 1)
             and p.proname = split_part(e.fn, '.', 2)
         )) as present
from expected e
order by e.fn;


-- ----------------------------------------------------------------------------
-- 9. Publication-guard trigger — the DB-enforced state machine must be attached
--    to research_study.
--    EXPECT: at least one row (the BEFORE UPDATE publication-transition trigger).
-- ----------------------------------------------------------------------------
select '9. publication trigger' as section,
       t.tgname as trigger_name,
       c.relname as on_table,
       t.tgenabled as enabled_flag
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'research_study'
  and not t.tgisinternal
order by t.tgname;


-- ----------------------------------------------------------------------------
-- 10. Data footprint — demo vs. real rows and lifecycle spread. Counts only;
--     NO row contents. Lets the owner confirm production is not still seeded with
--     only DEMO fixtures, and that nothing was auto-published.
--     EXPECT: understand the split before going live. Every is_demo = true row is
--             unpublishable by design (migration 0010 demo guard).
-- ----------------------------------------------------------------------------
select '10. research footprint' as section,
       publication_state,
       is_demo,
       count(*) as studies
from research_study
group by publication_state, is_demo
order by publication_state, is_demo;


-- ----------------------------------------------------------------------------
-- 11. AI provenance footprint — how many AI jobs/results exist (counts only).
--     AI records are private (anon hard-denied). This confirms whether any
--     enrichment has run; it never exposes suggestion contents here.
--     EXPECT: any counts are fine; the point is visibility, not a target number.
-- ----------------------------------------------------------------------------
select '11. ai footprint' as section, 'ai_job' as relation, count(*) as rows from ai_job
union all
select '11. ai footprint', 'ai_result', count(*) from ai_result
union all
select '11. ai footprint', 'audit_log', count(*) from audit_log;

-- ============================================================================
-- END — nothing above modified the database. See the companion .md for how to
-- read each section and what to bring back to the team.
-- ============================================================================
