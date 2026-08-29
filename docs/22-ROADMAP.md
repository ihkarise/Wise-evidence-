# WiseEvidence
## Roadmap

**Document:** `docs/22-ROADMAP.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `02-PRODUCT-REQUIREMENTS.md`, `docs/reports/MVP-SCOPE.md`

---

# 1. Purpose

Define the staged milestone sequence. Build in order; do not silently jump ahead
(master prompt §34, §77). Each milestone ends with a checkpoint report (§13).

# 2. Phase 0 — Architecture Completion  ✅ complete

Complete architecture specs `05`–`23`, ADRs, cross-check/contradiction report,
final MVP scope, tech-stack decision. **No major features.** (master prompt §78.)

# 3. Phase 1 — Repository Foundation  ✅ complete

Astro app, base styling, folder structure (`apps/web`, `packages/*`), environment
config, Supabase connection strategy, CI, test runner, lint, type checking,
`README`/`CONTRIBUTING`/`SECURITY`/`LICENSE`. No unnecessary features
(master prompt §79, §28).

**Delivered:** pnpm workspace + strict TypeScript; `packages/domain` with
`normalizeDoi()` and its Vitest suite; `apps/web` (Astro static-first + React
island `CopyDoi` + Tailwind) with landing and methodology pages; Supabase
connection strategy (`apps/web/src/lib/supabase.ts`) with **no schema yet**;
ESLint/Prettier/Vitest; `.env.example`; GitHub Actions CI (lint · typecheck ·
test · build, no secrets/AI/network); governance files (`LICENSE` Apache-2.0,
`CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, PR + issue templates);
`supabase/README.md`. Database schema is deferred to Phase 2.

# 4. Phase 2 — Database Foundation  ✅ complete

Migrations, core entities & relationships, indexes, RLS, seed data, database
tests (master prompt §80, `05`, `20`).

**Delivered:** ordered version-controlled migrations (`supabase/migrations/
0001`–`0009`) for the canonical schema — Study/Publication separation, authors,
journals, sources, identifiers (with the dedup unique constraint), conditions,
interventions, tags, the independent classification dimensions, per-dimension
quality, criticism, users/roles, review, correction, append-only audit, and the
import + AI tables (schema only, no AI/scraping logic). Enum vocabularies,
lifecycle/publication states, indexes, and FTS preparation (`tsvector` + GIN).
Row-Level Security as the authoritative boundary (anon → published only; private
tables reviewer/admin; mutation via `service_role`). Canonical `taxonomy-v1`
reference seed; clearly-labelled DEMO fixtures (`supabase/seed/`).
Framework-independent `packages/database` reusing `@wise-evidence/domain`.
Deterministic PGlite database tests. Full design checkpoint in
`docs/25-DATABASE-FOUNDATION.md`; decisions in `ADR-013`. Real-Supabase
verification is PENDING a provisioned project.

# 5. Phase 3 — Manual Research MVP  ✅ complete

Admin authentication, research creation, DOI input, metadata retrieval, research
editor, classification fields, review queue, publish workflow, public detail
page, audit trail (master prompt §81, `11` §2, `12`).

**Delivered:** hybrid Astro SSR (`@astrojs/node`; public pages still
prerendered) with Supabase-SSR cookie-session authentication, middleware route
protection, and server-side role resolution (`auth.uid()` → `app_user` → role,
never a client claim). Migration `0010` adds the minimum reviewer/admin write
RLS plus a fail-closed publication guard (admin-or-service only, non-demo,
PENDING_REVIEW → PUBLISHED) and a `human_summary` column. New
`packages/metadata`: a provider-independent `MetadataProvider` with a
host-pinned, timeout/size-bounded, redirect-blocked, output-sanitized
`CrossrefMetadataProvider` and a deterministic `MockMetadataProvider`. A
framework-independent service/data-access layer in `packages/database`
(SqlExecutor boundary shared by tests and the server): DOI-dedup draft creation,
editor updates, independent outcome/quality/confidence classifications,
criticism, taxonomy links, submit/reject/request-changes/archive, and
`approveAndPublish()` (fail-closed, demo-protected, ADMIN-only) with append-only
audit. Admin dashboard, listing, review queue, add-research, and a structured
editor (no raw rows); the public `/research/[id]` detail page rendered on the
anon RLS path with outcome, quality, confidence, and criticism kept visually
and semantically separate and an explicit "structured interpretations, not proof
of efficacy" note. No AI, no scraping, no search, no evidence visualization, no
efficacy/combined score. Deterministic workflow + security + metadata tests
(114 total). Design checkpoint `docs/26-MANUAL-RESEARCH-MVP.md`; decisions in
`ADR-014`. Real-Supabase (live browser/auth/DB) verification is PENDING a
provisioned project (`docs/26` §25).

# 6. Phase 4 — Public Research Explorer  ✅ complete

Homepage, search, research list, filters, sorting, research detail, DOI copy,
source links, conditions, interventions, research cards (master prompt §82, `14`,
`15`).

**Delivered:** a public `/research` explorer built strictly on the M2/M3
architecture. A new PostgreSQL-only query layer in `packages/database`
(`service/search.ts`, on the shared `SqlExecutor` boundary): `parseSearchParams()`
(untrusted-input validation/clamping), `searchPublishedResearch()` (published-only
via RLS **and** an explicit `publication_state='PUBLISHED'` predicate), and
`getFilterOptions()` (filters sourced from canonical reference data, not hardcoded).
PostgreSQL FTS (`websearch_to_tsquery`/`ts_rank` over the stored
`publication.search_vector`) plus parameterized author/journal/condition/
intervention metadata matching; exact canonical-DOI priority reusing
`@wise-evidence/domain`. Neutral sorts only (relevance/newest/oldest/title) — no
efficacy/popularity/vote ranking, no combined score. Server-side clamped
pagination; one card per study (`is_primary` join, so multi-publication studies
never duplicate). Cards keep outcome/quality/evidence-level/study-type as separate
labelled dimensions. Accessible, JS-free GET form (fieldset/legend/labels,
`aria-live` results, accessible pagination); canonical-URL SEO (`noindex` on
parameterized views) so filter permutations are not thin duplicate pages;
empty/error/pending states. All input is bound parameters; SQL-injection-style
tests included. No new migration/index required. The M3 `/research/[id]` detail
page is reused unchanged. Design checkpoint `docs/27-PUBLIC-RESEARCH-EXPLORER.md`;
decisions in `ADR-015`. No AI, embeddings, vector DB, scraping, or visualization.
Real-Supabase (live browser/DB) verification is PENDING a provisioned project.

# 7. Phase 5 — Evidence Visualization

Evidence pyramid, outcome distribution, quality display, criticism display,
explore pages (master prompt §83, `15` §5). Honesty rules apply (`15` §6).

# 8. Phase 6 — AI Enrichment

AI abstraction, provider config, cheap-model strategy, prompt system + versioning,
cache, summaries, classification suggestions, human approval, AI provenance
(master prompt §84, `10`).

# 9. Phase 7 — Automated Discovery

First structured source connector: discovery, fetch, normalize, deduplicate,
review-queue integration, scheduled job. Not all sources at once (master prompt
§85, `11` §11).

# 10. Phase 8 — Additional Sources

Add connectors incrementally, each with tests, fixtures, normalization, and
provenance (master prompt §86).

**Design checkpoint:** `docs/24-MULTI-SOURCE-INGESTION.md` (+ `ADR-012`) is the
approved M8 design — source registry, incremental/idempotent checkpointing,
conservative cross-source dedup, source health, admin controls, RLS, cost/security
posture, and the deferred-scheduler boundary. It is **design-only**:
implementation is blocked on Phases 1–7 (repo foundation, database, manual MVP,
first connector), which do not yet exist. Build in order; do not jump ahead.

# 11. Phase 9 — Community

Submit research, report error, suggest correction, classification disagreement,
bookmarks — only after the research core is stable (master prompt §87, `13`).

# 12. Phase 10 — Advanced Intelligence

Semantic search, citation graph, research relationships, AI research assistant,
trend analysis, evidence maps, multilingual, comparison. Not in MVP; each needs
an ADR + cost justification (master prompt §88, `02` §12 P3).

# 13. Milestone Checkpoints

At the end of each milestone, stop and report (master prompt §36, §77):
**Completed · Files · Tests · Database changes · Architecture decisions · Known
issues · Cost impact · Security considerations · Next.**

# 14. Priority Mapping

MVP priority tiers (P0–P3) are in `02` §12; the finalized MVP scope is in
`docs/reports/MVP-SCOPE.md`.
