-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0005: classification dimensions, per-dimension quality, criticism.
--
-- Outcome != Quality != Confidence != Criticism (docs/00 §4). Each dimension is
-- an independent row/table; no column mixes two dimensions. There is NO
-- aggregate efficacy score and NO positive-minus-negative weighting anywhere.

-- ---------------------------------------------------------------------------
-- Classification — binds a study to ONE dimension's value (docs/05 §9).
-- The AI suggestion (ai_result_id) and the human final value (final_value) are
-- NEVER the same column. final_value is null until a human sets it (ADR-006).
-- ---------------------------------------------------------------------------
create table classification (
  id           uuid primary key default gen_random_uuid(),
  study_id     uuid not null references research_study (id) on delete cascade,
  dimension    classification_dimension not null,
  final_value  text,                              -- H: human-reviewed final value
  final_actor  uuid,                              -- app_user.id (FK added in 0006)
  final_reason text,
  ai_result_id uuid references ai_result (id),    -- AI suggestion, immutable
  confidence   confidence_level,                  -- independent of the value
  explanation  text,                              -- "why this classification"
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint classification_study_dimension_unique unique (study_id, dimension)
);

-- Validate final_value against the correct vocabulary for its dimension, so a
-- value from one dimension can never be stored under another (keeps dimensions
-- independent and type-safe). A null final_value is always allowed (unreviewed).
create or replace function app.validate_classification_value()
returns trigger
language plpgsql
as $$
begin
  if new.final_value is null then
    return new;
  end if;

  case new.dimension
    when 'OUTCOME' then
      begin
        perform new.final_value::outcome_value;
      exception when invalid_text_representation then
        raise exception 'invalid OUTCOME value: %', new.final_value;
      end;
    when 'CONFIDENCE' then
      begin
        perform new.final_value::confidence_level;
      exception when invalid_text_representation then
        raise exception 'invalid CONFIDENCE value: %', new.final_value;
      end;
    when 'QUALITY' then
      begin
        perform new.final_value::quality_summary;
      exception when invalid_text_representation then
        raise exception 'invalid QUALITY value: %', new.final_value;
      end;
    when 'STUDY_TYPE' then
      if not exists (select 1 from study_type where code = new.final_value) then
        raise exception 'unknown STUDY_TYPE code: %', new.final_value;
      end if;
    when 'EVIDENCE_LEVEL' then
      if not exists (select 1 from evidence_level where code = new.final_value) then
        raise exception 'unknown EVIDENCE_LEVEL code: %', new.final_value;
      end if;
  end case;

  return new;
end;
$$;

create trigger trg_classification_validate
  before insert or update on classification
  for each row execute function app.validate_classification_value();

-- ---------------------------------------------------------------------------
-- EvidenceQualityAssessment — per-dimension methodological rigor (docs/08 §3),
-- stored entirely separately from outcome. A positive study is not automatically
-- high quality and vice versa (docs/08 §1).
-- ---------------------------------------------------------------------------
create table evidence_quality_assessment (
  id           uuid primary key default gen_random_uuid(),
  study_id     uuid not null references research_study (id) on delete cascade,
  dimension    quality_dimension not null,
  value        quality_assessment_value not null,
  note         text,
  actor        uuid,                             -- app_user.id (FK added in 0006)
  ai_result_id uuid references ai_result (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint eqa_study_dimension_unique unique (study_id, dimension)
);

-- ---------------------------------------------------------------------------
-- Criticism — a distinct dimension, NOT a negative outcome (docs/09 §4). Adding
-- criticism never mutates any outcome value. Origin is always distinguishable
-- (docs/09 §3). Withdrawn/superseded rows are retained, not deleted (docs/09 §5).
-- ---------------------------------------------------------------------------
create table criticism (
  id               uuid primary key default gen_random_uuid(),
  study_id         uuid references research_study (id) on delete cascade,
  publication_id   uuid references publication (id) on delete cascade,
  category         criticism_category not null,
  origin           criticism_origin not null,
  text             text not null,
  source_reference text,        -- citation/provenance for EXTERNAL_PUBLICATION
  source_url       text,
  actor            uuid,        -- app_user.id (FK added in 0006)
  ai_result_id     uuid references ai_result (id),
  status           criticism_status not null default 'ACTIVE',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint criticism_has_target
    check (study_id is not null or publication_id is not null)
);

-- updated_at maintenance
create trigger trg_classification_touch before update on classification            for each row execute function app.touch_updated_at();
create trigger trg_eqa_touch            before update on evidence_quality_assessment for each row execute function app.touch_updated_at();
create trigger trg_criticism_touch      before update on criticism                 for each row execute function app.touch_updated_at();
