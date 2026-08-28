# ADR-013: Database Foundation — Enum/Table Taxonomy Split and PGlite Deterministic Testing

**Status:** Accepted
**Date:** 2026-08-28
**Related:** `docs/05-DATABASE-ARCHITECTURE.md`, `06-EVIDENCE-TAXONOMY.md`,
`07-OUTCOME-CLASSIFICATION.md`, `20-TESTING.md`, `25-DATABASE-FOUNDATION.md`,
`ADR-002`, `ADR-003`, `ADR-009`

## Context

Milestone 2 turns the conceptual data model (`05`) into concrete
version-controlled migrations. Two decisions are significant enough to record.

1. **How to represent controlled vocabularies.** Some vocabularies are fixed and
   credibility-critical (the outcome scale in `07`, criticism categories in `09`,
   quality values in `08`, lifecycle/publication states). Others are curated and
   expected to grow through the admin UI (`12` §11): study types, evidence levels,
   conditions, interventions, tags.

2. **How to run deterministic database tests without a paid or live service.**
   `20` requires database tests for migrations, constraints, and RLS behaviour,
   and `21` requires that contributors and CI run without spend or external
   infrastructure. The production target is Supabase (`ADR-003`), whose RLS relies
   on the `anon`/`authenticated`/`service_role` roles and `auth.*` helpers.

## Decision

1. **Enums for fixed vocabularies; reference tables for growing taxonomies.**
   PostgreSQL `ENUM` types encode outcome, criticism category, quality value and
   dimension, and lifecycle/publication/import/AI states — changing these is a
   versioned decision, ADR-worthy where it alters public interpretation (`07` §2,
   `06` §9). Study types, evidence levels, conditions, interventions, and tags are
   **reference tables** carrying a `taxonomy_version`, so admins can extend them
   without an `ALTER TYPE` migration. No aggregate efficacy/quality score is
   stored in either form.

2. **PGlite (in-process PostgreSQL, WASM) is the deterministic test database,**
   with a clearly-labelled, test-only Supabase compatibility **shim** that
   recreates the `anon`/`authenticated`/`service_role` roles and
   `auth.uid()`/`auth.role()` exactly as production Supabase provides them. The
   canonical migrations contain no shim and no invented Supabase roles/functions;
   the shim lives only in the test harness. Verification against a live Supabase
   project is tracked separately and marked PENDING until a project exists.

## Consequences

- Adding a study type or condition is a data change, not a type migration; the
  fixed scientific vocabularies stay locked behind explicit enum changes + ADRs.
- Database tests run offline, deterministically, and free in CI — real
  PostgreSQL semantics (constraints, triggers, RLS, FTS) are exercised, not a
  mock.
- The shim reproduces production auth primitives closely but not identically;
  RLS must still be confirmed on real Supabase before production launch (the
  PENDING verification), so the shim is scoped to tests and never shipped in a
  migration.
- The same migration SQL is intended to `supabase db push` unchanged, because it
  uses only roles/functions that Supabase actually provides.
