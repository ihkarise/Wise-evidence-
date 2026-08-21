-- 0007_review_import_audit.sql
-- Human review workflow, community corrections, import pipeline, and audit.

-- Human review actions on a study (docs/12). Preserves the reviewer decision.
create table review (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references research_study (id) on delete cascade,
  reviewer uuid not null references app_user (id),
  action review_action not null,
  dimension classification_dimension,          -- the dimension reviewed, when applicable
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text,
  created_at timestamptz not null default now()
);

-- Community/reviewer-originated change requests. Never overwrite canonical data
-- directly (docs/13 §4); history is preserved.
create table correction (
  id uuid primary key default gen_random_uuid(),
  study_id uuid references research_study (id) on delete cascade,
  publication_id uuid references publication (id) on delete cascade,
  target_field text,
  proposed_value text,
  submitter uuid references app_user (id),      -- null for anonymous community submissions
  submitter_note text,
  status correction_status not null default 'OPEN',
  resolution_actor uuid references app_user (id),
  resolution_reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Import pipeline (docs/11). Candidates carry raw + normalized payloads and a
-- dedup decision; duplicates are reviewable, never auto-deleted.
create table import_job (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  trigger import_method not null default 'MANUAL',
  state import_state not null default 'DISCOVERED',
  discovered_count int not null default 0,
  imported_count int not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table import_candidate (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references import_job (id) on delete cascade,
  raw_payload jsonb,
  normalized_payload jsonb,
  state import_state not null default 'DISCOVERED',
  duplicate_of_study_id uuid references research_study (id),
  error_detail text,
  created_at timestamptz not null default now()
);

-- Append-only audit of privileged changes (docs/05 §10, docs/12 §13).
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references app_user (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  field text,
  before_value text,
  after_value text,
  reason text,
  created_at timestamptz not null default now()
);
comment on table audit_log is 'Append-only. Actor/action/entity/field/before/after/timestamp/reason (docs/05 §10).';
