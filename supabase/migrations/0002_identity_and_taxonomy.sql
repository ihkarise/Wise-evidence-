-- 0002_identity_and_taxonomy.sql
-- App users (REVIEWER/ADMIN) and admin-manageable taxonomy tables.
-- Public visitors are the anon role and have NO app_user row.

-- ---------------------------------------------------------------------------
-- Identity. app_user.auth_id maps to Supabase auth.uid() (the authenticated
-- user's UUID). Reviewers never receive database-admin privileges (docs/16 §3).
-- ---------------------------------------------------------------------------
create table app_user (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null unique,
  email text,
  display_name text,
  role app_role not null default 'REVIEWER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_user is 'Privileged users (REVIEWER/ADMIN). auth_id maps to auth.uid(). Public users are anon and have no row.';

-- ---------------------------------------------------------------------------
-- Taxonomy tables (admin-manageable, versioned — docs/06 §9). Each carries a
-- stable `code`. StudyType and EvidenceLevel are spec-defined but managed as
-- data so the taxonomy can evolve without a schema change.
-- ---------------------------------------------------------------------------
create table study_type (
  code text primary key,
  label text not null,
  clinical boolean not null,
  subject subject_type not null,
  hierarchy_position int,
  taxonomy_version text not null default 'taxonomy-v1'
);

create table evidence_level (
  code text primary key,
  label text not null,
  pyramid_rank int not null,          -- navigation ordering, NOT a truth score
  taxonomy_version text not null default 'taxonomy-v1'
);

create table condition (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  canonical_name text not null,
  synonyms text[] not null default '{}',
  parent_id uuid references condition (id),
  description text,
  created_at timestamptz not null default now()
);

create table intervention (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  canonical_name text not null,
  synonyms text[] not null default '{}',
  kind text,                          -- e.g. remedy, potency, regimen
  description text,
  created_at timestamptz not null default now()
);

create table tag (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null
);
