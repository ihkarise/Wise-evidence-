# WiseEvidence
## Automated Research Discovery — Methodology & M7.1 Foundation

**Document:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`
**Version:** 0.5.0
**Status:** M7.1–M7.3 IMPLEMENTED · M7.4A IMPLEMENTED (migration `0013` + DB candidate persistence, PGlite-verified; live Supabase PENDING) · M7.4B (review UI) IMPLEMENTED · M7.5 (explainable dedup) IMPLEMENTED · M7.6 (Europe PMC connector) IMPLEMENTED (offline; live PENDING). M7.7 / PubMed / scheduling NOT AUTHORIZED.
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `11-DATA-IMPORT-ARCHITECTURE.md`, `24-MULTI-SOURCE-INGESTION.md`,
`05-DATABASE-ARCHITECTURE.md`, `16-SECURITY.md`, `19-DEPLOYMENT.md`,
`20-TESTING.md`, `21-COST-CONTROL.md`, `22-ROADMAP.md`, `ADR-007`, `ADR-012`,
`ADR-017`, `ADR-020`

---

# 0. Status and scope of this document

This document records the **methodology** for WiseEvidence's automated research
discovery and the **as-built** state of its first slice, **Milestone 7.1**.

- **M7.1 (this deliverable) is implemented:** the provider-neutral discovery
  foundation in `packages/discovery` — contracts, typed objects, a typed error
  model, a registry seam, and a deterministic offline mock. It makes **no real
  network request**, implements **no source connector** (no Crossref/PubMed/
  Europe PMC), adds **no scheduler, scraper, AI, or migration**.
- **M7.2 (this document, §9) is implemented:** `CrossrefDiscoveryProvider`, the
  first real `DiscoveryProvider`, isolated in `packages/discovery/src/crossref/`.
  It talks only to the structured Crossref REST API over an injected, host-pinned,
  bounded HTTP layer and returns only provider-neutral discovery objects. No
  scraping, no scheduling, no AI, no database writes, no migration.
- **M7.3 (this document, §10) is implemented offline:** the bounded discovery
  **orchestrator** `runDiscovery` — registry-based provider selection, hard
  budgets, bounded retries, conservative graded dedup, candidate idempotency, and
  reviewable-candidate persistence through a **port** (in-memory adapter tested).
  The real database adapter is **BLOCKED** on an approved migration for candidate
  idempotency (`(source_key, stable_source_id)`); see §10.7 and
  `docs/reports/M7.3-DISCOVERY-RUN.md`.
- **M7.4 and later (the server-side DB adapter, staff-gated trigger, review-queue
  UI, scheduling, PubMed / Europe PMC) are NOT authorized.** Build in order
  (`docs/22`).

The multi-source ingestion design in `docs/24` + `ADR-012` remains the approved
**Milestone 8** design; it is compatible with — and downstream of — the M7.1
contracts described here.

---

# 1. The credibility boundary (LOCKED)

Automated discovery exists to make scattered homeopathy research **discoverable**,
never to decide what is true or effective. The following separations are locked
and enforced structurally (by types and by tests), not merely by convention:

```text
DISCOVERY ≠ PUBLICATION      a discovered item is not a research record
FETCH     ≠ ACCEPTANCE       retrieving detail never accepts a candidate
CANDIDATE ≠ RESEARCH RECORD  normalized source data ≠ canonical published data
AI        ≠ AUTHORITY        discovery works with AI entirely absent
DUPLICATE ≠ DELETE           a fuzzy duplicate is surfaced, never auto-removed
STUDY     ≠ PUBLICATION      identity is by study, not by one publication
RELEVANCE ≠ EFFICACY         discovery carries no outcome/efficacy signal
INCLUSION ≠ ENDORSEMENT      being discovered implies nothing about quality
```

Automated discovery **may** discover, fetch, normalize, deduplicate, and queue
candidates for human review. It **must not** publish research, create canonical
published research, classify efficacy, assign an outcome, approve a candidate,
bypass human review, or bypass Row-Level Security. M7.1 encodes the first half of
each rule as a contract and proves the "must not" half with boundary tests; the
candidate-queue and dedup halves arrive with the later, authorized phases.

---

# 2. The conceptual pipeline

```text
Discover → Fetch → Normalize → (Deduplicate) → (Queue candidate) → Human review → Publish
           └────────── M7.1 contract surface ──────────┘   └──── later, authorized phases ────┘
