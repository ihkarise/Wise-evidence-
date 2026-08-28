-- =============================================================================
-- TEST SHIM — NOT A MIGRATION. NEVER APPLIED TO A REAL SUPABASE PROJECT.
-- =============================================================================
-- PGlite is stock PostgreSQL and does not ship the primitives that Supabase
-- provides in production: the `anon` / `authenticated` / `service_role` roles
-- and the `auth.uid()` / `auth.role()` helpers. This shim recreates EXACTLY
-- those primitives so the SAME canonical migrations and RLS policies can be
-- exercised locally. It replicates Supabase — it invents nothing new — and is
-- loaded only by the deterministic test harness, before the migrations. Real
-- Supabase already has all of this, so migrations there must NOT include it
-- (docs/25 §11, ADR-013).
-- =============================================================================

-- Supabase's PostgREST roles. service_role bypasses RLS in production; mirror
-- that here so privileged server-side writes behave identically in tests.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Supabase's auth schema + helpers. These read the request JWT claims that
-- PostgREST sets per request; the harness sets the same GUCs (request.jwt.claims)
-- when it assumes a role.
create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
