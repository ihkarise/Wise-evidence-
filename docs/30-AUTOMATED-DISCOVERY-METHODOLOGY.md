# WiseEvidence

## Automated Research Discovery — Methodology (Milestone 7 Design Checkpoint)

**Document:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`
**Version:** 0.1.0
**Status:** Design Checkpoint — **design-only, not implementable in this session.**
M7 IMPLEMENTATION = NOT STARTED. M7 AUTHORIZATION = NOT GRANTED.
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `04-SYSTEM-ARCHITECTURE.md`, `05-DATABASE-ARCHITECTURE.md`,
`10-AI-ARCHITECTURE.md`, `11-DATA-IMPORT-ARCHITECTURE.md`, `12-ADMIN-ARCHITECTURE.md`,
`16-SECURITY.md`, `17-DATA-GOVERNANCE.md`, `20-TESTING.md`, `21-COST-CONTROL.md`,
`22-ROADMAP.md`, `24-MULTI-SOURCE-INGESTION.md`, `29-AI-ENRICHMENT.md`,
`docs/adr/ADR-005-ai-provider-abstraction.md`,
`docs/adr/ADR-007-manual-import-before-scraping.md`,
`docs/adr/ADR-012-multi-source-ingestion.md`,
`docs/adr/ADR-017-ai-enrichment.md`, `docs/adr/ADR-019-provider-agnostic-ai-architecture.md`,
`docs/adr/ADR-020-automated-research-discovery.md`,
`docs/reports/M7-READINESS-REVIEW.md`

---

# 0. What this document is

This is the **Milestone 7 (M7) Design Checkpoint** for *Automated Research
Discovery* — Phase 7 in `22-ROADMAP.md` ("First structured source connector:
discovery, fetch, normalize, deduplicate, review-queue integration"). It is the
blueprint a later, separately-authorized implementation must follow.

It is **documentation only**. No connector, discovery, scheduling, queue, or
migration code is created by this checkpoint. It defines *what M7 is and how it must
behave*, so that a developer or AI can implement it later without inventing
architecture.

**Scope boundary — M7 vs M8.** M7 builds the discovery **foundation**: the
provider-neutral connector contract, one first connector behind it, the discovery
run, normalization, conservative dedup, the candidate queue, provenance, and human
review integration. `docs/24-MULTI-SOURCE-INGESTION.md` (M8, `ADR-012`) then
*extends* that foundation to a registry of several sources with incremental
cross-source hardening. This document is deliberately consistent with doc 24 and does
not restate it; where M8 hardens an M7 mechanism, that is noted, not duplicated.

**Repository reality (verified, not assumed).** Unlike when doc 24 was written (repo
was documentation-only), Phases 0–6.3 are now **complete**: pnpm workspace,
`packages/{domain,database,metadata,ai,benchmark}`, `apps/web`, migrations
`0001`–`0012`, RLS, the manual research MVP, the public explorer, evidence
visualization, and the provider-agnostic AI subsystem all exist and are
test-covered. M7 therefore builds on real substrate, catalogued in
`docs/reports/M7-READINESS-REVIEW.md` §2–§6. There is still **no** discovery,
connector, scraping, scheduler, or ingestion code, and none is added here.

---

# 1. Objective

Design a subsystem that can **discover potentially relevant homeopathy research from
legitimate external sources** and turn each discovery into a **reviewable
candidate** — never a published, canonical, or auto-classified record.

The target pipeline (unchanged in shape from `11` §3 and `24` §1):

```text
Source → DiscoveryProvider → discover → fetch → normalize → identify
       → deduplicate → ImportCandidate → human review → createDraft()
       → M3 classification → M6 optional enrichment → ADMIN publish
