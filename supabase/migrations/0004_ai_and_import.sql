-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0004: AI and import infrastructure — SCHEMA ONLY.
--
-- These tables are created because the documented architecture requires them
-- (docs/05 §5, docs/10 §4, docs/11 §8). NO AI calls, NO scraping, NO connectors,
-- and NO scheduler are implemented in M2 — those belong to later milestones.
--
-- AI writes only here; the human-reviewed final value lives in `classification`
-- (migration 0005). An AI suggestion is never the same column as a human final
-- value (docs/05 §9, ADR-006).

-- ---------------------------------------------------------------------------
-- AIJob — one attempt of an AI operation over a study (docs/10 §4).
-- The unique cache key is research_id + operation + input_hash + model +
-- prompt_version (docs/10 §8, docs/21 §4).
-- ---------------------------------------------------------------------------
create table ai_job (
  id                uuid primary key default gen_random_uuid(),
  research_study_id uuid references research_study (id) on delete cascade,
  operation         text not null,   -- e.g. 'outcome-classification'
  provider          text not null,   -- e.g. 'mock'
  model             text not null,
  prompt_version    text not null,
  input_hash        text not null,
  status            ai_job_status not null default 'PENDING',
  cost_estimate     numeric(12, 6),  -- recorded where the provider exposes it
  created_at        timestamptz not null default now(),
  constraint ai_job_cache_key_unique
    unique (research_study_id, operation, input_hash, model, prompt_version)
);

-- ---------------------------------------------------------------------------
-- AIResult — the structured output of a job (docs/10 §4). IMMUTABLE: a new run
-- creates a new job+result; historical results are never overwritten. The
-- append-only trigger is attached in migration 0006 (after audit_log exists so
-- both share one place). Validation before storage is enforced in the AI
-- pipeline in Milestone 6 (docs/10 §6).
-- ---------------------------------------------------------------------------
create table ai_result (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references ai_job (id) on delete cascade,
  structured_output jsonb not null,
  confidence        numeric(4, 3),   -- 0.000 .. 1.000
  validation_status ai_validation_status not null default 'PENDING',
  created_at        timestamptz not null default now(),
  constraint ai_result_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

-- ---------------------------------------------------------------------------
-- ImportJob (docs/05 §5, docs/11 §8). Failures are visible and diagnosable,
-- never silently swallowed.
-- ---------------------------------------------------------------------------
create table import_job (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid references research_source (id),
  trigger      import_job_trigger not null default 'MANUAL',
  state        import_job_state not null default 'PENDING',
  counts       jsonb not null default '{}',
  started_at   timestamptz,
  ended_at     timestamptz,
  error_detail text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ImportCandidate (docs/05 §5, docs/11 §7-8). A fuzzy duplicate is routed to
-- review via duplicate_of_study_id; nothing is auto-deleted (docs/05 §11).
-- ---------------------------------------------------------------------------
create table import_candidate (
  id                    uuid primary key default gen_random_uuid(),
  import_job_id         uuid not null references import_job (id) on delete cascade,
  raw_payload           jsonb,
  normalized_payload    jsonb,
  dedup_decision        text,
  duplicate_of_study_id uuid references research_study (id),
  state                 import_candidate_state not null default 'DISCOVERED',
  error_detail          text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- updated_at maintenance
create trigger trg_import_job_touch       before update on import_job       for each row execute function app.touch_updated_at();
create trigger trg_import_candidate_touch before update on import_candidate for each row execute function app.touch_updated_at();
