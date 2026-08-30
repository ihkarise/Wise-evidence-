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

# 7. Phase 5 — Evidence Visualization  ✅ complete

Evidence pyramid, outcome distribution, quality display, criticism display,
explore pages (master prompt §83, `15` §5). Honesty rules apply (`15` §6).

**Delivered:** a public evidence-visualization layer built strictly on the M2–M4
architecture. A new PostgreSQL-only aggregation layer in `packages/database`
(`stats.ts`, on the shared `SqlExecutor` boundary): `getCatalogueOverview()`,
`getEvidencePyramid()`, `getOutcomeDistribution()`, `getQualityDistribution()`,
and `getCriticismDistribution()` — all PUBLISHED-only (anon RLS authoritative
**plus** an explicit `publication_state='PUBLISHED'` predicate) and all counting
distinct **studies** (`count(distinct research_study.id)`), so a multi-publication
study counts once and publications never inflate a study count. The evidence
pyramid is a **navigation/organization** device ordered by the versioned
`pyramid_rank`; band position encodes nothing about outcome, quality, criticism,
truth, or efficacy, and studies with no study type fall into an explicit
UNCLASSIFIED band (never discarded). Outcome, quality, and criticism are three
**separate** distributions — the full seven-category outcome spectrum (zero-filled)
with an explicit UNCLASSIFIED bucket (missing is never mapped to Neutral), an
independent quality distribution, and criticism counted by distinct study on two
axes (category, origin) and never converted into a negative outcome. There is
**no** cross-tab and **no** efficacy/evidence/balance/positive-minus-negative/
weighted/combined score anywhere (a structural test guards this). New public pages
`/evidence` and `/statistics` (SSR on the anon path), a reusable, valence-neutral,
table-based `DistributionChart` (every value is text; neutral single-hue bars; no
green/red; accessible by construction) and a shared `StatDisclaimer`; each band
links into the existing M4 `/research?evidenceLevel=CODE` filter (no second
filtering system). Deterministic PGlite tests (21 new, 176 total). Design
checkpoint `docs/28-EVIDENCE-VISUALIZATION-METHODOLOGY.md`; decisions in
`ADR-016`. No AI, embeddings, vector DB, scraping, voting, or cross-tab. Real-
Supabase (live browser/DB) verification is PENDING a provisioned project.

# 8. Phase 6 — AI Enrichment  ✅ complete

AI abstraction, provider config, cheap-model strategy, prompt system + versioning,
cache, summaries, classification suggestions, human approval, AI provenance
(master prompt §84, `10`).