```

There must be **no** path `Source → Published` and **no** path `Source → Draft`
that skips human review.

---

# 2. Core design principles (non-negotiable)

```text
Discovery   ≠ Publication        Fetch      ≠ Acceptance
Candidate   ≠ Research record     AI         ≠ Authority
Discovery   ≠ Classification      Duplicate  ≠ Delete
Study       ≠ Publication         Source     ≠ Truth
Relevance   ≠ Efficacy            Inclusion  ≠ Endorsement
```

Discovery only ever produces **ImportCandidates**. It never classifies outcome,
quality, confidence, or criticism; never invokes production AI as an authority;
never merges or deletes records; and never publishes. These are enforced
structurally (schema + RLS + review workflow), not by convention — and the existing
architecture-boundary guard test suite
(`packages/domain/test/architecture-boundaries.test.ts`) is extended in M7 to pin the
new seams (`M7-TEST-PLAN.md`).

---

# 3. Terminology (exact)

Ambiguous use of "research" is the main risk; these terms are used precisely
throughout M7 docs.

| Term | Definition |
|------|-----------|
| **Source** | An external provider of research metadata (Crossref, Europe PMC, PubMed, …), identified by a stable `source_key`. Corresponds to a `research_source` row. |
| **Discovery** | Asking a source "what items match this query/window?" — returns lightweight item references, not full records. |
| **Fetch** | Retrieving one item's permitted metadata payload from the source. |
| **SourceItem** | The raw, source-shaped result of discovery/fetch, before normalization. Untrusted data. |
| **Normalization** | Converting a `SourceItem` into `NormalizedResearchInput` (the single shape the domain accepts): canonical DOI, sanitized title/authors/journal/dates/abstract, identifiers. |
| **Identifier resolution** | Determining an item's identifiers (DOI/PMID/PMCID/source id/URL) and their canonical forms. |
| **Candidate (ImportCandidate)** | A persisted, reviewable discovered item. Has its own lifecycle (§13), independent of any research record. |
| **Duplicate** | A candidate that matches an existing study/publication/candidate. Sub-graded: definite / probable / possible (§9). |
| **Possible duplicate** | A weak (title/author/similarity) match routed to human review — never auto-merged. |
| **Accepted candidate** | A candidate a reviewer promoted into the research workflow via `createDraft()`. |
| **Rejected candidate** | A candidate a reviewer marked not-relevant / not-wanted. Retained (not deleted) for provenance/audit. |
| **Failed fetch** | A candidate whose fetch/normalize failed (timeout, malformed, forbidden). Recorded with error detail; never silently dropped. |
| **Unavailable source** | A source whose run could not proceed (down, rate-limited, disabled). Recorded on the run; existing data untouched. |
| **ResearchStudy** | The canonical unit of a distinct study. One study may have several publications. |
| **Publication** | One published artifact of a study (preprint, journal article, erratum, …). |
| **Import job / DiscoveryRun** | One bounded execution of discovery+fetch for a source, with counts and state. |
| **Provenance** | The permanent, append-only record of where a candidate came from and how it was transformed. |

---

# 4. Discovery architecture (provider-neutral)

Discovery mirrors the **provider-agnostic AI** seam (`ADR-019`): the application
depends on an *interface*, never on a vendor. The layers:

```text
apps/web (admin action)                 ← ADMIN triggers a bounded run
        │
Discovery Orchestrator  (packages/…)    ← pure, injected-fetch, no vendor knowledge
        │  looks up source via registry
DiscoveryProvider  (interface)          ← discover / fetch / normalize
        │  one implementation per source
Source Connector   (e.g. CrossrefConnector)
        │  injected fetch + host allowlist
