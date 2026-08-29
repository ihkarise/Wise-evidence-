# Architecture Decision Records

This directory records significant architecture decisions for WiseEvidence. One
ADR per significant decision. Trivial implementation choices do **not** get an
ADR (master prompt §38).

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](ADR-001-modular-monolith.md) | Modular Monolith | Accepted |
| [ADR-002](ADR-002-postgresql-first.md) | PostgreSQL First | Accepted |
| [ADR-003](ADR-003-supabase-direction.md) | Supabase Direction | Accepted |
| [ADR-004](ADR-004-static-first-public-web.md) | Static-First Public Web | Accepted |
| [ADR-005](ADR-005-ai-provider-abstraction.md) | AI Provider Abstraction | Accepted |
| [ADR-006](ADR-006-human-review-requirement.md) | Human Review Requirement | Accepted |
| [ADR-007](ADR-007-manual-import-before-scraping.md) | Manual Import Before Automated Scraping | Accepted |
| [ADR-008](ADR-008-github-canonical-repository.md) | GitHub as Canonical Repository | Accepted |
| [ADR-009](ADR-009-postgresql-search-first.md) | PostgreSQL Search First | Accepted |
| [ADR-010](ADR-010-cost-first-infrastructure.md) | Cost-First Infrastructure | Accepted |
| [ADR-011](ADR-011-licensing.md) | Licensing: Apache-2.0 (code) + CC-BY-4.0 (data) | Accepted |
| [ADR-012](ADR-012-multi-source-ingestion.md) | Multi-Source Ingestion: Source Registry, Idempotent Checkpointing, Deferred Scheduler | Accepted (design) |
| [ADR-013](ADR-013-database-foundation-schema-and-testing.md) | Database Foundation: Enum/Table Taxonomy Split and PGlite Deterministic Testing | Accepted |
| [ADR-014](ADR-014-manual-research-mvp-ssr-auth-metadata.md) | Manual Research MVP: Hybrid SSR, Supabase-SSR Auth, Reviewer RLS, and a Metadata Provider Package | Accepted |
| [ADR-015](ADR-015-public-research-explorer.md) | Public Research Explorer: PostgreSQL Query Layer, Published-Only via RLS, Canonical-URL SEO | Accepted |
| [ADR-016](ADR-016-evidence-visualization-methodology.md) | Evidence Visualization: Pyramid as Navigation-not-Truth, Study-Based Counting, Valence-Neutral Encoding, No Combined Score | Accepted |
| [ADR-017](ADR-017-ai-enrichment.md) | AI Enrichment: Suggestion-Only Pipeline, Provider Independence, and the Canonical/Publication/M5 Firewalls | Accepted (design) |

## Template

```markdown
# ADR-NNN: <Title>

**Status:** Proposed | Accepted | Superseded by ADR-XXX
**Date:** YYYY-MM-DD
**Related:** <docs / ADRs>

## Context
What forces are at play; why a decision is needed.

## Decision
The decision, stated plainly.

## Consequences
Positive and negative outcomes; what this commits us to; what it rules out.
```

ADRs 001–011 are dated `2026-08-21` (Milestone 0, architecture completion) and
derive from the drafted architecture (`docs/00`–`04`) and
`CLAUDE-CODE-MASTER-PROMPT.md`. ADR-012 (`2026-08-28`) records the Milestone 8
multi-source ingestion design (`docs/24-MULTI-SOURCE-INGESTION.md`) and is design-
only: its implementation is blocked on Phases 1–7, which do not yet exist.
ADR-013 records the Milestone 2 database foundation. ADR-014 records the
Milestone 3 Manual Research MVP (`docs/26-MANUAL-RESEARCH-MVP.md`) — implemented,
with live Supabase verification marked PENDING until a real project is supplied.
ADR-015 (`2026-08-29`) records the Milestone 4 Public Research Explorer
(`docs/27-PUBLIC-RESEARCH-EXPLORER.md`) — implemented: a PostgreSQL-only,
published-only search/browse query layer with canonical-URL SEO; live Supabase
verification likewise PENDING. ADR-016 (`2026-08-29`) records the Milestone 5
Evidence Visualization methodology (`docs/28-EVIDENCE-VISUALIZATION-METHODOLOGY.md`)
— the pyramid as a navigation-not-truth device, `ResearchStudy` as the counting
unit, valence-neutral encoding, explicit UNCLASSIFIED handling, and no combined
score of any kind — and is now **implemented** (`packages/database/stats.ts`, the
`/evidence` and `/statistics` pages, and a reusable `DistributionChart`); live
Supabase verification likewise PENDING. ADR-017 (`2026-08-29`) records the
Milestone 6 AI-enrichment design (`docs/29-AI-ENRICHMENT.md`) — a suggestion-only
pipeline (AI never becomes canonical, never publishes, never enters M5),
provider-independent `packages/ai` with an offline mock default and an
OpenAI-compatible real provider, the six documented tasks with versioned prompts,
untrusted-in/untrusted-out validation, and the canonical/publication/M5 firewalls
— and is **design-only** (like ADR-012): implementation, including a minimal
additive migration `0011`, is authorized separately. M6.1 and M7 are NOT STARTED.
