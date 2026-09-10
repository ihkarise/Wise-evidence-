-- WiseEvidence — Milestone 7.4A
-- Migration 0013: discovery candidate identity + idempotency
-- (docs/30 §10.7, docs/reports/M7.3-DISCOVERY-RUN.md, ADR-020).
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- Automated discovery (M7.3) persists REVIEWABLE `import_candidate` rows and must
-- be idempotent: re-running a discovery must not create duplicate candidates. The
-- orchestrator keys candidate identity on (source_key, source_stable_id), but
-- `import_candidate` (migration 0004) has neither column nor a unique constraint,
-- so the M7.3 schema firewall stopped before persisting to the database.
--
-- This migration adds ONLY that identity and enforces it — the minimum additive
-- change. It does NOT redesign `import_candidate`, touch any other table, or add
-- AI / canonical-research / scheduler / queue fields. `import_job` already carries
-- the run lifecycle (state + counts + timestamps + error_detail), so it is
-- unchanged.
--
-- SAFETY
-- ---------------------------------------------------------------------------
-- Purely additive: two nullable columns plus one PARTIAL unique index. The
-- partial predicate means rows WITHOUT a discovery identity (NULLs — manual entry
-- and the DEMO fixtures) never participate in the constraint and never collide,
-- so existing rows cannot violate it. Writes to these tables remain a
-- `service_role` (server-only) operation; RLS and grants are unchanged (anon has
-- no access; staff SELECT-only), so this migration adds NO policy.

alter table import_candidate
  add column source_key       text,
  add column source_stable_id text;

comment on column import_candidate.source_key is
  'Discovery source key (e.g. "crossref"). NULL for non-discovery candidates.';
comment on column import_candidate.source_stable_id is
  'Stable per-source identity (e.g. the canonical DOI). With source_key this is the discovery idempotency key.';

-- Idempotency: at most one candidate per (source_key, source_stable_id) when both
-- are present. NULL identities (non-discovery candidates) are exempt, so multiple
-- unidentified candidates coexist and are never treated as "the same candidate"
-- (docs/30 §10.7 NULL policy). The database constraint is the final authority for
-- idempotent inserts; the adapter uses ON CONFLICT against this index.
create unique index if not exists import_candidate_source_identity_uniq
  on import_candidate (source_key, source_stable_id)
  where source_key is not null and source_stable_id is not null;
