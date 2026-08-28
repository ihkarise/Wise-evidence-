# ADR-014: Manual Research MVP — Hybrid SSR, Supabase-SSR Auth, Reviewer RLS, and a Metadata Provider Package

**Status:** Accepted
**Date:** 2026-08-28
**Related:** `docs/26-MANUAL-RESEARCH-MVP.md`, `ADR-003` (Supabase), `ADR-004`
(static-first public web), `ADR-006` (human review), `ADR-013` (database
foundation + PGlite testing), `docs/12`, `docs/16`, `docs/19`

## Context

Milestone 3 requires the first human-controlled research lifecycle: sign-in,
DOI-driven creation, an admin editor, a review/publish workflow, and a public
detail page (`docs/22`, `docs/26`). Several forces are in tension:

- M1 shipped a **static-first** public site with no SSR adapter (`ADR-004`).
  Authentication, per-request authorization, and privileged writes cannot be
  done from prerendered static pages.
- M2 shipped the full schema with **read-only** RLS for `anon`/`authenticated`
  and made every mutation `service_role`-only, explicitly deferring reviewer
  write flows to M3 (`ADR-013`, `docs/25` §11).
- The platform must fetch external bibliographic metadata (Crossref) **without**
  becoming an arbitrary URL fetcher, and without coupling app logic to one
  provider (`docs/16` §7, §10; master prompt §11–12).
- Security must live in the database and server, never in client-side hiding
  (`docs/16`), and reviewers must never gain the ability to publish or
  self-promote.
- Cost must stay free-first, and CI must stay deterministic and offline
  (`docs/21`, `ADR-013`).

## Decision

1. **Hybrid Astro rendering via `@astrojs/node` (standalone).** Public marketing
   pages stay prerendered; admin pages, API routes, and the public research
   detail page render on the server (`prerender = false` where needed). This
   preserves `ADR-004`'s static-first intent for content while enabling the
   controlled SSR M3 needs — it does **not** turn the whole site dynamic.

2. **Supabase Auth over `@supabase/ssr` with `httpOnly` cookie sessions.** No
   custom identity/password system. A request-scoped anon-key client (RLS-bound)
   serves the user's own reads/writes; a separate server-only service-role client
   is used **only** for the deliberately privileged publication/audit path. The
   service-role key never reaches the browser.

3. **Role resolution is server/database-side only.** `auth.uid()` → `app_user` →
   `role`; the M2 `SECURITY DEFINER` helpers remain the authoritative role source
   for RLS. No client claim is trusted. Authorization is enforced in three layers
   (RLS → service layer → middleware UX), with the database authoritative.

4. **Migration `0010` adds the minimum reviewer/admin write RLS**, plus a
   `research_study` publish-guard trigger that (a) enforces the allowed
   publication state machine, (b) forbids any transition into `PUBLISHED`/
   `ARCHIVED` unless the acting role is `ADMIN`, and (c) rejects publishing any
   `is_demo` record. Public read isolation from `0008` is unchanged; `app_user`
   remains non-writable by `authenticated` (no self-promotion).

5. **A new framework-independent `packages/metadata`** defines a
   `MetadataProvider` interface with a real `CrossrefMetadataProvider`
   (HTTPS-only, host-pinned to `api.crossref.org`, timeout/size-bounded,
   redirect-constrained, output sanitized and treated as untrusted) and a
   deterministic `MockMetadataProvider`. It reuses `@wise-evidence/domain`
   `normalizeDoi()` and imports nothing from Astro/React/Supabase/AI.

6. **Fail-closed publication in the service layer**, backstopped by the database
   trigger: `approveAndPublish()` runs in one transaction and aborts unless all
   required invariants (admin actor, correct state, provenance, identifier,
   human outcome classification, non-demo) hold.

## Consequences

**Positive**

- The public content site keeps its static, cheap, cacheable core; only what
  must be dynamic becomes dynamic.
- Security is enforced where it belongs: the reviewer→publish and
  reviewer→self-promote paths are closed in the database, independent of the UI
  or server code.
- The same canonical migrations/policies run in deterministic PGlite tests and
  deploy unchanged to a real Supabase project.
- The metadata boundary is provider-independent, offline-testable, and
  SSRF-hardened; adding future providers (PubMed, Europe PMC) needs no app
  changes.

**Negative / trade-offs**

- Introducing an SSR adapter adds a server runtime to deploy and operate
  (`docs/19`); the deployment target must run Node, not just a static CDN.
- A service-role key now exists in the server environment; it must be guarded
  (never `PUBLIC_`, never in client bundles, never committed). The
  credential-boundary discipline from M1 is now load-bearing.
- PGlite cannot verify every Supabase-specific auth/cookie behavior; live
  Supabase verification remains **PENDING** until a real project is supplied
  (`docs/26` §25) and is never fabricated.

**What this rules out (for M3)**

No AI, no scraping, no search, no evidence visualization, no automated
discovery, and no efficacy/combined score — consistent with `docs/26` and the
milestone sequence (`docs/22`).
