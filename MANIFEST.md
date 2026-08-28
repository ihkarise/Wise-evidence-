# WiseEvidence Architecture Manifest

**Status:** Milestone 0 (Architecture Completion) and Milestone 1 (Repository
Foundation) complete.
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

Architecture Decision Records (`docs/adr/`):

- `README.md` (index + template)
- `ADR-001-modular-monolith.md` … `ADR-011-licensing.md`
- `ADR-012-multi-source-ingestion.md` (Milestone 8 design)

Milestone 0 reports (`docs/reports/`):

- `ARCHITECTURE-CROSSCHECK.md` — contradiction/consistency report
- `MVP-SCOPE.md` — finalized MVP scope
- `TECH-STACK-DECISION.md` — confirmed technology stack

## Application foundation (Milestone 1)

- `apps/web/` — Astro app (static-first) with React island + Tailwind; landing
  and methodology pages; Supabase connection strategy (no schema).
- `packages/domain/` — portable domain logic; `normalizeDoi()` + Vitest suite.
- `supabase/README.md` — migrations-first strategy; schema deferred to M2.
- Root tooling — pnpm workspace, strict TypeScript, ESLint, Prettier, Vitest.
- `.github/workflows/ci.yml` — CI (lint · typecheck · test · build; no secrets).
- Governance — `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, PR + issue templates.

## Next

Milestone 2 — Database Foundation (migrations, core entities, RLS, seed data,
database tests). See `docs/22-ROADMAP.md`.
