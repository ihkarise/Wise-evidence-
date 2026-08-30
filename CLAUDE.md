# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

---

## 1. What this repository currently is

**WiseEvidence** is an open, searchable, structured, AI-assisted and human-curated
**evidence platform for homeopathy research**. Its purpose is to make scattered
homeopathy research discoverable, understandable, comparable, and critically
reviewable — while keeping study outcome, evidence quality, criticism, confidence,
and provenance as _separate_ dimensions.

**Milestones 0 (Architecture), 1 (Repository Foundation), 2 (Database
Foundation), 3 (Manual Research MVP), 4 (Public Research Explorer), 5
(Evidence Visualization), and 6 (AI Enrichment) are complete.** The full architecture doc set exists, and so does
the project foundation: a pnpm workspace, an Astro web app with a React island, a
framework-independent `packages/domain` (with `normalizeDoi()`), CI, tooling, and
governance. Milestone 2 added the canonical database: ordered Supabase/PostgreSQL
migrations (`supabase/migrations/`), enums, indexes, FTS preparation,
Row-Level Security, `taxonomy-v1` reference seed, clearly-labelled DEMO fixtures
(`supabase/seed/`), the framework-independent `packages/database`, and
deterministic PGlite tests (see `docs/25-DATABASE-FOUNDATION.md`, `ADR-013`).
Milestone 3 added the first complete human-controlled research lifecycle:
hybrid Astro SSR with Supabase-SSR cookie auth and middleware route protection;
reviewer/admin write RLS + a fail-closed, demo-protected, ADMIN-only publication
guard (migration `0010`); a provider-independent, SSRF-hardened Crossref/mock
metadata package (`packages/metadata`); a tested service/data-access layer
(draft creation + DOI dedup, editor updates, independent classifications,
criticism, review transitions, `approveAndPublish()`, append-only audit); an
admin editor + review/publish UI; and the public `/research/[id]` detail page on
the anon RLS path (see `docs/26-MANUAL-RESEARCH-MVP.md`, `ADR-014`). Milestone 4
added the public **Research Explorer** (`/research`): a PostgreSQL-only,
published-only search/filter/sort/paginate query layer in `packages/database`
(`service/search.ts`), research cards, and canonical-URL SEO — reusing the M3
detail page unchanged, with no AI, embeddings, vector DB, popularity, votes, or
efficacy score, and every parameter bound (see
`docs/27-PUBLIC-RESEARCH-EXPLORER.md`, `ADR-015`). Milestone 5 added the public
**Evidence Visualization**: a PostgreSQL-only, published-only aggregation layer in
`packages/database` (`stats.ts`) that counts distinct **studies**
(`count(distinct research_study.id)`, so multi-publication studies count once) for
the evidence pyramid and the separate outcome/quality/criticism distributions; the
`/evidence` and `/statistics` pages; and a reusable, valence-neutral, accessible
`DistributionChart`. The pyramid is a navigation/organization device only (position
implies nothing about outcome, truth, or efficacy); missing data is explicit
UNCLASSIFIED (never mapped to Neutral); the three dimensions stay separate with **no
cross-tab and no efficacy/balance/combined score** of any kind (see
`docs/28-EVIDENCE-VISUALIZATION-METHODOLOGY.md`, `ADR-016`). Milestone 6 added the
**AI enrichment** subsystem: a provider-independent `packages/ai` (the `AIProvider`
boundary, an offline deterministic `MockAIProvider` default, an injected-fetch
`OpenAICompatibleProvider`, a versioned `prompts/` registry, the six task
validators, SHA-256 input hashing, cost derivation, and a pure orchestrator),
migration `0011` (additive usage/diagnostics), `packages/database` `service/ai.ts`
(jobs, cache, minimised input, append-only human decisions, `ai_result_id`
provenance through the existing canonical ops), a staff-only enrichment endpoint,
and an editor AI panel with Accept/Edit/Reject. **AI is a suggestion engine, never
an authority**: it never writes canonical data, never publishes, never changes
lifecycle/publication state, and never enters the M5 statistics — all firewalls are
test-covered, CI is offline and keyless (see `docs/29-AI-ENRICHMENT.md`, `ADR-017`).
A pre-M7 **provider-agnostic hardening** pass (ADR-019) then made the AI subsystem
switchable by configuration only — an `AIProviderRegistry`, separate provider/model
configuration, thin presets (openrouter · ollama · lmstudio · vllm ·
openai-compatible · mock), capability negotiation, base-URL SSRF policy, and
secret-by-reference (`secretRef`, server-only) handling — with the Mock provider
still the CI/default, every M6 safety guarantee unchanged, and **no migration**
(see `docs/29` §27, `ADR-019`). **Milestone 7.1** then added the
provider-neutral **discovery foundation** in `packages/discovery`: the
`DiscoveryProvider` contract (discover / fetch / normalize), a secret-free
`SourceDescriptor` with a host/URL egress gate, typed discovery objects, a typed
redacted `DiscoveryError` model, a registry seam (MOCK registered;
CROSSREF/PUBMED/EUROPE_PMC fail closed as `NOT_CONFIGURED`), a pure normalizer
reusing `@wise-evidence/domain`, and a deterministic offline
`MockDiscoveryProvider` with fixtures — **no real network, no Crossref, no
scheduler, no scraping, no AI, no migration**. Every LOCKED boundary is
test-covered (discovery ≠ publication, fetch ≠ acceptance, candidate ≠ research
record, AI ≠ authority, duplicate ≠ delete): discovery imports no AI/database/
web/vendor SDK, exposes no generic URL-fetch helper, and writes nothing canonical
(see `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`, `ADR-020`,
`docs/reports/M7.1-CHECKPOINT.md`). **Milestone 7.2** then added the first real
provider, `CrossrefDiscoveryProvider` (`packages/discovery/src/crossref/`), on a
shared injected HTTP layer: host-pinned to `api.crossref.org`, HTTPS-only,
timeout/size-bounded, redirects rejected, content-type-validated; untrusted
metadata sanitized and DOIs canonicalised via `@wise-evidence/domain`; the
canonical DOI as the stable source id; transport/HTTP failures mapped onto the
typed errors with no secret leakage; registered as CROSSREF (needs an injected
fetch, else `NOT_CONFIGURED`; PUBMED/EUROPE_PMC still `NOT_CONFIGURED`). It uses
**only the structured Crossref REST API — no scraping, no scheduling, no retries,
no AI, no database writes, no migration, no UI**. All connector tests run offline
via an injected fake fetch; one opt-in `RUN_CROSSREF_LIVE=1` smoke test is skipped
in CI and the **live Crossref call has NOT been run** from this egress-restricted
environment (PENDING). See `docs/30` §9, `ADR-020` (M7.2 amendment),
`docs/reports/M7.2-CROSSREF-CONNECTOR.md`. **Milestone 7.3** then added the bounded
**discovery orchestrator** (`packages/discovery/src/orchestrator/`) `runDiscovery`:
registry-based provider selection (MOCK + CROSSREF run through it; PUBMED/EUROPE_PMC
fail closed), hard budgets (pages/items/candidates/requests/duration/retries — no
unbounded run), bounded retries with backoff/jitter + Retry-After (transient only),
per-item failure isolation, conservative graded dedup (DOI → persistent id →
title+year → title; DEFINITE/PROBABLE/POSSIBLE/NEW, never merges/deletes),
candidate idempotency on `(source_key, stable_source_id)`, and reviewable-candidate
persistence through a **port** with a tested in-memory adapter. It writes nothing
canonical, never publishes/classifies, never calls AI, and refuses non-staff
callers. **The M7.3 schema firewall fired:** the current `import_candidate` schema
cannot enforce candidate idempotency, so **no migration was created** and the DB
adapter is deferred — the required `0013_discovery_candidate_identity.sql` is
proposed for approval in `docs/reports/M7.3-DISCOVERY-RUN.md` (§10.7). See
`docs/30` §10. **M7.4 (server-side DB adapter, staff trigger, review UI,
scheduling) and later M7/M8 work are NOT started and NOT authorized.** There is
still **no live automated discovery** and **no discovery DB writes**. Live provider

