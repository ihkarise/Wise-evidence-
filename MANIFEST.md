# WiseEvidence Architecture Manifest

**Status:** Milestone 0 (Architecture Completion), Milestone 1 (Repository
Foundation), and Milestone 2 (Database Foundation) complete.
**Updated:** 2026-08-28

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
- `24-MULTI-SOURCE-INGESTION.md` — Milestone 8 Design Checkpoint (design-only;
  implementation blocked on Phases 1–7)
- `25-DATABASE-FOUNDATION.md` — Milestone 2 Database Foundation design checkpoint
  (implemented: schema, enums, RLS, seed, tests)
- `26-MANUAL-RESEARCH-MVP.md` — Milestone 3 Manual Research MVP design checkpoint
  (implemented: auth, metadata provider, workflow, editor, public detail; live
  Supabase verification PENDING)

Architecture Decision Records (`docs/adr/`):

- `README.md` (index + template)
- `ADR-001-modular-monolith.md` … `ADR-011-licensing.md`
- `ADR-012-multi-source-ingestion.md` (Milestone 8 design)
- `ADR-013-database-foundation-schema-and-testing.md` (Milestone 2)
- `ADR-014-manual-research-mvp-ssr-auth-metadata.md` (Milestone 3)

Milestone 0 reports (`docs/reports/`):

- `ARCHITECTURE-CROSSCHECK.md` — contradiction/consistency report
- `MVP-SCOPE.md` — finalized MVP scope
- `TECH-STACK-DECISION.md` — confirmed technology stack

## Application foundation (Milestone 1)

- `apps/web/` — Astro app (static-first) with React island + Tailwind; landing
  and methodology pages; Supabase connection strategy (no schema).
- `packages/domain/` — portable domain logic; `normalizeDoi()` + Vitest suite.
- Root tooling — pnpm workspace, strict TypeScript, ESLint, Prettier, Vitest.
- `.github/workflows/ci.yml` — CI (lint · typecheck · test · build; no secrets).
- Governance — `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, PR + issue templates.

## Database foundation (Milestone 2)

- `supabase/migrations/` — ordered SQL (`0001`–`0009`): schema, enums, indexes,
  RLS, and canonical `taxonomy-v1` reference data.
- `supabase/seed/demo_fixtures.sql` — clearly-labelled DEMO fixtures
  (`is_demo`, `[DEMO]` titles, reserved `10.0000/` DOIs) — never real research.
- `packages/database/` — framework-independent data-access boundary (enum
  vocabularies, migration/seed loaders, PGlite test harness + Supabase shim);
  reuses `@wise-evidence/domain` for DOI normalization.
- Deterministic database tests (migrations, constraints, RLS, fixtures) run
  offline via PGlite. Real-Supabase verification PENDING.

## Manual Research MVP (Milestone 3)

- `supabase/migrations/0010_m3_reviewer_write_rls.sql` — reviewer/admin write
  RLS, the fail-closed publication guard (admin/service + non-demo +
  PENDING_REVIEW → PUBLISHED), and the `human_summary` column.
- `packages/metadata/` — provider-independent metadata lookup: `MetadataProvider`
  interface, host-pinned/bounded/sanitized `CrossrefMetadataProvider`, and a
  deterministic `MockMetadataProvider`. Reuses `@wise-evidence/domain`.
- `packages/database/src/service/` + `executor.ts` — the workflow service layer
  on the `SqlExecutor` boundary (draft creation + dedup, editor updates,
  independent classifications, criticism, transitions, fail-closed publish,
  audit) with reads for the editor, admin queue, and anon public detail.
- `apps/web/` — hybrid SSR (`@astrojs/node`): Supabase-SSR auth, middleware
  route protection, admin editor/review/publish UI, API routes, and the public
  `/research/[id]` detail page (anon RLS path).
- Deterministic workflow, security, and metadata tests (114 total). Live
  Supabase (browser/auth/DB) verification PENDING a provisioned project.

## Next

Milestone 4 — Public Research Explorer (search, filters, sorting, evidence
browsing). See `docs/22-ROADMAP.md`. Not started.
