-- WiseEvidence — Production Hardening
-- Migration 0012: least-privilege grant hardening for the `anon` role
-- (docs/16 §4, docs/19 §11, ADR-018).
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- Migrations 0008/0010 document the intended SQL-privilege posture: `anon` is
-- SELECT-only on public catalogue/research tables, has NO access to the private
-- staff tables, and NEVER writes anything. RLS is the authoritative boundary and
-- already enforces this (anon has no policy on the private tables, so it reads
-- zero rows regardless of grants).
--
-- However, a real Supabase project ships `ALTER DEFAULT PRIVILEGES` that
-- AUTO-GRANT `anon`/`authenticated` privileges on every table created in schema
-- `public`. So on the live project, `anon` can hold SQL-level grants (e.g. SELECT
-- on audit_log/app_user, or INSERT/UPDATE/DELETE) that the migration COMMENTS
-- describe as "no grant / hard-denied". The data stays protected by RLS, but the
-- grant state contradicts the documented intent — a latent risk that would turn
-- into real exposure if RLS were ever disabled on a table, a permissive anon
-- policy were added, or a SECURITY DEFINER view were introduced.
--
-- This migration makes the SQL grants MATCH the documented intent: defence in
-- depth, not a change of behaviour. The stock-PostgreSQL test harness (PGlite)
-- has no such default privileges, so there the REVOKEs are near-no-ops; against
-- real Supabase they remove the stray grants. See test/grants.test.ts, which
-- simulates the Supabase default-grant condition and asserts these statements
-- close it.
--
-- WHAT IS *NOT* CHANGED (and why this is safe for PostgREST/Supabase)
-- ---------------------------------------------------------------------------
--   * `authenticated` keeps SELECT on the private tables (RLS narrows to
--     reviewer/admin) and keeps its M3 INSERT/UPDATE/DELETE content grants
--     (migration 0010). Its access is untouched.
--   * `service_role` keeps `grant all` and continues to bypass RLS.
--   * `anon` keeps SELECT on the public catalogue/research tables, so the public
--     read path (PostgREST as anon) is unaffected.
-- The only observable change: an `anon` write, or an `anon` touch of a private
-- table, is now denied at the privilege layer (permission denied) instead of the
-- RLS layer (empty result). Same security outcome, enforced one gate earlier.
--
-- FORWARD RULE: because Supabase default privileges will re-grant `anon` on any
-- FUTURE table, every later migration that creates a table must set explicit
-- grants (and, for private tables, revoke `anon`) in that same migration — this
-- one only hardens the tables that exist through 0011.

-- ---------------------------------------------------------------------------
-- 1. Private / staff-only tables: `anon` gets nothing at all. Revoke every
--    privilege a Supabase default grant may have handed it. `authenticated` and
--    `service_role` are deliberately left alone.
-- ---------------------------------------------------------------------------
revoke all privileges on app_user, review, correction, audit_log, import_job,
                         import_candidate, ai_job, ai_result
  from anon;

-- ---------------------------------------------------------------------------
-- 2. `anon` is read-only EVERYWHERE. Strip any write privilege a default grant
--    may have handed it on any public table (it never legitimately writes; all
--    mutations go through authenticated-under-RLS or service_role). SELECT on the
--    public catalogue/research tables granted in 0008 is preserved.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- 3. Neither `anon` nor `authenticated` may TRUNCATE anything (never intended;
--    authenticated's specific INSERT/UPDATE/DELETE content grants from 0010 are
--    left intact).
-- ---------------------------------------------------------------------------
revoke truncate on all tables in schema public from authenticated;