- Supabase (browser/auth/DB) verification is PENDING a provisioned project.

```text
.
├── CLAUDE.md                     # this file
├── CLAUDE-CODE-MASTER-PROMPT.md  # authoritative lead-architect brief
├── README.md
├── MANIFEST.md                   # index of all docs
├── package.json / pnpm-workspace.yaml / tsconfig.base.json  # M1 tooling
├── apps/web/                     # Astro hybrid SSR + React island + Tailwind;
│                                 #   M3 admin workflow UI + public /research/[id];
│                                 #   M4 /research explorer + ResearchCard;
│                                 #   M5 /evidence + /statistics + DistributionChart
├── packages/domain/              # portable domain logic — normalizeDoi(), normalizeTitle()
├── packages/database/            # data-access boundary + M3 service + M4 search + M5 stats + M6 service/ai + PGlite tests
├── packages/metadata/            # M3 provider-independent Crossref/mock metadata
├── packages/ai/                  # M6 provider abstraction + mock/OpenAI-compatible providers + prompt registry + validation;
│                                 #   ADR-019 provider registry + provider/model config + presets + capability negotiation
├── packages/benchmark/           # M6.1 benchmark harness (drives the existing AI provider/orchestrator; live run env-gated)
├── packages/discovery/           # M7.1 provider-neutral discovery (DiscoveryProvider contract + SourceDescriptor + typed objects/errors + registry seam + deterministic mock); M7.2 crossref/ connector + injected http.ts (host-pinned api.crossref.org); M7.3 orchestrator/ bounded runDiscovery + budgets/retries/dedup + persistence ports (in-memory; DB adapter BLOCKED on migration 0013). No scraping/scheduler/AI/DB-write/migration.
├── prompts/                      # M6 versioned prompt registry (<task>/v1.md + registry.json)
├── supabase/migrations/          # canonical schema, RLS (0001–0011); 0012 anon grant hardening (prepared, NOT applied to prod)
├── supabase/seed/                # clearly-labelled DEMO fixtures
├── .github/workflows/ci.yml      # CI: lint · typecheck · test · build
└── docs/
    ├── 00-ARCHITECTURE-BASELINE.md … 23-AI-AGENT-INSTRUCTIONS.md
    ├── 24-MULTI-SOURCE-INGESTION.md  # M8 design checkpoint (design-only)
    ├── 25-DATABASE-FOUNDATION.md     # M2 design checkpoint (implemented)
    ├── 26-MANUAL-RESEARCH-MVP.md     # M3 design checkpoint (implemented)
    ├── 27-PUBLIC-RESEARCH-EXPLORER.md # M4 design checkpoint (implemented)
    ├── 28-EVIDENCE-VISUALIZATION-METHODOLOGY.md # M5 design checkpoint (implemented)
    ├── 29-AI-ENRICHMENT.md           # M6 design + as-built record (implemented)
    ├── 30-AUTOMATED-DISCOVERY-METHODOLOGY.md # M7.1 discovery foundation (implemented; M7.2+ design-pending)
    ├── adr/     ADR-001 … ADR-020 (+ index/template)
    └── reports/ ARCHITECTURE-CROSSCHECK · MVP-SCOPE · TECH-STACK-DECISION · M6-IMPLEMENTATION-VERIFICATION · M6.1-OPERATIONAL-VERIFICATION · M7.1-CHECKPOINT · M7.2-CROSSREF-CONNECTOR · M7.3-DISCOVERY-RUN
```