**Delivered:** a suggestion-only AI enrichment pipeline built strictly on the
M2–M5 architecture. A new provider-independent `packages/ai` — the `AIProvider`
boundary, a deterministic offline `MockAIProvider` (the dev/CI default, no key, no
network), an `OpenAICompatibleProvider` (injected `fetch`, unit-tested with fake
responses, OpenRouter-agnostic), a versioned prompt registry
(`prompts/<task>/v1.md` + `prompts/registry.json` content-hash pinning), the six
documented tasks with structured-output validation, SHA-256 input hashing, cost
derivation (real usage + operator pricing, else NULL), and a pure `runTask`
orchestrator with bounded retries. Migration `0011` (additive, nullable) records
token usage/timings/diagnostics on `ai_job` and validation diagnostics on
`ai_result`. `packages/database` `service/ai.ts` persists AI jobs and immutable
results, resolves the M2 cache identity
(`study + operation + input_hash + model + prompt_version`), builds minimised task
input, lists suggestions, and records the append-only human Accept/Edit/Reject
decision; `ai_result_id` provenance is threaded through the existing canonical ops
(`setOutcome`/`setQualitySummary`/`addCriticism`). A staff-only enrichment endpoint
and an editor AI panel present suggestions as clearly non-canonical, with
Accept/Edit/Reject. All AI config is server-only (no `PUBLIC_AI_*`, no key in the
browser bundle). The canonical/publication/**M5** firewalls are enforced and
test-covered: AI never writes canonical data, never publishes, never changes state,
and never enters the M5 statistics. 70 new deterministic offline tests (246 total).
Design + as-built record in `docs/29-AI-ENRICHMENT.md`; decisions in `ADR-017`;
verification in `docs/reports/M6-IMPLEMENTATION-VERIFICATION.md`. No scraping, no
discovery, no vector DB, no efficacy/combined score. **M6.1** (the OpenRouter model
benchmark) is **PARTIALLY COMPLETE (live BLOCKED)**: the reproducible benchmark
harness (`packages/benchmark`) is built and verified offline, driving the existing
provider + orchestrator, but the live run is BLOCKED (OpenRouter egress denied by
policy + no server-side key), so no live model/token/cost/ranking value exists yet —
see `docs/reports/M6.1-OPERATIONAL-VERIFICATION.md`. Live provider + live Supabase
verification are PENDING.

**Provider-agnostic hardening (pre-M7, ADR-019).** A hardening pass made the AI
subsystem provider-agnostic so the operator can switch AI providers/models by
configuration only: an `AIProviderRegistry`, separate provider/model configuration,
thin presets (openrouter · ollama · lmstudio · vllm · openai-compatible · mock),
capability negotiation, base-URL SSRF policy, and secret-by-reference handling. The
Mock provider stays the CI/default; all M6 safety guarantees are unchanged; no
migration was added. See `docs/29` §27 and `ADR-019`. This is architecture only —
**M7 remains NOT STARTED and unauthorized.**

**M6.2 — Production Readiness (2026-08-29).** A verification/deployment-prep pass:
all offline gates re-run and recorded (331 tests + 1 skipped; typecheck/lint/
format/build; secret scan — clean), and the compiled Astro Node **standalone
server verified to start** (public pages 200, `/admin` fail-closes to sign-in).
Added the previously-missing **`render.yaml`** Blueprint for the *existing* Node
standalone server (Node 22, existing commands, secrets `sync:false` — no new SSR
architecture). Migrations remain exactly `0001`–`0012`. Live **Render**, live
**Supabase** (auth/RLS/workflow), the live **OpenRouter** benchmark, and the live
**Pages** URL stay PENDING/BLOCKED (egress-denied hosts; nothing faked). Decision:
**READY WITH DOCUMENTED BLOCKERS**; **M7 still NOT STARTED, unauthorized**. See
`docs/reports/PRODUCTION-READINESS-6.2.md`.

# 9. Phase 7 — Automated Discovery

First structured source connector: discovery, fetch, normalize, deduplicate,
review-queue integration, scheduled job. Not all sources at once (master prompt
§85, `11` §11).

**M7.1 — Discovery provider contract + deterministic mock  ✅ complete.**
The smallest provider-neutral foundation: the framework-independent
`packages/discovery` package with the `DiscoveryProvider` contract (discover /
fetch / normalize), `SourceDescriptor` (identity, capabilities, host allow-list,
HTTPS/rate/size/candidate limits — no secrets), the typed discovery objects
(`DiscoveryRequest`, `DiscoveryPage`, `SourceItem`, `FetchResult`,
`NormalizedSourceItem`, `Provenance`), a typed provider-neutral error model
(`DiscoveryError` with a closed code set + redaction), a source/provider registry
seam (MOCK registered; CROSSREF / PUBMED / EUROPE_PMC fail closed as
`NOT_CONFIGURED`), a pure normalizer reusing `@wise-evidence/domain`, and a
deterministic offline `MockDiscoveryProvider` with fixtures covering success,
pagination, empty, duplicate, malformed, missing/invalid DOI, and fetch
failure / timeout / rate-limit. **No real network call, no Crossref, no
scheduling, no scraping, no AI, no migration.** Every LOCKED boundary is
test-covered (discovery ≠ publication, fetch ≠ acceptance, candidate ≠ research
record, AI ≠ authority, duplicate ≠ delete): the package imports no AI /
database / web / vendor SDK, exposes no generic "fetch any URL" helper, and
writes nothing canonical. Design + as-built record in
`docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md` and `ADR-020`; checkpoint in
`docs/reports/M7.1-CHECKPOINT.md`. **M7.2 (Crossref adapter) is NOT started and
NOT authorized.**

**M7.2 — Crossref discovery connector  ✅ complete.** The first real
`DiscoveryProvider`: `CrossrefDiscoveryProvider`, isolated in
`packages/discovery/src/crossref/`, satisfying the M7.1 contract unchanged. It
talks only to the structured Crossref REST API over a shared, injected,
host-pinned (`api.crossref.org`), HTTPS-only, timeout/size-bounded,
redirect-rejecting, content-type-validated HTTP layer; sanitizes untrusted
metadata and canonicalises DOIs via `@wise-evidence/domain`; uses the canonical
DOI as the stable source id; maps transport/HTTP failures (timeout, 429, 4xx/5xx,
malformed, oversized, forbidden host) onto the typed discovery errors without
leaking secrets; and registers CROSSREF in the registry (requiring an injected
fetch, else `NOT_CONFIGURED`; MOCK unchanged; PUBMED/EUROPE_PMC still
`NOT_CONFIGURED`). **No scraping, no scheduling, no retries, no AI, no database
writes, no migration, no UI, no automatic classification or publication.** All
tests are offline via injected fake fetch; one opt-in live smoke test is gated on
`RUN_CROSSREF_LIVE=1` and skipped in CI (live call PENDING). See `docs/30` §9,
`ADR-020` (M7.2 amendment), and `docs/reports/M7.2-CROSSREF-CONNECTOR.md`.
**M7.3 (discovery orchestration + candidate persistence) is NOT started and NOT
authorized.**

Later M7 phases (PubMed/Europe PMC adapters, the discovery orchestrator +
candidate persistence, deduplication into the review queue, and scheduling)
remain design-pending and unauthorized — build in order.

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
