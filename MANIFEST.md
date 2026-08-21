# WiseEvidence Architecture Manifest

**Status:** Milestone 0 (Architecture Completion) complete.
**Updated:** 2026-08-21

The architecture package was originally distributed as
`WiseEvidence_Architecture_Package_v0.1.zip`. In Milestone 0 the package was
**unpacked into tracked files and the zip retired**, so the repository is now the
single source of truth for the architecture.

## Repository documents

Top level:

- `README.md`
- `MANIFEST.md` (this file)
- `CLAUDE.md` — guidance for AI assistants (repo-level summary)
- `CLAUDE-CODE-MASTER-PROMPT.md` — authoritative lead-architect brief

Architecture specifications (`docs/`):

- `00-ARCHITECTURE-BASELINE.md`
- `01-VISION.md`
- `02-PRODUCT-REQUIREMENTS.md`
- `03-INFORMATION-ARCHITECTURE.md`
- `04-SYSTEM-ARCHITECTURE.md`
- `05-DATABASE-ARCHITECTURE.md`
- `06-EVIDENCE-TAXONOMY.md`
- `07-OUTCOME-CLASSIFICATION.md`
- `08-EVIDENCE-QUALITY.md`
- `09-CRITICISM-FRAMEWORK.md`
- `10-AI-ARCHITECTURE.md`
- `11-DATA-IMPORT-ARCHITECTURE.md`
- `12-ADMIN-ARCHITECTURE.md`
- `13-COMMUNITY-ARCHITECTURE.md`
- `14-SEARCH-ARCHITECTURE.md`
- `15-UI-UX-SPECIFICATION.md`
- `16-SECURITY.md`
- `17-DATA-GOVERNANCE.md`
- `18-OPEN-SOURCE-GOVERNANCE.md`
- `19-DEPLOYMENT.md`
- `20-TESTING.md`
- `21-COST-CONTROL.md`
- `22-ROADMAP.md`
- `23-AI-AGENT-INSTRUCTIONS.md`

Architecture Decision Records (`docs/adr/`):

- `README.md` (index + template)
- `ADR-001-modular-monolith.md` … `ADR-012-pglite-database-testing.md`

Milestone 0 reports (`docs/reports/`):

- `ARCHITECTURE-CROSSCHECK.md` — contradiction/consistency report
- `MVP-SCOPE.md` — finalized MVP scope
- `TECH-STACK-DECISION.md` — confirmed technology stack

## Application foundation (Milestone 1)

The runnable foundation now lives alongside the docs:

- Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `.env.example`.
- `apps/web/` — Astro app (static-first + a React `CopyDoi` island, Tailwind).
- `packages/domain/` — portable logic: `normalizeDoi()` + Vitest tests.
- `supabase/README.md` — connection strategy only (schema is Milestone 2).
- `.github/workflows/ci.yml` + issue/PR templates.
- Governance: `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`.

## Database foundation (Milestone 2)

- `supabase/migrations/0001_enums.sql` … `0009_rls.sql` — the canonical schema:
  enums, identity + taxonomy, authors/journals/sources, the Study≠Publication
  core, AI job/result, classification + criticism, review/import/audit, indexes
  + full-text prep, and Row-Level Security.
- `supabase/seed/0001_taxonomy.sql` (reference) + `0002_demo_fixtures.sql`
  (clearly-labeled demo data covering the ten fixture scenarios).
- `packages/database/` — typed schema mirror (`src/types.ts`), the migration
  runner, the PGlite + Supabase-auth-shim test harness (`src/testing/`),
  identifier canonicalization, read-only data-access helpers, and the schema +
  RLS test suites.
- `docs/adr/ADR-012-pglite-database-testing.md` records the testing boundary
  (PGlite for CI, Supabase for production).

## Manual Research MVP (Milestone 3)

- `apps/web` hybrid rendering (ADR-013, `@astrojs/node`): SSR `/research/[id]`,
  `/admin/*`, `/api/*`; `/`, `/methodology` stay prerendered.
- Auth/session (`@supabase/ssr`) + `src/middleware.ts` (fail-closed admin gate,
  staff-role resolution) + `src/server/db.ts` (RLS-preserving request executor).
- `packages/metadata` — `MetadataProvider` with `CrossrefMetadataProvider` +
  `MockMetadataProvider`, sanitization, fixtures, tests.
- `packages/database` service layer (createDraft…approveAndPublish, fail-closed)
  + editor/public read models + workflow tests.
- Admin UI (sign-in, dashboard, add-research, editor) + API routes; public
  `/research/[id]`. `ADR-013`, docs 05/12/16/19 updated.
- Real Supabase integration is a documented **pending gate** (`docs/19` §11).

## Next

Milestone 4 — Public Research Explorer (search, filters, sorting, research cards,
conditions/interventions). Previously-planned Milestone 2 database work below is
now delivered:

Milestone 2 — Database Foundation (Supabase migrations for the `docs/05`
entities, indexes, RLS, seed + fixtures, database/data-access tests). See
`docs/22-ROADMAP.md`.
