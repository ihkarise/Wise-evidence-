-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0002: reference taxonomy + bibliographic + provenance tables.
--
-- Growing, admin-curated taxonomies live in reference tables (ADR-013) so they
-- can be extended without ALTER TYPE. Each taxonomy row records the taxonomy
-- version it belongs to (docs/06 §2).

-- ---------------------------------------------------------------------------
-- Taxonomy version (docs/06 §2).
-- ---------------------------------------------------------------------------
create table taxonomy_version (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,           -- e.g. 'taxonomy-v1'
  description text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Evidence level — pyramid rank is a NAVIGATION ORDERING, not a truth score
-- (docs/06 §4, docs/00 §5-6).
-- ---------------------------------------------------------------------------
create table evidence_level (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,   -- e.g. 'RCT', 'OBSERVATIONAL'
  label               text not null,
  pyramid_rank        integer not null,       -- ordering only, never certainty
  taxonomy_version_id uuid not null references taxonomy_version (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Study type (docs/06 §3). Maps to a coarser evidence_level grouping.
-- ---------------------------------------------------------------------------
create table study_type (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,   -- e.g. 'RCT', 'META_ANALYSIS'
  label               text not null,
  is_clinical         boolean not null default true,
  subject_type        subject_type not null default 'HUMAN',
  evidence_level_id   uuid references evidence_level (id),
  hierarchy_position  integer,
  taxonomy_version_id uuid not null references taxonomy_version (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Condition taxonomy (docs/05 §5). Self-referential hierarchy.
-- ---------------------------------------------------------------------------
create table condition (
  id             uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  slug           text not null unique,
  synonyms       text[] not null default '{}',
  parent_id      uuid references condition (id),
  description    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Intervention taxonomy (docs/05 §5).
-- ---------------------------------------------------------------------------
create table intervention (
  id                uuid primary key default gen_random_uuid(),
  canonical_name    text not null,
  slug              text not null unique,
  synonyms          text[] not null default '{}',
  intervention_type intervention_type not null default 'OTHER',
  description       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tag — free-form but curated cross-cutting facet (docs/05 §5).
-- ---------------------------------------------------------------------------
create table tag (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Author — NO reputation/popularity score is stored (docs/13 §2).
-- ---------------------------------------------------------------------------
create table author (
  id                   uuid primary key default gen_random_uuid(),
  normalized_name      text not null,
  display_name         text not null,
  orcid                text,
  disambiguation_notes text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Journal (docs/05 §5).
-- ---------------------------------------------------------------------------
create table journal (
  id              uuid primary key default gen_random_uuid(),
  normalized_name text not null,
  issns           text[] not null default '{}',
  publisher       text,
  homepage_url    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Research source (+ provenance) (docs/05 §5, §8; docs/17 §3).
-- Source inclusion is not endorsement of the source's claims (docs/00 §12).
-- ---------------------------------------------------------------------------
create table research_source (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  url                    text,
  import_method          import_method not null default 'MANUAL',
  external_id            text,
  imported_at            timestamptz,
  verification_timestamp timestamptz,
  license_info           text,
  transformation_notes   text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- updated_at maintenance
create trigger trg_evidence_level_touch   before update on evidence_level   for each row execute function app.touch_updated_at();
create trigger trg_study_type_touch       before update on study_type       for each row execute function app.touch_updated_at();
create trigger trg_condition_touch        before update on condition        for each row execute function app.touch_updated_at();
create trigger trg_intervention_touch     before update on intervention     for each row execute function app.touch_updated_at();
create trigger trg_author_touch           before update on author           for each row execute function app.touch_updated_at();
create trigger trg_journal_touch          before update on journal          for each row execute function app.touch_updated_at();
create trigger trg_research_source_touch  before update on research_source  for each row execute function app.touch_updated_at();
