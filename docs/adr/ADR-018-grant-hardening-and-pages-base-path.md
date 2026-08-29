# ADR-018: `anon` Grant Hardening and Environment-Driven GitHub Pages Base Path

**Status:** Accepted — IMPLEMENTED (Production Readiness phase)
**Date:** 2026-08-29
**Related:** `docs/16-SECURITY.md`, `docs/19-DEPLOYMENT.md`, `docs/25-DATABASE-FOUNDATION.md`,
`ADR-004`, `ADR-013`, `ADR-014`

## Context

Two production-readiness issues surfaced once the application was exercised
against a real Supabase project and a real GitHub Pages deployment.

1. **GitHub Pages base path.** The site is served from the project subpath
   `https://ihkarise.github.io/Wise-evidence-/`, but `astro.config.mjs` set no
   `base`. Astro therefore emitted every asset URL (CSS/JS/favicon) and in-app
   link as root-absolute (`/_astro/…`, `/favicon.svg`, `/research`), which under
   the subpath resolve against the domain root and 404. The HTML loaded but the
   page rendered unstyled and un-hydrated.

2. **Stray `anon` SQL grants.** Migrations 0008/0010 document the intended
   posture — `anon` is SELECT-only on public catalogue/research tables, has no
   access to the private staff tables, and never writes. RLS enforces this (no
   anon policy on private tables → zero rows). But a real Supabase project ships
   `ALTER DEFAULT PRIVILEGES` that auto-grant `anon`/`authenticated` privileges on
   every table created in schema `public`. So on the live project `anon` can hold
   SQL-level grants (e.g. SELECT on `audit_log`, or INSERT/UPDATE/DELETE) that the
   migration comments describe as "no grant / hard-denied." Data stays protected
   by RLS, but the grant state contradicts the documented intent — a latent risk
   if RLS were ever disabled, a permissive anon policy added, or a SECURITY
   DEFINER view introduced.

## Decision

1. **Environment-driven base path (no framework or SSR change).** `base` and
   `site` in `astro.config.mjs` are read from `SITE_BASE` / `SITE_URL`. Production
   SSR sets neither, so `base` stays `"/"` and SSR output is byte-for-byte
   unchanged. The GitHub Pages preview workflow sets `SITE_BASE=/Wise-evidence-/`
   (and `SITE_URL=https://ihkarise.github.io`), so Astro prefixes every generated
   asset URL with the base. Author-written in-app links use a small `withBase()`
   helper (`apps/web/src/lib/base.ts`) — an identity at root, prefixing under the
   subpath — because Astro rewrites only the asset URLs it generates itself, not
   hand-written `href`/`src`/`action` values. GitHub Pages remains a **static
   visual preview only**, never the production runtime (ADR-004, `docs/19` §11).

2. **`anon` grant hardening (migration 0012).** A new, additive migration makes
   the SQL grants match the documented least-privilege intent: `REVOKE ALL` from
   `anon` on the private staff tables, and `REVOKE INSERT/UPDATE/DELETE/TRUNCATE`
   from `anon` on all public tables. `authenticated` keeps its SELECT on private
   tables (RLS-narrowed) and its M3 content-write grants (0010); `service_role`
   keeps `grant all`; `anon` keeps SELECT on public catalogue/research tables.
   This is defence in depth, not a behaviour change: the only observable effect is
   that an illegitimate `anon` write or private-table read is denied one gate
   earlier (privilege layer, not RLS layer). Every future table-creating migration
   must set its own explicit grants, since Supabase's default privileges will
   re-grant `anon` otherwise.

## Consequences

- The public site renders correctly under the Pages subpath; SSR production is
  unaffected. Verified locally by building with `SITE_BASE` and serving the output
  under `/Wise-evidence-/` in headless Chromium: CSS/JS/favicon all 200, the Copy
  DOI island hydrates and normalises, base-aware navigation works, zero console
  errors. The live Pages URL redeploys only after the repo owner enables
  **Settings → Pages → Source = GitHub Actions** and the workflow runs from the
  default branch.
- 0012 is safe for PostgREST/Supabase: no legitimate anon or authenticated path
  loses access, and `service_role` is untouched. It is tested in
  `packages/database/test/grants.test.ts`, which simulates the Supabase
  default-grant condition and proves the REVOKEs close it. **It must NOT be
  applied to production without explicit owner approval** (migrations are applied
  deliberately, never silently).
- The RLS boundary is unchanged and remains the authoritative gate; 0012 only
  aligns the privilege layer beneath it.
