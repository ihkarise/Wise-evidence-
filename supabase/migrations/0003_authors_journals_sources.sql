-- 0003_authors_journals_sources.sql
-- People, venues, and provenance sources.

create table author (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null,      -- lowercased/normalized for matching
  display_name text not null,
  orcid text,
  disambiguation_note text,
  created_at timestamptz not null default now()
);
-- No reputation/popularity score is ever stored (docs/13 §2).
comment on table author is 'Research authors. No reputation or popularity scoring (docs/13).';

create table journal (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null,
  display_name text not null,
  issn text[] not null default '{}',
  publisher text,
  homepage_url text,
  created_at timestamptz not null default now()
);

-- Provenance source of a publication (docs/05 §8, docs/17). A publication may
-- accrue multiple source observations over time.
create table research_source (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_url text,
  publisher_url text,
  import_method import_method not null default 'MANUAL',
  external_id text,
  license_info text,
  transformation_notes text,
  imported_at timestamptz not null default now(),
  verification_timestamp timestamptz
);

comment on table research_source is 'Provenance for a publication: where it came from, how, and under what license (docs/17).';
