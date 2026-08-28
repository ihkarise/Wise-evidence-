-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0003: core research — Study vs Publication, authorship, identifiers,
-- and study-to-taxonomy links.
--
-- Study != Publication (docs/05 §4): a single underlying study may be reported in
-- multiple publications. Counting publications as studies inflates the evidence
-- base, so the two are modelled separately from day one.

-- ---------------------------------------------------------------------------
-- ResearchStudy — the conceptual unit of research (docs/05 §4, §6, §7).
-- is_demo defaults to false: real records are never accidentally demo (docs/17 §10).
-- ---------------------------------------------------------------------------
create table research_study (
  id                uuid primary key default gen_random_uuid(),
  canonical_title   text not null,
  normalized_title  text,                       -- dedup support (docs/05 §11)
  study_type_id     uuid references study_type (id),  -- human-final (docs/05 §4)
  subject_type      subject_type not null default 'NOT_APPLICABLE',
  lifecycle_state   study_lifecycle_state not null default 'DISCOVERED',
  publication_state publication_state not null default 'DRAFT',
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Publication — a specific published artifact reporting a study (docs/05 §4).
-- search_vector is FTS preparation for title/abstract (docs/14 §2-3, ADR-009).
-- ---------------------------------------------------------------------------
create table publication (
  id               uuid primary key default gen_random_uuid(),
  study_id         uuid not null references research_study (id) on delete cascade,
  title            text not null,
  abstract         text,
  publication_date date,
  language         text,
  journal_id       uuid references journal (id),
  source_id        uuid references research_source (id),
  is_primary       boolean not null default false,
  is_demo          boolean not null default false,
  search_vector    tsvector generated always as (
                     to_tsvector('english',
                       coalesce(title, '') || ' ' || coalesce(abstract, ''))
                   ) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ordered authorship (docs/05 §4).
-- ---------------------------------------------------------------------------
create table publication_author (
  publication_id uuid not null references publication (id) on delete cascade,
  author_id      uuid not null references author (id),
  author_order   integer not null default 0,
  primary key (publication_id, author_id)
);

-- ---------------------------------------------------------------------------
-- ResearchIdentifier (docs/05 §5, §11). UNIQUE(type, value_canonical) is the
-- exact-identifier deduplication gate. value_canonical for DOIs is produced by
-- @wise-evidence/domain normalizeDoi() (DOI logic is not duplicated here).
-- ---------------------------------------------------------------------------
create table research_identifier (
  id              uuid primary key default gen_random_uuid(),
  study_id        uuid references research_study (id) on delete cascade,
  publication_id  uuid references publication (id) on delete cascade,
  type            identifier_type not null,
  value_raw       text not null,
  value_canonical text not null,
  created_at      timestamptz not null default now(),
  constraint research_identifier_has_target
    check (study_id is not null or publication_id is not null),
  constraint research_identifier_type_value_unique
    unique (type, value_canonical)
);

-- ---------------------------------------------------------------------------
-- Study <-> taxonomy links.
-- ---------------------------------------------------------------------------
create table study_condition (
  study_id     uuid not null references research_study (id) on delete cascade,
  condition_id uuid not null references condition (id),
  primary key (study_id, condition_id)
);

create table study_intervention (
  study_id        uuid not null references research_study (id) on delete cascade,
  intervention_id uuid not null references intervention (id),
  primary key (study_id, intervention_id)
);

create table study_tag (
  study_id uuid not null references research_study (id) on delete cascade,
  tag_id   uuid not null references tag (id),
  primary key (study_id, tag_id)
);

-- updated_at maintenance
create trigger trg_research_study_touch before update on research_study for each row execute function app.touch_updated_at();
create trigger trg_publication_touch    before update on publication    for each row execute function app.touch_updated_at();
