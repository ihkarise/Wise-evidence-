# WiseEvidence Architecture Manifest

**Status:** Milestones 0 (Architecture Completion), 1 (Repository Foundation),
2 (Database Foundation), 3 (Manual Research MVP), and 4 (Public Research
Explorer) complete.
**Updated:** 2026-08-29

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
- `27-PUBLIC-RESEARCH-EXPLORER.md` — Milestone 4 Public Research Explorer design
  checkpoint (implemented: PostgreSQL search/filter/sort/paginate query layer,
  research cards, canonical-URL SEO; published-only via RLS; live Supabase
  verification PENDING)
- `28-EVIDENCE-VISUALIZATION-METHODOLOGY.md` — Milestone 5 Evidence Visualization
  design checkpoint (implemented): pyramid as a navigation-not-truth device,
  ResearchStudy-based counting (`stats.ts`), valence-neutral encoding, explicit
  UNCLASSIFIED handling, separate outcome/quality/criticism distributions on the
  anon RLS path, `/evidence` + `/statistics` pages, and no combined score; live
  Supabase verification PENDING
- `29-AI-ENRICHMENT.md` — Milestone 6 AI Enrichment design + as-built record
  (**implemented**): suggestion-only pipeline (AI never becomes canonical, never
  publishes, never enters M5), provider-independent `packages/ai` with an offline
  mock default and an OpenAI-compatible real provider, the six documented tasks with
  versioned prompts, untrusted-in/untrusted-out validation, cache identity, and the
  canonical/publication/M5 firewalls; verification in
  `docs/reports/M6-IMPLEMENTATION-VERIFICATION.md`
- `30-AUTOMATED-DISCOVERY-METHODOLOGY.md` — Automated Research Discovery
  methodology + Milestone 7.1 as-built record (**M7.1 implemented; M7.2+
  design-pending / not authorized**): the LOCKED credibility boundaries
  (discovery ≠ publication, fetch ≠ acceptance, candidate ≠ research record,
  AI ≠ authority, duplicate ≠ delete, relevance ≠ efficacy), the provider-neutral
  `packages/discovery` contract surface (`DiscoveryProvider`, `SourceDescriptor`,
  typed objects, typed redacted errors, registry seam, host/URL egress gate,
  provenance), the deterministic offline `MockDiscoveryProvider`, no-migration
  database posture, and cost/security/testing posture; checkpoint in
  `docs/reports/M7.1-CHECKPOINT.md`

Architecture Decision Records (`docs/adr/`):

- `README.md` (index + template)
- `ADR-001-modular-monolith.md` … `ADR-011-licensing.md`
- `ADR-012-multi-source-ingestion.md` (Milestone 8 design)
- `ADR-013-database-foundation-schema-and-testing.md` (Milestone 2)
- `ADR-014-manual-research-mvp-ssr-auth-metadata.md` (Milestone 3)
- `ADR-015-public-research-explorer.md` (Milestone 4)
- `ADR-016-evidence-visualization-methodology.md` (Milestone 5 design)
- `ADR-017-ai-enrichment.md` (Milestone 6 design)
- `ADR-018-grant-hardening-and-pages-base-path.md` (Production Readiness — `anon`
  grant hardening + env-driven GitHub Pages base path)
- `ADR-019-provider-agnostic-ai-architecture.md` (pre-M7 hardening — provider
  registry, provider/model config, capability negotiation, secret references)
- `ADR-020-automated-research-discovery.md` (Milestone 7.1 — provider-neutral
  discovery contract, typed objects/errors, registry seam, deterministic mock;
  no connector, no scheduler, no AI, no migration)

Reports (`docs/reports/`):

- `ARCHITECTURE-CROSSCHECK.md` — contradiction/consistency report (Milestone 0)
- `MVP-SCOPE.md` — finalized MVP scope (Milestone 0)
- `TECH-STACK-DECISION.md` — confirmed technology stack (Milestone 0)
- `M6-IMPLEMENTATION-VERIFICATION.md` — Milestone 6 verification results
  (test/typecheck/lint/format/build/secret-scan; firewalls; live-verification
  PENDING)
- `M6.1-OPERATIONAL-VERIFICATION.md` — Milestone 6.1 operational verification +
  OpenRouter benchmark readiness (harness built & verified offline; catalogue/
  pricing/token/latency/cost live gate BLOCKED — egress denied + no key; the exact
  rerun command; nothing fabricated)
- `PRODUCTION-CONNECTION-VERIFICATION.md` — Production Readiness verification
- `PRODUCTION-READINESS-6.2.md` — Milestone 6.2 production-readiness gate
  (offline gates VERIFIED + standalone server starts; Render Blueprint added;
  live Supabase/Render PENDING, OpenRouter BLOCKED; decision: READY WITH
  DOCUMENTED BLOCKERS; M7 not started)
  matrix with honest provenance tiers (LOCAL / PGLITE / REAL SUPABASE reported /
  LIVE BROWSER / PENDING / BLOCKED); Pages base-path fix verified locally; live
  Pages/SSR/OpenRouter BLOCKED or PENDING (egress-sandboxed)

## Application foundation (Milestone 1)

- `apps/web/` — Astro app (static-first) with React island + Tailwind; landing
  and methodology pages; Supabase connection strategy (no schema).
