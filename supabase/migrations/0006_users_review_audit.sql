-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0006: users/roles, review, correction, audit log; append-only guards;
-- and the deferred FKs from classification/quality/criticism to app_user.

-- ---------------------------------------------------------------------------
-- Application user & role (docs/05 §5, docs/16 §3). `id` corresponds to the
-- Supabase auth.users id (auth.uid()). We intentionally do NOT add a hard FK to
-- auth.users so the migrations apply on any PostgreSQL/Supabase target; the
-- linkage is by convention (auth is managed by Supabase). Reviewers never receive
-- database-admin privileges.
-- ---------------------------------------------------------------------------
create table app_user (
  id           uuid primary key,               -- = auth.uid() in production
  email        text,
  display_name text,
  role         app_role not null default 'REVIEWER',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Deferred FKs: reviewer/actor references (tables were created before app_user).
alter table classification
  add constraint classification_final_actor_fkey
  foreign key (final_actor) references app_user (id);
alter table evidence_quality_assessment
  add constraint eqa_actor_fkey
  foreign key (actor) references app_user (id);
alter table criticism
  add constraint criticism_actor_fkey
  foreign key (actor) references app_user (id);

-- ---------------------------------------------------------------------------
-- Review — a human decision over a study's dimensions (docs/05 §5, docs/12 §9).
-- before/after snapshots preserve history; nothing is silently overwritten.
-- ---------------------------------------------------------------------------
create table review (
  id              uuid primary key default gen_random_uuid(),
  study_id        uuid not null references research_study (id) on delete cascade,
  reviewer_id     uuid references app_user (id),
  action          review_action not null,
  dimensions      text[] not null default '{}',
  before_snapshot jsonb,
  after_snapshot  jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Correction — community/reviewer-originated change request (docs/05 §5,
-- docs/13 §4). Canonical values are never directly overwritten by community
-- input; corrections append history.
-- ---------------------------------------------------------------------------
create table correction (
  id               uuid primary key default gen_random_uuid(),
  target_type      text not null,      -- e.g. 'research_study', 'classification'
  target_id        uuid,
  study_id         uuid references research_study (id) on delete cascade,
  field            text,
  proposed_value   text,
  submitter        text,               -- free-form contact/handle (M2: no accounts)
  status           correction_status not null default 'OPEN',
  resolution_actor uuid references app_user (id),
  reason           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AuditLog — append-only record of privileged actions (docs/05 §10, docs/12 §13).
-- ---------------------------------------------------------------------------
create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      uuid references app_user (id),
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  field      text,
  before     jsonb,
  after      jsonb,
  reason     text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Append-only enforcement (docs/05 §10, docs/10 §4): reject UPDATE/DELETE even
-- for privileged roles. A correction/new AI run is an INSERT, never a mutation.
-- ---------------------------------------------------------------------------
create trigger trg_audit_log_append_only
  before update or delete on audit_log
  for each row execute function app.reject_mutation();

create trigger trg_ai_result_append_only
  before update or delete on ai_result
  for each row execute function app.reject_mutation();

-- updated_at maintenance
create trigger trg_app_user_touch   before update on app_user   for each row execute function app.touch_updated_at();
create trigger trg_correction_touch before update on correction for each row execute function app.touch_updated_at();
