/**
 * Minimal Supabase-compatible auth shim for PGlite (ADR-012).
 *
 * This provides ONLY what Supabase supplies in production and nothing more, so
 * the real migration SQL (which references these) runs unchanged both here and
 * on Supabase:
 *   - the roles `anon`, `authenticated`, `service_role` (the last BYPASSRLS),
 *   - an `auth` schema with `auth.uid()` reading `request.jwt.claims`,
 *   - the grants those roles need to reach the schema and the helper.
 *
 * It is applied BEFORE the migrations. It is a test/local-bootstrap utility only
 * and is NOT a reproduction of the Supabase Auth platform. Real RLS behavior is
 * still exercised by PostgreSQL itself — this only supplies the identity context.
 */
export const AUTH_SHIM_SQL = /* sql */ `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;

-- Mirrors Supabase's auth.uid(): the 'sub' claim from the request JWT, or NULL.
create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;