Do not assume the state of the repository — inspect first (`git status`, `ls`,
read files) before acting. Milestones 0–6 are complete. **Milestone 6.1** (the
OpenRouter benchmark) is **PARTIALLY COMPLETE (live BLOCKED)**: the reproducible
benchmark harness (`packages/benchmark`) is built and verified offline, but the live
OpenRouter run is gated on server-side egress + a key and has **not** run (see
`docs/reports/M6.1-OPERATIONAL-VERIFICATION.md`). Do **not** run live model calls,
enable a production AI provider, or implement Milestone 7+ features
(scraping/discovery, multi-source connectors, community voting, advanced analytics)
without explicit authorization.

A **Production Readiness** pass (2026-08-29, ADR-018) fixed the GitHub Pages
base-path bug — `astro.config.mjs` now reads `base`/`site` from `SITE_BASE`/
`SITE_URL` (production SSR unchanged at root; the preview workflow sets the
`/Wise-evidence-/` subpath), with author links routed through
`apps/web/src/lib/base.ts` `withBase()`. Verified locally in headless Chromium
(assets/favicon/Copy-DOI/nav all correct under the subpath); the **live** Pages
URL, a **live SSR host**, and the **live OpenRouter** run remain BLOCKED/PENDING
because this environment's egress proxy denies those hosts — never claim any of
them "live" without opening the real URL. The pass also prepared migration
`0012_grant_hardening.sql` (+ `grants.test.ts`) making `anon`'s SQL grants match
the documented least-privilege intent; it is **not** applied to production without
explicit owner approval. See `docs/reports/PRODUCTION-CONNECTION-VERIFICATION.md`.