External source API (HTTPS, structured)
```

- The **orchestrator** is source-agnostic: it never learns which backend answered
  (exactly as the AI orchestrator never learns the provider). It obtains a provider
  only through the **source registry** (`24` §8), validates caps, runs the bounded
  loop, persists candidates + provenance, and records the run.
- **Preference order for retrieval** (hard rule, `11` §5, `00` §12): official/public
  **APIs → structured feeds → permitted repository access → HTML extraction only
  where explicitly permitted and technically safe**. M7's first connector is an API
  connector. **Scraping is not assumed and not built in M7.**
- The connector is constructed with an **injected `fetch`** (as the existing
  `CrossrefConnector` and `OpenAICompatibleProvider` already are), so CI is fully
  offline and deterministic against fixtures.

---

# 5. Source connector contract

The interface generalizes the existing `ResearchSourceConnector` (`11` §4) and the
`MetadataProvider` (`packages/metadata`), without being implemented here.

```text
interface DiscoveryProvider {
  readonly descriptor: SourceDescriptor          // static identity + policy (24 §8.1)
  discover(query: DiscoveryQuery): SourceItemRef[] // bounded; cursor/paging aware
  fetch(ref: SourceItemRef): SourceItem            // one item's permitted payload
  normalize(item: SourceItem): NormalizedResearchInput
}
```

Supporting shapes (design):

- `DiscoveryQuery` — topic/keyword terms (from the auditable taxonomy, §16), a
  bounded window (date/cursor), and page size. Never an operator-supplied URL.
- `SourceItemRef` — the source's own stable id + minimal locbase needed to fetch.
- `SourceItem` — raw source payload (untrusted). Retained by hash for provenance,
  not as canonical data.
- `NormalizedResearchInput` — the single shape the domain accepts (`11` §4). M7
  widens the existing `NormalizedMetadata` (`packages/metadata`) with the fields
  below; the domain, not the connector, decides how it becomes canonical.

**Field provenance classes** (which each normalized field *is*):

| Class | Fields | Rule |
|-------|--------|------|
| Authoritative source metadata | source id, DOI, PMID/PMCID, title, authors, journal, dates, source URL, license/terms ref | Recorded verbatim (sanitized); the source's claim, not truth. |
| Normalized metadata | canonical DOI, normalized title, parsed dates, canonical identifier forms | Derived deterministically by `packages/domain` normalizers. |
| AI-derived interpretation | *(none at discovery)* | AI runs only **after** a candidate becomes a draft, as a suggestion (`29`, §15). |
| Human-authored values | outcome, quality, confidence, criticism, final classification | Only ever set by a human in review (`07`–`09`). Discovery never sets them. |

Abstracts and titles are **untrusted data** (`16` §8): sanitized (control chars
stripped, markup→text, length-capped — reuse `packages/metadata` `sanitize.ts`),
stored as data, never executed, never treated as instructions.

---

# 6. Source policy (eligibility tiers)

A source is eligible only after a documented terms/robots/licensing/rate review
(`11` §5, `17`). Tiers (retrieval preference, high→low):

| Tier | Access | M7 posture |
|------|--------|-----------|
| **Tier 1** | Official/public APIs (Crossref, Europe PMC, PubMed E-utilities) | **Preferred; M7 first connector is here.** |
| **Tier 2** | Structured feeds / metadata services (documented, stable) | Allowed later; not M7. |
| **Tier 3** | Permitted repository access (explicit API/terms) | Later; per-source review. |
| **Tier 4** | HTML extraction **only where explicitly permitted and safe** | **Not in M7**; requires its own review + owner sign-off. |

**Prohibited (the system stops rather than circumvents):** sources that disallow the
intended access; authentication/anti-bot/robots/terms circumvention; paywall bypass;
CAPTCHA bypass; credential harvesting; arbitrary crawling. A blocked or disallowed
source yields a recorded "unavailable/forbidden" outcome — **never** a workaround.
This is a compliance *control*, not legal advice (`25`, `M7-SECURITY-REVIEW.md`).

---

# 7. Discovery vs ingestion (the boundary)

Each verb is a distinct, testable stage; the human gate sits between QUEUE and
ACCEPT:

```text
DISCOVER    identify candidate items (bounded query)         [automated]
FETCH       obtain permitted metadata for an item            [automated]
NORMALIZE   standardize identifiers + fields                 [automated, deterministic]
DEDUPLICATE find existing study/publication/candidate        [automated, conservative]
QUEUE       persist a reviewable ImportCandidate + provenance[automated]
──────────────────────────  HUMAN AUTHORITY BOUNDARY  ──────────────────────────
ACCEPT      reviewer promotes candidate → createDraft()      [human]
CANONICALIZE create/update ResearchStudy/Publication         [human-driven, existing M3 ops]
CLASSIFY    outcome/quality/criticism                        [human, existing M3]
ENRICH      optional AI suggestion on the draft              [AI suggests, human decides, M6]
PUBLISH     make PUBLISHED                                   [ADMIN only, existing guard]
```

Nothing left of the boundary writes canonical data or changes lifecycle/publication
state. There is **no automatic publication and no automatic draft.**

---

# 8. Identifier strategy

Reuse `@wise-evidence/domain` `normalizeDoi()` and `normalizeTitle()` (already
test-covered). Resolve, in order of trust:

```text
DOI (canonical) → PMID → PMCID → source-specific id → persistent URL → (none)
```

- **Canonical identifier** — the highest-trust resolved identifier, stored in
  `research_identifier(type, value_canonical)` (unique).
- **Alternate identifiers** — all others retained as additional rows for the same
  target (cross-linking sources).
- **Identifier collision** — two candidates resolving to the same canonical id link
  to the **same study** (as observations/publications), never a second study.
- **Malformed identifier** — recorded as an item error on the candidate; the
  candidate is kept for review, **not deleted**.
- **Missing identifier** — a candidate with no strong identifier is allowed but flows
  only through weak-match dedup (§9) and always requires human review.

No candidate is ever auto-deleted on an identifier problem.

---

# 9. Deduplication (conservative)

Two layers, neither ever deletes or auto-merges (`05` §11, `11` §7, `24` §11).

**9.1 Candidate-level (idempotency).** A deterministic
`ingest_key = (source_key, stable_source_id)` under a unique constraint means a
re-run re-emitting the same item is a no-op, never a second candidate (detailed for
multi-run/cross-source in `24` §10 — M7 introduces the single-source form).

**9.2 Research-level.** Before promotion, dedup runs in the fixed order and grades
the result:

| Grade | Signal | Action |
|-------|--------|--------|
| **Definite duplicate** | exact DOI or exact persistent id match | Link candidate to existing study as an observation/publication; reviewer confirms. Never a new study. |
| **Probable duplicate** | same source id, or normalized title + year | `DUPLICATE_CANDIDATE` → human review, match reason attached. |
| **Possible duplicate** | title/author/abstract similarity | `DUPLICATE_CANDIDATE` → human review, similarity is a *request-for-review signal only*. |
| **Unrelated** | no match | proceeds as a fresh candidate to review. |

Similarity **never** triggers a merge; title similarity alone never merges studies.
Human confirmation is always available for any ambiguity. `Duplicate ≠ Delete`.

---

# 10. Study vs publication

`ResearchStudy ≠ Publication` is preserved end-to-end. One study may have many
publications. Discovery must handle, **without collapsing on title similarity**:

| Situation | Handling |
|-----------|----------|
| Same study, multiple papers | one `ResearchStudy`, multiple `Publication`s linked by shared identifiers. |
| Follow-up publication | new `Publication` (or new study if genuinely distinct) → review decides. |
| Correction / erratum | linked publication with corrective relationship; routed to the corrections workflow (`13`, §20). |
| Protocol / registration | linked publication; not a separate study. |
| Conference abstract | linked publication; low completeness → review flags. |
| Secondary analysis | may be a distinct study referencing the original → review decides. |
| Review article | a distinct publication/study; never merged into its cited trials. |

The connector proposes relationships from identifiers; the **reviewer** confirms
study/publication structure. Discovery never finalizes it.

---

# 11. Provenance

Every candidate is permanently traceable (`05` §10, `17`). Retained:

```text
source_key · source item id · source URL · DOI (where available)
discovery_run id · discovered_at · fetched_at · connector version
raw_payload_sha256 (integrity, not full-text hosting) · normalized snapshot
transformation notes (which normalizer/version produced each derived field)
```

- Provenance is **append-only**: each re-sighting adds a source-observation event,
  never overwrites prior discovery data (`24` §10.3).
- **Metadata minimization / no full-text hosting** (`11` §9, `00` §13): store DOI,
  identifiers, URLs, permitted metadata/abstract, and license info — **not**
  copyrighted full text merely because it was fetched. The raw payload is retained by
  **hash** for integrity/debugging, subject to a documented retention decision
  (Open Decision, §24 of the checkpoint), not as a canonical full-text store.

---

# 12. Fetch security (SSRF-hardened)

Reuse the pattern the `CrossrefConnector` already implements (host-pinned, injected
fetch, `AbortController` timeout, streamed size cap) and the
`packages/ai/config.ts` `validateBaseUrl`/`isPrivateHost` SSRF gate. Requirements
for every networked connector:

- **HTTPS only**; scheme allowlist rejects everything else.
- **Host allowlist** from the `SourceDescriptor` — the item id/DOI is only ever used
  to build a **path**, never to choose a host. No operator- or source-supplied URL
  becomes a server-side fetch target.
- **Redirect control** — no cross-host redirects; internal/loopback/link-local ranges
  blocked (`isPrivateHost`).
- **Timeout** (per-request `AbortController`) and **response-size cap** (streamed).
- **Content-type validation** — expect the source's declared JSON/XML; reject others.
- **Rate limits, retry with backoff+jitter, circuit-breaker** on repeated failure
  (§13).

`M7-SECURITY-REVIEW.md` holds the full threat model.

---

# 13. Rate limiting & bounded runs

From the `SourceDescriptor` (`24` §8.1); enforced by the shared runtime, never
ad hoc:

- **Per-source** rate limit (req/s), concurrency limit, and politeness contact
  (`User-Agent` + `mailto`/`tool` from **env**, never committed).
- **Per-run caps**: `maxRequestsPerRun`, `maxCandidatesPerRun`, wall-clock budget.
  A run stops at the first cap hit and records where it stopped.
- **Backoff**: exponential + jitter on transient errors (network/5xx/429), honoring
  `Retry-After`; bounded attempts; **no retry** on 4xx except 429.
- **Failure threshold**: consecutive failures raise `health_status` and can
  auto-disable a source (a circuit breaker), surfaced to admin.

Free-first (`21`): no paid queue is introduced. A run "never spins indefinitely."

---

# 14. Scheduling (deferred — design only)

M7 runs are **ADMIN-triggered, bounded, on-demand** (as M8 also mandates, `24` §17).
M7 does **not** build a scheduler/worker/queue. The checkpoint/idempotency design is
what makes future scheduling safe. Options for a later, additive, failure-isolated
scheduler — compared in `M7-IMPLEMENTATION-PLAN.md` §M7.9 and the Hermes evaluation
(`ADR-020`, `M7-COST-REVIEW.md`):

| Option | Cost | Reliability | Secrets | Exec limits | Observability | Recovery |
|--------|------|-------------|---------|-------------|---------------|----------|
| GitHub Actions cron | free tier | good | repo/env secrets | job time caps | Actions logs | re-run job |
| Render cron job | plan-dependent | good | dashboard secrets | plan caps | Render logs | re-run |
| Supabase scheduled fn | project-dependent | good | project secrets | fn limits | project logs | re-run |
| Custom worker / "Hermes" | build+run cost | depends | more surface | none | must build | must build |

**Recommendation: defer the scheduler.** Manual/on-demand runs suffice for M7; a
scheduler is added only when discovery cadence justifies it, and the simplest free
mechanism that meets the need wins over a bespoke worker (Hermes) — see §Hermes in
the checkpoint. No service is chosen for fashion.

---

# 15. AI boundary

Discovery is **independent of AI**. AI does not decide whether something is real
research, does not rank relevance authoritatively, does not publish, does not modify
canonical data, and does not run during discovery.

```text
ImportCandidate → (accepted) → Draft → optional AI enrichment (M6) → AI suggestion
                → human review (accept/edit/reject) → canonical value
