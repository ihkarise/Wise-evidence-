-- 0004_research_and_relations.sql
-- The core Study != Publication model and its relationships (docs/05 §4).

-- The underlying research study (one trial/experiment/review effort).
create table research_study (
  id uuid primary key default gen_random_uuid(),
  canonical_title text not null,
  study_type_code text references study_type (code),   -- human-final study type
  subject subject_type,
  lifecycle_state lifecycle_state not null default 'DISCOVERED',
  is_demo boolean not null default false,              -- demo/fixture marker (docs/17 §10)
  duplicate_of_study_id uuid references research_study (id), -- set only after review
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column research_study.is_demo is 'True for clearly-labeled demo/fixture data; excluded from public statistics. Never real research.';
comment on column research_study.duplicate_of_study_id is 'Human-confirmed duplicate link. Never set automatically; candidates go to review (docs/11 §7).';

-- A specific published artifact reporting a study. One study may have many.
create table publication (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references research_study (id) on delete cascade,
  title text not null,
  abstract text,                                       -- only where permitted (docs/17 §5)
  publication_date date,
  language text,
  journal_id uuid references journal (id),
  source_id uuid references research_source (id),
  publication_state publication_state not null default 'DRAFT',
  is_primary boolean not null default false,           -- the canonical publication of the study
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table publication is 'A published artifact of a study. Study != Publication: many publications may report one study (docs/05 §4).';

-- Ordered authorship (many-to-many).
create table publication_author (
  publication_id uuid not null references publication (id) on delete cascade,
  author_id uuid not null references author (id) on delete cascade,
  author_position int not null,
  primary key (publication_id, author_id)
);

-- External identifiers. Unique (type, canonical) supports exact-identifier dedup.
create table research_identifier (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid references publication (id) on delete cascade,
  study_id uuid references research_study (id) on delete cascade,
  id_type identifier_type not null,
  value_raw text not null,
  value_canonical text not null,
  created_at timestamptz not null default now(),
  unique (id_type, value_canonical),
  check (publication_id is not null or study_id is not null)
);
comment on table research_identifier is 'DOI/PMID/etc. Unique(id_type, value_canonical) enforces exact-identifier dedup (docs/05 §11).';

-- Study <-> taxonomy links (conditions/interventions attach at study level).
create table study_condition (
  study_id uuid not null references research_study (id) on delete cascade,
  condition_id uuid not null references condition (id) on delete cascade,
  primary key (study_id, condition_id)
);

create table study_intervention (
  study_id uuid not null references research_study (id) on delete cascade,
  intervention_id uuid not null references intervention (id) on delete cascade,
  primary key (study_id, intervention_id)
);

create table study_tag (
  study_id uuid not null references research_study (id) on delete cascade,
  tag_id uuid not null references tag (id) on delete cascade,
  primary key (study_id, tag_id)
);