A **Milestone 6.2 — Production Readiness** pass (2026-08-29) then re-ran and
recorded every offline gate (331 tests + 1 skipped, typecheck/lint/format/build,
secret scan — all clean) and **verified the compiled Astro Node standalone server
starts** (`node apps/web/dist/server/entry.mjs`): public `/`, `/research`,
`/evidence`, `/statistics` return 200 and `/admin` fail-closes to sign-in (302).
It added the missing **`render.yaml`** — a Blueprint for the _existing_ Node
standalone server (Node 22, existing build/start commands, all secrets
`sync:false`, no new SSR architecture); the brief's premise that one existed was
wrong, so it was created, not reused. Migrations are still exactly `0001`–`0012`.
The AI subsystem is confirmed provider-agnostic (switch by config only). Live
**Render provisioning**, **live Supabase** (auth/RLS/workflow), the **live
OpenRouter** benchmark, and the **live Pages URL** remain PENDING/BLOCKED — this
environment cannot reach those hosts and none was faked. Decision: **READY WITH
DOCUMENTED BLOCKERS**; **M7 not started, not authorized**. See
`docs/reports/PRODUCTION-READINESS-6.2.md`.

> **History:** the architecture originally shipped as
> `WiseEvidence_Architecture_Package_v0.1.zip`. In Milestone 0 it was unpacked
> into tracked files and the zip retired; specs `05`–`23`, ADRs, and the three
> reports were then written. See `MANIFEST.md`.

### The architecture docs

The tracked `docs/` tree is now the single source of truth. **Read these before
doing anything substantial** — order `00 → 04` for foundation, then the specific
specs your task touches. `CLAUDE-CODE-MASTER-PROMPT.md` is the single most
important document — the lead-architect brief for the whole project. This
CLAUDE.md summarizes it, but the master prompt governs where they differ.
`docs/reports/ARCHITECTURE-CROSSCHECK.md` records how cross-doc discrepancies
were resolved; `docs/23-AI-AGENT-INSTRUCTIONS.md` is the operating contract for
any coding agent.

### Architecture is complete; keep it consistent

Specs `05`–`23` and ADRs `001`–`019` now exist. Do **not** silently invent new
architecture that contradicts them — when a decision changes, update the relevant
doc, add an ADR if significant, and keep the set internally consistent (see §5).
Milestone 6 (AI Enrichment) is complete; the next step is **Milestone 6.1** (a
one-off OpenRouter benchmark, run only in a secure server-side environment) and
then **Milestone 7 — Automated Research Discovery** (`docs/22-ROADMAP.md`), still
no premature features.

Forward design may be documented ahead of build order without changing that
order: `docs/24-MULTI-SOURCE-INGESTION.md` and `ADR-012` are the approved
**Milestone 8** ingestion design — but it is **design-only**. M8 implementation is
blocked on the earlier phases and must not be coded before it is authorized.

---

## 2. First rule: architecture before code

**Do not start writing application code.** The master prompt is explicit: the
first milestone is _Architecture Completion + Repository Foundation_, not features.

Before any substantial change:

1. Read the five drafted architecture docs (order: 00 → 01 → 02 → 03 → 04).
2. Inspect the repository (`git status`, directory structure, existing files).
3. Identify any existing technology and any existing user work.
4. Report what you found.
5. Propose the _smallest_ plan that follows the architecture.