```

AI enters only **after** a candidate becomes a draft, reusing the existing
provider-agnostic subsystem (`29`, `ADR-017`, `ADR-019`) as a **suggestion engine**.
There is **no** provider-specific discovery logic and **no** AI call in the discovery
path. The existing AI firewalls (never canonical, never publish, never lifecycle,
never statistics) are unchanged.

---

# 16. Research relevance (not efficacy)

Relevance determines *whether to review a candidate*, never *whether a treatment
works*. Keep these separate and layered:

```text
source inclusion   (is this source approved?)          — policy, §6
topic/metadata match (does it match the auditable query?) — deterministic, taxonomy
AI relevance suggestion (optional, later)               — suggestion only, never authority
human relevance decision (accept/reject candidate)      — the actual decision
```

**Hard rule:** discovery introduces **no efficacy ranking, no positive/negative
outcome ranking, no popularity/vote ordering, no combined score.**
`Relevance ≠ effectiveness` — the credibility rule from `00` §3 / `28`. A candidate's
presence in the queue says nothing about outcome, quality, or truth.

---

# 17. Homeopathy nomenclature (auditable query terms)

Discovery queries must handle terminology variants **without** turning terminology
into efficacy classification, and **without silently broadening**:

- Variants handled explicitly and auditable: `homeopathy` / `homoeopathy` /
  `homeopathic` / `homoeopathic`, historical spellings, and condition/intervention
  terms drawn from the existing **taxonomy** (`06`).
- The active query term set is **explicit, versioned, and logged on each run** (part
  of `DiscoveryQuery` + run provenance), so a reviewer can see exactly what was
  searched. No implicit synonym expansion, no hidden query rewriting.
- Terminology matching is a *discovery* concern only; it never assigns an outcome or
  quality value.

---

# 18. Import candidate lifecycle

Candidate state is **separate** from publication state (§7). Proposed states
(reconciling `11` §8 and `24`):

```text
DISCOVERED → FETCHED → NORMALIZED → (DUPLICATE_REVIEW) → READY_FOR_REVIEW
          → ACCEPTED | REJECTED
          → FAILED           (fetch/normalize error; recorded)
          → SUPERSEDED        (a newer observation/candidate replaces this view)
