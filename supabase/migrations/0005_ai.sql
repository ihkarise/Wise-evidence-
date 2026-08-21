-- 0005_ai.sql
-- AI subsystem (docs/10). AI output is stored ONLY here, never as a human final
-- classification. Results are immutable; a new run creates a new job+result.

create table ai_job (
  id uuid primary key default gen_random_uuid(),
  study_id uuid references research_study (id) on delete cascade,
  operation ai_operation not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_hash text not null,
  status ai_status not null default 'PENDING',
  cost_estimate numeric(12, 6),          -- provider cost where available
  created_at timestamptz not null default now()
);
comment on table ai_job is 'One AI operation attempt with full provenance (provider/model/prompt_version/input_hash). docs/10 §4,§10.';

create table ai_result (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ai_job (id) on delete cascade,
  output jsonb not null,                 -- validated structured output (docs/10 §6)
  suggested_value text,                  -- convenience: the single suggested value, if any
  confidence confidence_level,
  validation_status text not null default 'VALID',
  created_at timestamptz not null default now()
);
comment on table ai_result is 'Immutable AI suggestion. Never a human-reviewed canonical value; that lives in classification (docs/05 §9).';