Complete or advance the remaining architecture specs (§1, "documents that do not
yet exist") **before** substantial implementation. Do not invent a large
architecture without documenting the decisions behind it.

---

## 3. Non-negotiable domain rules

These are the credibility core of the project. Violating them corrupts the data
model, which is worse than shipping slowly.

**Keep these concepts separate — never collapse them into one field or one score:**

- Study **outcome** (what the study reported)
- Evidence **quality** (methodological rigor)
- **Confidence**
- Methodological **criticism**
- Source **provenance**

Corollaries the platform must be able to represent:

```text
AI            ≠ Final Authority
Outcome       ≠ Evidence Quality
Criticism     ≠ Negative Outcome
Source        ≠ Truth
Study Count   ≠ Scientific Certainty
Frontend      ≠ Privileged Backend
```

A positive study is not automatically high quality; a negative study is not
automatically low quality; criticism is not the same as a negative outcome. The
model must represent supportive, mixed, neutral, inconclusive, and critical
findings — never a positive-vs-negative binary.

**Outcome categories** (public): Strong Positive · Positive · Mixed/Leaning
Positive · Neutral/Inconclusive · Mixed/Leaning Negative · Negative · Strong
Negative. An internal score may drive visualization but must **not** be presented
as a validated scientific measurement.

### AI rules

AI is an **assistant, not the final authority**. It may extract metadata,
summarize, suggest study type / outcome / evidence level / tags, detect
duplicates, and identify related research. It must **not** silently become the
final authority for public classifications.

Store AI suggestions **separately** from human-reviewed final values, and always
preserve AI provenance: provider, model, prompt version, input hash, output,
timestamp, status, and confidence (and cost where available).

### Human review workflow

```text
Import → AI enrichment → Review queue → Human review → Publish
```

Do not publish automatically when human review is required. The admin review UI
must let a reviewer work with dropdowns, buttons, `+ Add` / Remove, checkboxes,
quick approve/reject — **never** by editing raw database rows.

### Research lifecycle

```text
DISCOVERED → IMPORTED → PROCESSING → PENDING_REVIEW → PUBLISHED
```

(plus appropriate failure / rejection / archive states). The fuller pipeline:
`Discovered → Imported → Normalized → Deduplicated → AI Enriched → Pending
Review → Reviewed → Published → Updated/Re-reviewed`.

### Deduplication order

```text
DOI → PMID/persistent identifier → normalized title → author + year → similarity
```

Never auto-delete a possibly-distinct paper on fuzzy match alone; route to a
duplicate-review workflow.

### Data, copyright & provenance

- **PostgreSQL is the authoritative source of application state.** JSON, Markdown,
  scraper output, and AI output are never the canonical database.
- All schema changes go through **version-controlled migrations** — never
  manual production dashboard edits.
- **Do not download or host research PDFs by default.** Prefer DOI, publisher
  URL, PubMed URL, open-access URL, and permitted metadata/abstract. Respect
  source terms, robots rules, rate limits, and licensing. Prefer structured APIs
  over HTML scraping.
- **Do not build scraping first.** The first working data flow is manual:
  `Admin → DOI/URL → Metadata → Research Record → AI enrichment → Review →
Publish`. Source connectors come only after that works reliably.
- Do **not** build researcher upvote/downvote reputation scoring. Focus community
  feedback on research objects (summary/metadata accuracy, classification
  disagreement, usefulness), not personal reputation.

---

## 4. Technology direction (preferred, not yet installed)

When implementation begins, the master prompt and system architecture point to:

- **Astro** for the site, **React** only where interactivity requires it
  (static-first with interactive islands).
- **Tailwind CSS** or a similarly simple design system.
- **Supabase / PostgreSQL** (Auth, Edge Functions where appropriate, Storage only
  when justified). Use Row-Level Security; security must not depend on
  client-side hiding.
- **GitHub + GitHub Actions** for CI/CD.
- A **provider-independent AI service** abstraction — do not couple app logic to
  one AI provider; select the cheapest suitable model per task; cache on
  `research_id + operation + input_hash + model + prompt_version`.

**Architecture style:** a **modular monolith** with managed services. Keep logical
boundaries between Research, Taxonomy, Search, Classification, AI, Import, Review,
Authentication, Administration, Community, Analytics, Provenance, and Audit — but
do **not** turn them into microservices.

**Cost philosophy: _Free first. Cheap second. Paid only when justified._** Do not
introduce Kubernetes, microservices, Elasticsearch, a dedicated vector database,
expensive observability, or expensive AI-on-every-paper without a measured
requirement. If a paid service seems necessary, explain why _before_ adding it.

**Do not overbuild:** no mobile app, social network, recommendation engine, vector
DB, complex analytics, autonomous research agent, or search cluster unless it is
part of the current approved milestone.

If the repository ever already contains a technically sound stack that differs
from the above, do **not** rewrite it just to match the preference — explain any
deviation instead.

**Roles:** initially `PUBLIC`, `REVIEWER`, `ADMIN`. Public browsing needs no
login. Never expose service-role keys, AI provider secrets, or DB admin
credentials to the frontend.

---

## 5. Development workflow & conventions

### Git discipline

- **Work on the feature branch assigned for your current task** (create it from
  the latest default branch if it does not exist). Never push to another branch
  without explicit permission.
- Run `git status` and inspect existing changes **before** modifying files.
- **Never** delete or overwrite existing work without explicit justification.
- Use small, understandable commits with clear messages.
- Push with `git push -u origin <branch-name>`; retry network failures up to 4
  times with exponential backoff (2s, 4s, 8s, 16s).
- **Do not** open a pull request unless the user explicitly asks.
- If the branch's PR was already merged, restart the branch from the latest
  default branch for follow-up work rather than stacking onto merged history.

### Documentation discipline

When an architectural decision changes: (1) update the relevant document, (2)
write an ADR if the decision is significant, (3) update affected implementation
notes, (4) explain the reason. Never let code and architecture docs silently
diverge.

The architecture docs are now tracked under `docs/` (the v0.1 zip has been
unpacked and retired). Keep them versioned and extended in place; never let code
and architecture docs silently diverge.

### Testing (when code exists)

Write tests for the critical logic: DOI normalization, deduplication,
classification, research lifecycle, permissions, publication, import
normalization, search, and the AI provider abstraction. Use **deterministic
mocks** for AI and external source connectors.

### Local development (target state)

Developers must be able to run the project **without paying for AI**. Provide a
mock AI provider, mock import source, fixture imports, seed data, and test users.
Seed data should include representative records: positive, negative, mixed,
neutral, missing-DOI, duplicate, low-confidence AI classification, and
human-override cases.

### Working method for each milestone

`Inspect → Plan → Implement → Test → Review → Document → Report.` Do not silently
jump between milestones.

At the end of a major task, report under: **Completed** · **Files** · **Tests** ·
**Architecture** (decisions) · **Risks** · **Next** (smallest sensible step).

---

## 6. Milestone sequence

Build in this order (from the master prompt). Do not skip ahead.

1. **Architecture Completion + Repository Foundation** — finish the architecture
   docs; establish clean project structure, dev instructions, a basic Astro app,
   Supabase connection strategy, environment config, CI foundation, test
   foundation. No unnecessary features.
2. **Research Data Foundation** — migrations, research entities, taxonomy
   foundation, provenance, lifecycle, seed data, data-access layer, tests.
3. **Manual Research MVP** — admin login, add research, DOI metadata retrieval,
   research editor, review queue, publish workflow, public detail page.
4. **Public Research Explorer** — search, filters, sorting, evidence browsing,
   conditions, interventions, research cards.
5. **AI Enrichment** — AI abstraction, provider config, cheap-model strategy,
   prompt versioning, AI cache, summaries, classification suggestions, human
   review.
6. **Automated Research Discovery** — only after the earlier pipeline is stable.

Priority tiers for MVP scope live in `docs/02-PRODUCT-REQUIREMENTS.md` (P0 → P3).

---

## 7. Planned URL / information architecture

From `docs/03-INFORMATION-ARCHITECTURE.md` — the public and admin route maps the
implementation should target (not yet built):

**Public:** `/` · `/research` · `/research/:id` · `/evidence` · `/evidence/:slug`
· `/conditions` · `/conditions/:slug` · `/interventions` · `/interventions/:slug`
· `/criticism` · `/criticism/:slug` · `/authors` · `/journals` · `/explore` ·
`/timeline` · `/statistics` · `/methodology` · `/about` · `/contribute`

**Admin:** `/admin` · `/admin/review` · `/admin/research` · `/admin/imports` ·
`/admin/sources` · `/admin/taxonomy` · `/admin/ai` · `/admin/corrections` ·
`/admin/users` · `/admin/audit`

Guiding principle: the database may be complex; the UI must not feel complex.
Reveal complexity progressively (overview → details → advanced filters →
methodology → source). No dead ends — pages link to related entities.

---

## 8. When you find a problem

Do not hide it. Classify it (bug / architecture / data / security / scope /
documentation / external dependency issue), then explain the safest correction.
Before any significant change, ask: Does this follow the architecture? Is it
needed for the current phase? Can it be simpler? Does it increase recurring cost?
Does it create vendor lock-in? Does it need an ADR?

Optimize for correct architecture, reliable research data, transparent
provenance, human-reviewable AI, low cost, maintainability, testability, and
open-source contribution — **not** for the amount of code written. The platform's
credibility depends on its data model and transparency as much as its UI.