```

M7.1 delivers the three left-hand operations as a provider-neutral contract plus
a deterministic mock. Deduplication, candidate persistence, review-queue
integration, and scheduling are explicitly **out of M7.1 scope**.

---

# 3. The M7.1 contract surface (`packages/discovery`)

A new framework-independent package. It imports nothing from Astro, React,
Supabase, web UI, or any AI SDK; among workspace packages it depends only on
`@wise-evidence/domain` (for DOI/title canonicalisation). It performs no I/O of
its own and exposes **no generic "fetch any URL" helper**.

## 3.1 `DiscoveryProvider`

The single seam every source adapter implements:

```ts
interface DiscoveryProvider {
  readonly key: SourceKey;
  readonly descriptor: SourceDescriptor;
  readonly version: string;
  discover(request: DiscoveryRequest): Promise<DiscoveryResult<DiscoveryPage>>;
  fetch(ref: SourceItemRef): Promise<DiscoveryResult<FetchResult>>;
  normalize(item: SourceItem): DiscoveryResult<NormalizedSourceItem>;
}
```

Expected failures are **data, not exceptions**: `discover`/`fetch` return a
`DiscoveryResult` FAILURE carrying a typed `DiscoveryError`; `normalize` (pure,
synchronous) does the same. The interface contains **no Crossref-specific
concept** — it is exactly what an M7.2 Crossref adapter, and later PubMed /
Europe PMC adapters, plug into unchanged.

## 3.2 `SourceDescriptor`

Provider-neutral, **public** configuration: source identity, provider type, host
allow-list, HTTPS requirement, local-network opt-in, timeout, response-size cap,
per-request item cap, per-run candidate cap, rate-limit config, supported
identifier types, and declared capabilities. **A descriptor carries no
secret-shaped field** — secrets are handled by reference on the server side (the
`secretRef` pattern from `ADR-019`), never on a descriptor. No Crossref behaviour
is baked into the type.

## 3.3 Typed discovery objects

`DiscoveryRequest`, `DiscoveryPage`, `SourceItem`, `SourceItemRef`,
`FetchResult`, `NormalizedSourceItem`, and `Provenance`. Three tiers of metadata
are kept **separate**: raw source metadata (`SourceItem`, treated as untrusted),
sanitized/canonicalised source-derived metadata (`NormalizedSourceItem`), and —
absent entirely in M7.1 — AI-derived and human-authored values. There is **no
outcome, evidence-quality, criticism, confidence, efficacy, or score field
anywhere** in these types.

## 3.4 Typed error model

`DiscoveryError` with a closed code set: `SOURCE_UNAVAILABLE`, `RATE_LIMITED`,
`TIMEOUT`, `MALFORMED_RESPONSE`, `FORBIDDEN_SOURCE`, `INVALID_IDENTIFIER`,
`INSUFFICIENT_METADATA`, `FETCH_FAILED`, `NORMALIZATION_FAILED`, and the
registry's `NOT_CONFIGURED`. Messages are **redacted** so an error can never leak
a secret, API key, authorization header, or credential.

## 3.5 Provenance

Every normalized item is traceable to its source, source id, source URL,
canonical DOI (when derivable), discovery/fetch timestamps, connector version,
and a **SHA-256 hash of the raw payload**. We store the hash — never full papers
or copyrighted full text (`docs/17`).

## 3.6 Registry / seam

`DiscoveryProviderRegistry` maps a `DiscoveryProviderType` to an adapter factory.
The default registry registers **MOCK only**; resolving `CROSSREF`, `PUBMED`, or
`EUROPE_PMC` fails closed with `DiscoveryError("NOT_CONFIGURED")`. There is no
fake Crossref behaviour and no network call anywhere in the module.

## 3.7 Host / URL policy (SSRF gate)

`assertUrlAllowed()` is the single gate a future networked adapter must route
every request URL through. It enforces the descriptor's allow-list and HTTPS
policy, rejects credentials-in-URL, non-http(s) schemes, and private/loopback
hosts (unless explicitly opted in). It **returns or throws — it never fetches.**
The heuristics mirror the AI base-URL policy (`ADR-019`).

---

# 4. Deterministic mock (`MockDiscoveryProvider`)

Offline, deterministic (injected clock, no randomness), fixture-backed, and
suitable for CI. It implements the full contract and exercises every M7.1
scenario: successful discovery, multiple pages, empty result, duplicate item
(surfaced, never deleted), malformed item, missing DOI, invalid DOI, fetch
failure, timeout, and rate limiting. It writes nothing canonical, classifies
nothing, and accepts nothing.

---

# 5. Database posture (M7.1: no change)

The canonical schema already provides `research_source`, `import_job`,
`import_candidate` (with `raw_payload` / `normalized_payload` JSONB and a
`state`), and `research_identifier` (migrations `0003`/`0004`). M7.1 is a
**contract + mock** slice and touches none of them: it performs **no**
`research_study` / `publication` / `classification` insert and no publication
state change. **No migration is added.** When the later, authorized orchestrator
lands, discovered items become `import_candidate` rows via the existing
data-access layer under existing RLS — never by discovery code writing canonical
tables directly.

---

# 6. Cost & security posture

- **Cost:** zero recurring cost. No network, no AI calls, no new managed service
  (`docs/21`, "free first"). The mock and all tests run offline and keyless.
- **Security:** source metadata is untrusted and never emitted as markup; the
  host policy is the only egress gate; descriptors carry no secrets; errors are
  redacted; no generic URL-fetch capability is exposed (`docs/16`).

---

# 7. Testing

Deterministic, offline, secret-free tests cover the provider contract, mock
scenarios (pagination, stable source ids, missing/invalid DOI, malformed data,
typed errors), normalization + provenance, registry resolution and the
unconfigured-provider path, the security boundary, the AI boundary, and the
database boundary (see `docs/20`, `docs/reports/M7.1-CHECKPOINT.md`, and the
`packages/discovery/src/*.test.ts` suite).

---

# 8. What M7.1 deliberately does NOT do

No Crossref/PubMed/Europe PMC connector; no real network request; no scheduling,
queues, or Hermes; no scraping or HTML parsing; no AI discovery or enrichment; no
automatic candidate acceptance or publication; no classification, efficacy
scoring, or positive/negative weighting; no vector search; no community voting.
These belong to later, separately-authorized milestones.

---

# 9. M7.2 — Crossref connector (implemented)

`CrossrefDiscoveryProvider` (`packages/discovery/src/crossref/provider.ts`) is the
first real `DiscoveryProvider`. It satisfies the M7.1 contract unchanged — no
contract redesign was needed — and stays isolated inside
`packages/discovery/src/crossref/`; no Crossref-specific concept leaks into the
generic contracts, `packages/domain`, `packages/database`, `packages/ai`, or
`apps/web` (an architecture guard enforces this).

## 9.1 Boundary

```text
DiscoveryProvider → CrossrefDiscoveryProvider → Crossref REST API
```

The rest of the platform sees only `DiscoveryResult`, `SourceItem`,
`FetchResult`, `NormalizedSourceItem`, and typed `DiscoveryError` — never a raw
Crossref response. Only whitelisted source-specific fields (`crossrefType`,
`crossrefMember`, `crossrefScore`) are retained on `SourceItem.raw` for
provenance/debugging; the connector never blindly copies the whole record.

## 9.2 HTTP security

Shared, injected transport (`packages/discovery/src/http.ts`) plus the M7.1 host
policy:

- **Host-pinned** to `api.crossref.org` via a module constant; the host is never
  taken from a caller-supplied base URL, and every request URL is additionally
  routed through `assertUrlAllowed` against the descriptor (defense in depth).
- **HTTPS only**, **timeout-bounded** (AbortController), **size-bounded** (streamed
  byte cap), **redirects rejected** (`redirect: "error"` — a crafted response
  cannot bounce onto another host), **content-type validated** as JSON.
- `fetch` is **dependency-injected**; the package never reaches for an ambient
  global fetch, so CI is fully offline and deterministic. Resolving CROSSREF from
  the registry without an injected fetch fails closed as `NOT_CONFIGURED`.

## 9.3 Politeness (User-Agent)

Requests send an identifying `User-Agent`
(`WiseEvidence/0.1 (+repo-url)`), with a `mailto:` appended only when a contact
email is supplied by configuration (`contactEmail` option; wired from an env value
by the caller). No personal email is hard-coded; absent configuration yields the
anonymous-but-identifying UA.

## 9.4 Query policy

The query is **supplied by the caller** — the connector invents no hidden,
permanent homeopathy query list. `discover()` requires a non-empty `query` or at
least one DOI identifier (an unbounded request is refused as `INVALID_IDENTIFIER`)
and always enforces the descriptor's row/candidate caps. Defining and running the
official production query set is deferred to a later, authorized milestone.

## 9.5 Identity, DOI, normalization

The stable Crossref source identifier is the **canonical DOI** (Crossref's own
stable identifier), never array position or request order. DOIs are canonicalised
through `@wise-evidence/domain` `normalizeDoi`; the raw DOI is preserved on the
`SourceItem` for provenance. An item with no usable DOI is still surfaced by
`discover()` (one bad item never crashes the run) but has no stable id, so
normalization rejects it (`NORMALIZATION_FAILED`) — a title-hash fallback id is a
possible later enhancement. Crossref-specific parsing produces the `SourceItem`;
the generic normalizer then produces the `NormalizedSourceItem`.

## 9.6 Error mapping

Transport and HTTP failures map onto the M7.1 typed errors: timeout → `TIMEOUT`;
blocked redirect / connection failure → `SOURCE_UNAVAILABLE`; 429 → `RATE_LIMITED`
(with any `Retry-After` in safe detail); 404 / other 4xx / 5xx →
`SOURCE_UNAVAILABLE`; non-JSON content type, oversized body, invalid JSON, or a
wrong-shaped payload → `MALFORMED_RESPONSE`; a host-policy violation →
`FORBIDDEN_SOURCE`. Error messages/detail never carry secrets or headers.

## 9.7 Retries & rate limits

The connector performs **one request per operation** — no retry loop. Bounded
retries, `Retry-After` honouring, backoff/jitter, and scheduling belong to the
later, separately-authorized discovery orchestrator (M7.3); a 429 is surfaced as a
typed `RATE_LIMITED` error for that orchestrator to act on. The descriptor's
rate-limit and size caps are WiseEvidence's own conservative application-level
values and are labelled **REQUIRES LIVE VERIFICATION** — Crossref's actual current
limits were not verified from this offline environment.

## 9.8 Fetch = enrichment only

`fetch()` retrieves a single work's detail record from
`api.crossref.org/works/{doi}`. It never downloads PDFs, follows arbitrary
publisher URLs, bypasses paywalls, or leaves the Crossref host boundary.

## 9.9 Testing & live status

All connector tests are offline and deterministic via an injected fake fetch
(fixtures + status/transport injection): contract, parsing, pagination, duplicate
DOI, missing/invalid DOI, provenance, and the full security matrix (host, https,
redirect, size, content-type, status mapping, secret redaction). A single
**opt-in** live smoke test (`crossref/live.test.ts`) is `describe.runIf`-gated on
`RUN_CROSSREF_LIVE=1` and stays skipped in `pnpm test` / CI. **The live Crossref
call has NOT been run from this environment** (egress-restricted); it remains
PENDING live verification.

## 9.10 What M7.2 deliberately does NOT do

No orchestration, no database candidate creation/ingestion, no scheduling, no
Hermes, no scraping or HTML parsing, no PubMed/Europe PMC, no AI, no automatic
classification/publication, no dedup against production records, no review or
public UI, no voting, no efficacy scoring. These belong to later, separately
authorized milestones.

---

# 10. M7.3 — Discovery orchestrator + controlled run (implemented offline)

`runDiscovery` (`packages/discovery/src/orchestrator/`) controls ONE bounded
discovery run. It is provider-agnostic (registry-based selection), imports no
`@wise-evidence/database`/AI, and writes reviewable candidates through a
persistence PORT — so the whole package keeps its M7.1 boundary.

## 10.1 Flow & responsibilities

```text
registry → provider → discover → (fetch) → normalize → identifier resolution
        → deduplication → candidate DECISION → CandidateStore port (import_candidate)
```

PROVIDER talks to the source; ORCHESTRATOR controls the run; the STORE PORT
persists run/candidate state; REVIEWER/ADMIN (later) accept/reject/publish; AI is
a later, downstream step. Provider logic is never duplicated in the orchestrator.

## 10.2 Bounded run + budgets

Every run is hard-bounded (`budget.ts`): `maxPages`, `maxItems`, `maxCandidates`,
`maxRequests`, `maxDurationMs`, `maxRetriesPerRequest`, `pageSize` — each with a
conservative default and a HARD MAXIMUM a caller cannot exceed (negative/huge/unset
values are clamped). No unbounded pages, rows, requests, or recursion.

## 10.3 Failure isolation & retries

Each item is processed in isolation: a malformed item, a failed fetch, or an
unexpected throw increments a counter and the run continues. A run-level fatal
(e.g. a first-page discover failure or an unconfigured provider) stops the run
safely as FAILED. Retries (`retry.ts`) are bounded exponential backoff with jitter
and honour a `Retry-After` hint; they retry ONLY transient failures
(SOURCE_UNAVAILABLE / RATE_LIMITED / TIMEOUT), never malformed data, invalid
identifiers, or a forbidden source. `sleep`/`rng` are injected for determinism.

## 10.4 Deduplication (conservative, graded) — M7.5 explainability

`dedup.ts` applies the approved order against a read-only `KnownStudyIndex` port
(reads existing canonical studies; never writes): exact DOI → exact persistent id
(PMID/PMCID/ARXIV) → normalized title + year → normalized title. Verdicts:
DEFINITE / PROBABLE / POSSIBLE / NEW. A DEFINITE match records the related study
id for the reviewer; PROBABLE/POSSIBLE stay reviewable. Nothing is ever
auto-merged or deleted (`DUPLICATE ≠ DELETE`); the new candidate is always kept.

**M7.5** made every decision explainable and hardened the conservative edges,
with **no schema change** (existing `idx_identifier_value_canonical` and
`idx_study_normalized_title` are sufficient; the title lookup returns the matched
study's publication years via a bounded correlated aggregate, never a table scan):

- Each `DedupDecision` now carries a structured `explanation` with an enumerated
  `reasonCode` (`DOI_EXACT_MATCH`, `PERSISTENT_IDENTIFIER_MATCH`,
  `TITLE_YEAR_MATCH`, `TITLE_EXACT_MATCH`, `INSUFFICIENT_METADATA`, `NO_MATCH`),
  the matched identifier type/value, whether the title matched, the candidate's
  year, the matched study's known years, and a `yearConflict` flag — so a reviewer
  sees WHAT matched, WHY, WHICH study, WHICH identifier, and the year comparison
  (e.g. "2022 vs 2023"). The `/admin/imports/[id]` panel surfaces reason code and
  the year comparison.
- **Year conflict** is explicit: a title match whose year cannot be confirmed
  against the matched study (year absent on either side, or years differ) stays
  POSSIBLE and explains the mismatch — it never silently reads as PROBABLE.
- **Empty/punctuation-only title guard**: a title that normalizes to `""` is
  treated as no title signal and can never match a study with an empty normalized
  title (a false-positive that the pre-M7.5 title check could have produced).
- **Study ≠ Publication**: a DOI/persistent-id match only FLAGS the related study
  and routes to human review; the candidate may be a different publication of that
  study (protocol, primary report, secondary analysis, erratum, …). The engine
  never collapses records.
- **LEVEL 5 fuzzy title similarity is deliberately NOT implemented.** It is the
  highest false-positive risk and would need either an unauthorized `pg_trgm`
  migration or an unbounded scan; WiseEvidence prefers a missed duplicate
  (reviewable later) over a wrong merge (destroys provenance). See
  `docs/reports/M7.5-DEDUPLICATION.md`. The matcher stays PURE and deterministic
  (no randomness, clock, network, or AI).

## 10.5 Idempotency

Candidate idempotency is keyed on `(source_key, stable_source_id)` (the canonical
DOI for Crossref; the source id for the mock). Re-running the same run creates no
second candidate — verified against the in-memory store, which enforces exactly
the uniqueness the proposed DB index will.

## 10.6 Persistence, provenance & observability

Runs map to `import_job` (state + counters + timestamps + safe error summary);
candidates map to `import_candidate` with source key, stable id, a minimised
normalized payload (no full text), a raw-payload hash, the dedup decision, and a
candidate state (`REVIEW_REQUIRED` / `DUPLICATE_CANDIDATE`). The run returns a
safe `DiscoveryRunResult` (counters, state, duration, redacted error summary, stop
reason) — never raw payloads, headers, or secrets. No canonical `research_study` /
`publication` is written; nothing is published; authorization refuses non-staff
callers; there is no public endpoint and no UI.

## 10.7 Candidate persistence (M7.4A — implemented, migration 0013)

The M7.3 schema firewall was **resolved under M7.4A** (approved). `import_candidate`
had no `source_key` / `source_stable_id` column and no unique constraint, so
migration `0013_discovery_candidate_identity.sql` adds those two nullable columns
plus a **partial** unique index on `(source_key, source_stable_id)` where both are
present (NULL identities — manual/DEMO candidates — are exempt and never collide).
It is additive, touches no other table, and adds no RLS policy.

A thin server-side adapter (`packages/database/src/service/discovery.ts`)
implements the ports: `DatabaseDiscoveryStore` maps runs/candidates to
`import_job` / `import_candidate` (idempotent `INSERT … ON CONFLICT … DO NOTHING`
— the DB constraint is the authority; the existing candidate is preserved), and
`DatabaseStudyIndex` reads `research_identifier` / `research_study` / `publication`
for research-level dedup. Writes are the `service_role` path (RLS unchanged:
staff-only SELECT, anon fully denied). The adapter writes nothing canonical, and a
test asserts `research_study` / `publication` / `classification` stay empty after a
run. PGlite verifies the full migration sequence `0001`→`0013`, idempotency, the
NULL policy, provenance, dedup linkage, and the RLS/authorization matrix; live
Supabase application is PENDING. See `docs/reports/M7.4A-DATABASE-PERSISTENCE.md`.

## 10.8 What M7.3 / M7.4A deliberately do NOT do

No scheduler, Hermes, queue, scraping, PubMed/Europe PMC, AI, vector search,
canonical creation, publication, outcome/quality/efficacy classification, voting,
review UI, or public endpoint. Candidate acceptance (converting a candidate to a
canonical draft) belongs to the later, separately-authorized human-review
milestone (M7.4B).

# 11. M7.4B — Candidate review workflow (implemented, no migration)

M7.4B adds the **human** review workflow over the `import_candidate` rows that
M7.3/M7.4A persist. It closes the loop from an automated candidate to the START of
the existing manual research lifecycle — never past it.

## 11.1 Flow

```text
import_candidate → staff review → ACCEPT / REJECT / LINK DUPLICATE / CORRECT /
REFETCH / DEFER
    ↓ (ACCEPT)
canonical ResearchStudy/Publication DRAFT  (via createDraftFromMetadata)
    ↓
existing human classification / review workflow (M3)
    ↓
ADMIN approval → PUBLISHED
```

Acceptance is only the first hop: it produces a `DRAFT` / `IMPORTED` study and
**stops**. It never publishes, never sets outcome/quality/confidence/evidence
level, and never calls AI — those remain the existing, separate, human-controlled
M3/M6 steps.

## 11.2 Service layer (`packages/database/src/service/candidates.ts`)

Staff-only operations on the shared `SqlExecutor`, each re-checking the DB-backed
role (`requireStaff`) as defense in depth over RLS, each writing append-only
`audit_log`:

- `listCandidates` / `getCandidateDetail` — reads (safe, defensively-coerced view
  of the untrusted normalized payload; no classification fields exist to leak).
- `acceptCandidate` — creates a draft through the **existing**
  `createDraftFromMetadata`, reusing the SAME discovery `research_source` (so
  provenance is shared), then marks the candidate `IMPORTED`. If a study already
  owns the DOI, it links a duplicate instead of creating a second study.
- `rejectCandidate` — terminal `FAILED` + reason; the row is retained (never
  deleted).
- `linkCandidateDuplicate` — sets `duplicate_of_study_id` to a **server-validated**
  study; candidate stays reviewable (`DUPLICATE_CANDIDATE`).
- `correctCandidate` — records a proposal in the existing `correction` table
  (`target_type = 'import_candidate'`); the candidate payload is **not** mutated,
  so discovery provenance is preserved.
- `requestCandidateRefetch` — records an auditable request only; performs **no**
  network I/O (the bounded, host-pinned re-fetch is the orchestrator's job — never
  an arbitrary URL fetch from the review path).
- `deferCandidate` — leaves the candidate in the queue with an audit note.

## 11.3 Traceability (no new column / migration)

The chain **source → discovery run → source stable id → import_candidate →
research_study/publication** is fully traceable with the existing schema:
`import_job.source_id` → the discovery `research_source`; `import_candidate`
carries `import_job_id` + `source_key` + `source_stable_id` (the canonical DOI);
on accept the created `publication.source_id` is that same `research_source`, the
created `research_identifier.value_canonical` equals the candidate's DOI, and an
append-only `audit_log` `candidate_accepted` entry records `{candidateId →
studyId}`. The M7.4A schema firewall does **not** re-fire — migrations remain
`0001`→`0013`.

## 11.4 Web (`apps/web`)

`/admin/imports` (queue, state filters) and `/admin/imports/[id]` (detail +
structured Accept/Reject/Link/Correct/Refetch/Defer controls), plus the
`POST /api/admin/imports/[id]` dispatch. Middleware gates `/admin` + `/api/admin`
to staff; every write runs the service layer on the privileged path exactly like
M3. Untrusted source metadata is auto-escaped by Astro (never rendered as HTML).

## 11.5 What M7.4B deliberately does NOT do

No automatic publication, no automatic classification, no AI, no candidate
deletion, no scheduler/queue/Hermes, no scraping, no arbitrary URL fetching, no new
auth/audit/research/candidate/classification/duplicate table, and no migration.
Live Supabase (auth/RLS/workflow) verification is PENDING a provisioned project;
all M7.4B verification here is offline PGlite. See
`docs/reports/M7.4B-CANDIDATE-REVIEW.md`.

# 12. M7.6 — Europe PMC connector (implemented, no migration)

M7.6 adds the second real `DiscoveryProvider`, `EuropePMCDiscoveryProvider`
(`packages/discovery/src/europepmc/`), the **C2** source in `docs/24` and the next
in the priority order **Crossref → Europe PMC → PubMed**. It satisfies the M7.1
contract unchanged and reuses the M7.2 security machinery verbatim; only the
endpoint, query dialect, and response parsing are Europe-PMC-specific.

## 12.1 Boundary

Isolated in `europepmc/`, it returns only provider-neutral discovery objects; a
second architecture guard (`boundary.test.ts`) proves no Europe-PMC-specific code
leaks into the generic contracts. It imports no AI/database/web/vendor SDK and
writes nothing canonical.

## 12.2 HTTP security

The same injected, host-pinned transport as Crossref: host is a module constant
(`www.ebi.ac.uk`), HTTPS-only, timeout- and size-bounded, redirects rejected,
content-type validated as JSON, every URL routed through `assertUrlAllowed`. The
only endpoint used is the structured REST `search` path
(`/europepmc/webservices/rest/search`). No API key is required or accepted;
`fetch` is injected (else `NOT_CONFIGURED`).

## 12.3 Identity, DOI, normalization

Europe PMC's persistent identifier is the composite `source`+`id` pair (e.g.
`MED/36000001`), which the connector uses as the stable source id (falling back to
the canonical DOI). Unlike Crossref (DOI-keyed), this means a DOI-less preprint
still gets a stable id and normalizes. The connector emits DOI/PMID/PMCID
identifiers (canonicalising the DOI via `@wise-evidence/domain`), which strengthen
the M7.5 conservative dedup. Untrusted metadata is length-capped/sanitized and
abstract markup reduced to text; the raw payload is reduced to a small whitelist.

## 12.4 Query hardening

Free-text queries are stripped of Lucene/Europe-PMC operators and boolean keywords
before entering the field-scoped query, and DOI/`SRC`/`EXT_ID` values are
quote-escaped, so untrusted source text can never restructure the query. As with
Crossref, an unbounded request (no query and no DOI) is refused
(`INVALID_IDENTIFIER`).

## 12.5 Error mapping & pagination

Transport/HTTP failures map onto the M7.1 typed errors exactly as Crossref does
(timeout → `TIMEOUT`; 429 → `RATE_LIMITED` with safe Retry-After detail; 4xx/5xx →
`SOURCE_UNAVAILABLE`; non-JSON/oversized/invalid → `MALFORMED_RESPONSE`). A
well-formed empty page is terminal, not an error. Pagination uses Europe PMC's
`cursorMark`; because Europe PMC repeats the final page's mark, the connector
stops when the page is short, when no next mark is offered, or when the mark equals
the one sent — no infinite loop.

## 12.6 Orchestrator & boundaries

The M7.3 orchestrator drives EUROPE_PMC through the registry unchanged (proven by
`orchestrator/europepmc-integration.test.ts`): no `if source === "europepmc"`
anywhere. `DUPLICATE ≠ DELETE` and `Study ≠ Publication` hold — a Europe PMC record
whose DOI already belongs to a known study is flagged `DUPLICATE_CANDIDATE` for
human review, never merged, deleted, or published. Retries/backoff/scheduling stay
with the orchestrator; the connector does one request per operation.

## 12.7 Testing & live status

All tests run offline via an injected fake fetch (`europepmc/provider.test.ts`,
`security.test.ts`, plus the integration and registry/boundary tests). One opt-in
live smoke test is gated on `RUN_EUROPE_PMC_LIVE=1` and skipped in CI; the live
Europe PMC call has **not** been run from this egress-restricted environment
(PENDING). See `docs/reports/M7.6-EUROPE-PMC-CONNECTOR.md`.

## 12.8 What M7.6 deliberately does NOT do

No PubMed/NCBI (C3), no scheduling/Hermes/queue/worker, no scraping, no arbitrary
URL fetching, no full-text hosting, no AI, no automatic classification/
publication/acceptance, no candidate deletion or study merge, no fuzzy/vector
search, and **no migration** (migrations remain `0001`→`0013`). No new provider
secret is introduced (none is needed). Live provider and Supabase verification
remain PENDING a network-permitted, provisioned environment.