```

- `DUPLICATE_REVIEW` is entered only on a probable/possible match (§9).
- `ACCEPTED` triggers `createDraft()` (existing M3 op) — the candidate does not
  itself become a study.
- `REJECTED`/`FAILED`/`SUPERSEDED` candidates are **retained** for audit/provenance,
  never deleted.
- These map onto the existing `import_candidate_state` enum where possible; any new
  value is a documented migration in M8-style hardening, **not created here** (§21).

---

# 19. Human review

The review queue (existing `/admin/review`, extended under `/admin/imports`) shows a
reviewer, per candidate:

`source · source URL · identifiers (canonical + alternates) · normalized metadata ·
duplicate matches + reason · AI suggestions (only if the candidate was already
promoted + enriched) · provenance · errors`.

Reviewer actions (via controls, never raw-row edits, `12`):

```text
accept (→ createDraft)  ·  reject  ·  merge/link duplicate  ·  correct metadata
·  request refetch  ·  defer
```

ADMIN remains the sole publication authority through the existing fail-closed,
demo-protected publish guard (migration `0010`). Reviewers get **no** database-admin
privileges; enabling/disabling sources and triggering runs is ADMIN-only (`16` §3,
`24` §13).

---

# 20. Correction model

Discovery must support later correction without destroying history (`13`, `17`):

- Source metadata change, corrected DOI/author/journal, a newly-discovered duplicate
  relationship, or a corrected study/publication relationship are all handled through
  the existing corrections workflow + append-only audit.
- Prior provenance/observations are **never silently overwritten**; a correction adds
  a new event and (where a canonical value changes) goes through human review.

---

# 21. Schema impact (design only — no migrations created)

The readiness review (`M7-READINESS-REVIEW.md` §2) confirms the M2 foundation already
models the pipeline: `research_source`, `import_job`, `import_candidate` (with
`dedup_decision`, `duplicate_of_study_id`, `raw_payload`, `normalized_payload`),
`research_identifier`, plus the discovery lifecycle enum values. **M7 can reach a
working first connector with little or no schema change** by using these columns.

Proposed *additive* changes (authored only in a future, authorized implementation as
version-controlled migrations — **none created here**; see `M7-IMPLEMENTATION-PLAN.md`
§Schema for the per-change table/column/constraint/index/RLS/reason detail). At a
glance they align with `24` §12: a stable `(source_key, stable_source_id)` uniqueness
+ `ingest_key`/`last_seen_at` on `import_candidate`; operational columns
(`source_key`, counts, timing) on `import_job`; a `research_source.key`/health/
checkpoint set; and an append-only source-observation record. Each ships with RLS
keeping ingestion data private and a rollback + tests.

---

# 22. Cost & security posture (summary)

- **Cost** (`21`, `M7-COST-REVIEW.md`): the first source is a free, keyless public
  API; PostgreSQL/Supabase only; offline fixture-based CI; no vector DB, embeddings,
  Elasticsearch, Redis, paid scraping, browser automation, or production AI. Free-
  first / cheap-second preserved.
- **Security** (`16`, `M7-SECURITY-REVIEW.md`): HTTPS-only + host allowlist + SSRF
  blocks; RLS keeps candidates/jobs/sources private (public sees only `PUBLISHED`);
  untrusted abstracts are inert data; no secrets committed or client-exposed;
  append-only audit + provenance; no new public attack surface.

---

# 23. Testing strategy (summary)

Deterministic, offline, injected-fetch + fixtures (`20`, `M7-TEST-PLAN.md`): connector
contract, mock connector, normalization, identifier resolution, dedup grades,
candidate lifecycle, provenance/audit, rate-limit/retry/backoff, SSRF refusal,
malformed/empty/failed source data, AI isolation (no AI in discovery), human-review
authorization, and RLS (public cannot read candidates/jobs/sources). Live-source
tests are **opt-in** and never required for CI green.

---

# 24. Hard boundaries — explicitly NOT in M7

Not built, not stubbed, not scheduled: automatic publication · automatic draft
creation · automatic classification · AI in the discovery path · HTML scraping ·
crawling · multi-source registry hardening (that is M8/`24`) · a production
scheduler/worker/queue · Hermes · vector DB · embeddings · Elasticsearch · Redis ·
paid scraping · browser automation · paywall/robots/CAPTCHA circumvention · any
`Source → Draft` or `Source → Published` path.

---

# 25. Acceptance criteria & status

| Criterion | Status |
|-----------|--------|
| M7 methodology documented (this doc) | **DONE** |
| Significant decisions recorded as ADR (`ADR-020`) | **DONE** |
| Implementation plan / security / cost / test reports | **DONE** (`docs/reports/M7-*`) |
| Roadmap / manifest / ADR index updated | **DONE** |
| Connector code, migrations, tests | **PENDING — implementation not authorized** |
| Live-source verification | **PENDING — fixtures first; opt-in later** |

**M7 DESIGN = COMPLETE. M7 IMPLEMENTATION = NOT STARTED. M7 IMPLEMENTATION
AUTHORIZATION = NOT GRANTED.**

---

# 26. Change log

- **0.1.0** — Initial M7 Design Checkpoint. Documentation-only; defines the automated
  discovery methodology, connector contract, source policy, dedup, provenance,
  fetch/rate security, deferred scheduling, AI/human boundaries, lifecycle, and the
  design-only schema impact. Consistent with and foundational to the M8 design in
  `docs/24` / `ADR-012`.
