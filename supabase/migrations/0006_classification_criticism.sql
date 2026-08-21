-- 0006_classification_criticism.sql
-- Human-reviewed classifications and criticism. Outcome, quality, confidence,
-- and criticism are SEPARATE (docs/05 §2, docs/07-09). No efficacy score exists.

-- One human-reviewed value per (study, dimension). A classification row ALWAYS
-- represents a human final decision (final_actor NOT NULL). AI suggestions never
-- appear here — they live only in ai_result. If a human overrode an AI
-- suggestion, ai_result_id points to it and `value` may differ: both persist.
create table classification (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references research_study (id) on delete cascade,
  dimension classification_dimension not null,
  value text not null,                        -- canonical value/code for the dimension
  judgement_confidence confidence_level,      -- certainty IN this classification (docs/07 §9)
  explanation text,                           -- "why this classification" (human-authored)
  ai_result_id uuid references ai_result (id),-- the AI suggestion this decision relates to
  final_actor uuid not null references app_user (id),  -- the human reviewer (never NULL)
  final_reason text,                          -- reason on override (docs/12 §7)
  updated_at timestamptz not null default now(),
  unique (study_id, dimension),
  constraint classification_value_valid check (
    case dimension
      when 'OUTCOME' then value in (
        'STRONG_POSITIVE', 'POSITIVE', 'LEANING_POSITIVE', 'NEUTRAL_INCONCLUSIVE',
        'LEANING_NEGATIVE', 'NEGATIVE', 'STRONG_NEGATIVE'
      )
      when 'CONFIDENCE' then value in ('LOW', 'MODERATE', 'HIGH')
      when 'QUALITY' then value in ('ADEQUATE', 'UNCLEAR', 'INADEQUATE', 'NOT_APPLICABLE')
      when 'EVIDENCE_LEVEL' then value is not null   -- referential check to evidence_level at data-access layer (M3)
      when 'STUDY_TYPE' then value is not null       -- referential check to study_type at data-access layer (M3)
      else false
    end
  )
);
comment on table classification is 'Human-reviewed final values, one per (study, dimension). AI values are never stored here (docs/05 §9).';

-- Criticism is a distinct dimension: NOT a negative outcome (docs/09 §4). Its
-- origin (author/reviewer/AI/external) is always recorded and distinguishable.
create table criticism (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references research_study (id) on delete cascade,
  publication_id uuid references publication (id) on delete cascade,
  category criticism_category not null,
  origin criticism_origin not null,
  body text not null,
  source_reference text,                      -- citation for EXTERNAL_PUBLICATION criticism
  actor uuid references app_user (id),         -- reviewer, when REVIEWER_ASSESSED
  ai_result_id uuid references ai_result (id), -- when AI_SUGGESTED (pending review)
  status text not null default 'active',       -- active | withdrawn | superseded (retained, not deleted)
  created_at timestamptz not null default now()
);
comment on table criticism is 'Methodological criticism with tracked origin. Criticism != negative outcome (docs/09).';