- `packages/domain/` — portable domain logic; `normalizeDoi()` + Vitest suite.
- Root tooling — pnpm workspace, strict TypeScript, ESLint, Prettier, Vitest.
- `.github/workflows/ci.yml` — CI (lint · typecheck · test · build; no secrets).
- `.github/workflows/preview.yml` — STATIC VISUAL PREVIEW ONLY: publishes the
  prerendered public pages (`/`, `/methodology`) to GitHub Pages, keyless; SSR routes
  are not served there (hybrid SSR stays intact). See `docs/19-DEPLOYMENT.md` §11–§12.
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
- `packages/database/src/service/search.ts` (Milestone 4) — the public,
  PostgreSQL-only explorer query layer: `parseSearchParams()`,
  `searchPublishedResearch()`, `getFilterOptions()`. Published-only via RLS +
  explicit predicate; FTS + DOI-priority; neutral sorts; clamped pagination;
  bound parameters only.
- `apps/web/src/pages/research/index.astro` + `components/ResearchCard.astro`
  (Milestone 4) — the SSR `/research` explorer (anon path) and research card.
- `packages/database/src/stats.ts` + `apps/web/src/pages/evidence` +
  `statistics` + `components/DistributionChart.astro` (Milestone 5) — the public,
  PostgreSQL-only, published-only evidence-visualization layer (distinct-study
  counts; pyramid as navigation-not-truth; separate outcome/quality/criticism
  distributions; no combined score).

## AI Enrichment (Milestone 6)

- `packages/ai/` — the provider-independent AI subsystem: the `AIProvider`
  boundary, a deterministic offline `MockAIProvider` (dev/CI default), an
  `OpenAICompatibleProvider` (injected `fetch`, unit-tested with fake responses),
  a versioned prompt registry loader with content-hash pinning, the six task
  output validators, SHA-256 input hashing (cache identity), cost derivation
  (real-usage-and-pricing-or-NULL), and the pure `runTask` orchestrator. No Astro,
  React, Supabase, or provider-SDK imports; no network in CI.
- `prompts/<task>/v1.md` + `prompts/registry.json` — the six versioned prompts
  (research-summary, outcome-classification, evidence-quality, criticism-extraction,
  metadata-extraction, duplicate-detection) with injection-resistant, structured-
  output instructions, pinned by content hash.
- `supabase/migrations/0011_ai_enrichment.sql` — additive, nullable token
  usage/timings/diagnostics on `ai_job` and validation diagnostics on `ai_result`
  (no new tables, no RLS change; AI writes stay on the service_role path).
- `supabase/migrations/0012_grant_hardening.sql` — Production Readiness: least-
  privilege `anon` grant hardening (defence in depth beneath RLS), resilient to
  Supabase default privileges (ADR-018). Prepared + PGlite-tested; **not** applied
  to production without explicit owner approval.
- `packages/database/src/service/ai.ts` — AI job/result persistence, the cache
  identity resolver, minimised task input, suggestion listing, and the append-only
  human Accept/Edit/Reject decision; `ai_result_id` provenance threaded through the
  existing canonical ops.
- `apps/web/src/lib/ai.ts` (server-only coordinator) + the staff-only enrichment
  op and Accept/Edit/Reject ops in `pages/api/admin/research/[id].ts` + the editor
  AI panel in `pages/admin/research/[id].astro` — suggestions shown as clearly
  non-canonical.

## Automated discovery foundation (Milestone 7.1)

- `packages/discovery/` — the provider-neutral automated-discovery foundation.
  Framework-independent (no Astro/React/Supabase/web/AI imports; depends only on
  `@wise-evidence/domain`): the `DiscoveryProvider` contract (discover / fetch /
  normalize), `SourceDescriptor` (secret-free identity/capability/limit/host
  policy), typed discovery objects (`DiscoveryRequest`, `DiscoveryPage`,
  `SourceItem`, `FetchResult`, `NormalizedSourceItem`, `Provenance`), a typed
  redacted error model (`DiscoveryError` + closed code set), the host/URL egress
  gate (`assertUrlAllowed`, no generic URL fetch), a pure normalizer, a registry
  seam (MOCK registered; CROSSREF/PUBMED/EUROPE_PMC fail closed as
  `NOT_CONFIGURED`), and a deterministic offline `MockDiscoveryProvider` +
  fixtures. Writes nothing canonical, classifies nothing, accepts nothing; **no
  network, no Crossref, no scheduler, no AI, no migration.** Boundary tests prove
  the AI/database/web/fetch/secret separations. See `docs/30`, `ADR-020`,
  `docs/reports/M7.1-CHECKPOINT.md`.

## AI benchmark harness (Milestone 6.1)

- `packages/benchmark/` — the M6.1 operational benchmark harness. It _drives the
  existing_ `@wise-evidence/ai` provider + orchestrator (no new provider, no
  parallel AI path) to compare candidate OpenRouter models on the DEMO study with
  MODEL as the only variable: FULL (six tasks) / ESSENTIAL (four tasks) workloads,
  per-task token/latency/retry/validity/cost capture with honest NULLs, live
  catalogue + pricing verification (injected fetch, never substitutes a model or
  guesses a price), and cache-identity isolation. Every module is verified offline
  with the mock provider and a fake fetch; the live OpenRouter run
  (`src/benchmark.live.test.ts`) is `describe.runIf`-gated on a server-side key and
  stays skipped in CI. Live gate currently BLOCKED — see
  `docs/reports/M6.1-OPERATIONAL-VERIFICATION.md`.
- Deterministic workflow/security/metadata/search/stats/AI tests (246 total). Live
  provider + live Supabase verification PENDING a provisioned project.

## Next

Milestone 6.1 — a one-off OpenRouter model benchmark, run later ONLY in a secure
server-side environment (not part of M6, not run in CI). Then Milestone 7 —
Automated Research Discovery (first structured source connector). See
`docs/22-ROADMAP.md`. Both NOT STARTED.
