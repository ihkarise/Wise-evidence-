-- WiseEvidence — Milestone 6 AI Enrichment
-- Migration 0011: additive, nullable diagnostics/usage columns for the AI
-- pipeline (docs/29 §8.1, ADR-017).
--
-- The M2 schema already ships the AI tables (ai_job, ai_result, migration 0004),
-- their immutability trigger (0006), the cache-key unique constraint (0004), and
-- the ai_result_id provenance FKs on classification / evidence_quality_assessment
-- / criticism (0005). M6 adds only the MINIMUM extra columns needed to record
-- real token usage, timings, and validation diagnostics.
--
-- Everything here is additive and NULL-able, so existing rows and the DEMO
-- fixtures keep working unchanged. There are NO new tables, NO RLS changes, and
-- NO new privileges: AI writes continue to flow only through the trusted
-- service_role server path (0008 granted it `all`; anon/authenticated still have
-- no INSERT/UPDATE on ai_job/ai_result). AI remains a suggestion engine — it
-- never becomes canonical, never publishes, and never enters the M5 statistics.

-- ---------------------------------------------------------------------------
-- ai_job: real usage (NULL = "not reported", never zero — docs/29 §14), request
-- timings, a safe operational error detail, and the content hash of the exact
-- prompt version that ran (docs/29 §6). cost_estimate already exists (0004).
-- ---------------------------------------------------------------------------
alter table ai_job add column if not exists input_tokens       integer;
alter table ai_job add column if not exists output_tokens      integer;
alter table ai_job add column if not exists total_tokens       integer;
alter table ai_job add column if not exists started_at         timestamptz;
alter table ai_job add column if not exists finished_at        timestamptz;
alter table ai_job add column if not exists error_detail       text;
alter table ai_job add column if not exists prompt_content_hash text;

-- Token counts, when present, are non-negative. NULL stays allowed (unknown).
alter table ai_job drop constraint if exists ai_job_tokens_nonneg;
alter table ai_job add constraint ai_job_tokens_nonneg check (
  (input_tokens  is null or input_tokens  >= 0) and
  (output_tokens is null or output_tokens >= 0) and
  (total_tokens  is null or total_tokens  >= 0)
);

-- ---------------------------------------------------------------------------
-- ai_result: why an INVALID result failed validation (safe, non-secret text),
-- and the SHA-256 of the exact raw model output for integrity — without storing
-- the full raw payload or any secret (docs/29 §11-12). ai_result stays IMMUTABLE
-- (the append-only trigger from 0006 rejects UPDATE/DELETE).
-- ---------------------------------------------------------------------------
alter table ai_result add column if not exists validation_error  text;
alter table ai_result add column if not exists raw_output_sha256  text;
