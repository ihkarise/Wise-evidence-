# ADR-020: Automated Research Discovery — Provider-Neutral Contract & Deterministic Mock (M7.1)

**Status:** Accepted — IMPLEMENTED (M7.1 contract + mock; M7.2 Crossref connector; M7.3 orchestrator; M7.4A DB persistence + migration 0013; M7.4B review UI; M7.5 dedup explainability; M7.6 Europe PMC connector — see Amendments). M7.7 / scheduling / PubMed NOT started, NOT authorized.
**Date:** 2026-08-30 (M7.1); amended 2026-08-30 (M7.2), 2026-09-10 (M7.5), 2026-09-10 (M7.6)
**Related:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`,
`docs/11-DATA-IMPORT-ARCHITECTURE.md`, `docs/24-MULTI-SOURCE-INGESTION.md`,
`docs/05-DATABASE-ARCHITECTURE.md`, `docs/16-SECURITY.md`, `docs/20-TESTING.md`,
`docs/21-COST-CONTROL.md`, `ADR-007`, `ADR-012`, `ADR-017`, `ADR-019`

## Context

Milestones 0–6 (through AI enrichment) are complete, and the manual pipeline
`Admin → DOI/URL → Metadata → Research Record → AI enrichment → Review → Publish`
works. Milestone 7 introduces **automated research discovery**. Per `ADR-007`
(manual import before scraping) and the master prompt, discovery must be built as
the smallest safe slice first, provider-neutral from day one, with no premature
source connector, scheduler, scraper, or AI coupling.

M7.1 is the foundation slice: the discovery **contract**, typed objects, a typed
error model, a registry seam, and a deterministic offline mock — no real network,
no Crossref, no scheduling, no migration.

## Decision

### 1. A dedicated framework-independent package

Discovery lives in a new `packages/discovery`, consistent with the modular
monolith (`ADR-001`) and the existing `packages/{domain,metadata,ai}` boundaries.
It imports nothing from Astro, React, Supabase, web UI, or any AI SDK; among
workspace packages it depends only on `@wise-evidence/domain`. It exposes **no
generic "fetch any URL" helper** and performs no I/O of its own.

### 2. `DiscoveryProvider` — a provider-neutral, three-operation contract

`discover()` (paged), `fetch()` (single-item detail; enrichment, never
acceptance), and `normalize()` (pure). Expected failures are returned as a
`DiscoveryResult` FAILURE carrying a typed `DiscoveryError`, never thrown. The
contract contains **no Crossref-specific concept**, so M7.2 Crossref and later
PubMed / Europe PMC adapters plug in unchanged.

### 3. `SourceDescriptor` — public, secret-free configuration

Source identity, provider type, host allow-list, HTTPS requirement, local-network
opt-in, timeout, response-size cap, per-request/per-run limits, rate-limit config,
supported identifier types, and capabilities. **No secret-shaped field**: secrets
are handled by reference server-side (`ADR-019`'s `secretRef`), never on a
descriptor. No source behaviour is hard-coded into the type.

### 4. Typed objects keep the three metadata tiers separate

`SourceItem` (raw, untrusted) is distinct from `NormalizedSourceItem` (sanitized,
canonicalised) which is distinct from AI-derived and human-authored values (both
absent in M7.1). **No outcome/quality/criticism/confidence/efficacy/score field
exists anywhere** in these types (`RELEVANCE ≠ EFFICACY`). Provenance records
source, identifiers, URL, timestamps, connector version, and a SHA-256 of the raw
payload — the hash, never full text.

### 5. Typed, redacted error model

`DiscoveryError` with a closed code set (`SOURCE_UNAVAILABLE`, `RATE_LIMITED`,
`TIMEOUT`, `MALFORMED_RESPONSE`, `FORBIDDEN_SOURCE`, `INVALID_IDENTIFIER`,
`INSUFFICIENT_METADATA`, `FETCH_FAILED`, `NORMALIZATION_FAILED`, `NOT_CONFIGURED`).
Messages are redacted so an error cannot leak a secret.

### 6. Registry seam fails closed

`DiscoveryProviderRegistry` maps a provider type to a factory; the default
registry registers **MOCK only**. `CROSSREF` / `PUBMED` / `EUROPE_PMC` resolve to
`NOT_CONFIGURED` until their adapters ship — mirroring the AI provider registry
(`ADR-019`). No fake connector behaviour, no network call.

### 7. Host/URL policy as the single egress gate

`assertUrlAllowed()` enforces allow-list + HTTPS + no-credentials + no
private/loopback (unless opted in), returning or throwing but **never fetching**.
A future networked adapter must route every request URL through it.

### 8. Deterministic offline mock

`MockDiscoveryProvider` (injected clock, fixture-backed, no randomness) exercises
success, pagination, empty, duplicate, malformed, missing/invalid DOI, and fetch
failure / timeout / rate-limit — for CI and local dev without any live source.

### 9. No database change

The existing `research_source` / `import_job` / `import_candidate` /
`research_identifier` schema (migrations `0003`/`0004`) already accommodates the
future candidate flow. M7.1 writes nothing canonical and adds **no migration**.
The later, authorized orchestrator will persist candidates as `import_candidate`
rows through the existing data-access layer under existing RLS.

## Consequences

**Positive.** Discovery is provider-neutral from the first commit; every LOCKED
boundary (discovery ≠ publication, fetch ≠ acceptance, candidate ≠ research
record, AI ≠ authority, duplicate ≠ delete) is enforced by types and covered by
offline tests; zero recurring cost; no vendor lock-in; CI stays offline and
keyless; the seam for M7.2 Crossref is ready with no orchestrator change.

**Negative / deferred.** No real discovery happens yet (intentional). The
candidate-persistence, deduplication-into-review, and scheduling halves of the
locked rules are contract-only until the later, authorized phases implement them.

**Scope firewall (M7.1).** M7.2 (Crossref adapter) and all later M7/M8 work were
not started or authorized by the original decision above.

## Amendment (M7.2 — Crossref connector, implemented)

M7.2 realizes the CROSSREF seam this ADR anticipated, with **no contract change**.
Decisions specific to the connector:

1. **Isolation.** `CrossrefDiscoveryProvider` lives in
   `packages/discovery/src/crossref/` and returns only provider-neutral discovery
   objects. An architecture guard proves no Crossref-specific code leaks into the
   generic contracts, `packages/domain`, `packages/database`, `packages/ai`, or
   `apps/web`.
2. **Host pinning + injected transport.** The host is a module constant
   (`api.crossref.org`), never a caller-supplied base URL; every URL is gated
   through `assertUrlAllowed`. A shared, injected HTTP helper
   (`packages/discovery/src/http.ts`) provides the bounded read and content-type
   check; the package never uses an ambient global fetch. Registering CROSSREF
   requires an injected `fetch` at resolve time, so it fails closed as
   `NOT_CONFIGURED` without configured egress. MOCK is unchanged; PUBMED /
   EUROPE_PMC remain unregistered.
3. **DOI as the stable source id.** Crossref's stable identifier is the DOI;
   the connector uses the canonical DOI (never array position/request order) and
   surfaces — but cannot normalize — a DOI-less item.
4. **No retries in the connector.** One request per operation; bounded retries,
   `Retry-After` honouring, and scheduling are deferred to the M7.3 orchestrator.
   A 429 becomes a typed `RATE_LIMITED` error. Rate-limit/size caps are
   conservative app-level values labelled **REQUIRES LIVE VERIFICATION**.
5. **No scraping, no AI, no DB writes, no migration, no UI.** M7.2 uses only the
   structured Crossref REST API and produces discovery objects; ingestion,
   dedup-into-review, classification, and publication remain out of scope.

**Live status.** A single opt-in live smoke test is gated on `RUN_CROSSREF_LIVE=1`
and stays skipped in CI; the live Crossref call has **not** been run from this
egress-restricted environment (PENDING).

**Scope firewall (M7.2).** M7.3 (discovery orchestration + candidate persistence),
dedup against production records, scheduling, Hermes, PubMed / Europe PMC, and AI
enrichment are **not started and not authorized**.

## Amendment (M7.5 — conservative dedup explainability, implemented)

M7.5 enriches the M7.3/M7.4A research-level deduplication with **no contract
break and no migration** (`DedupDecision` gains an optional structured
`explanation`; existing consumers are unaffected). Decisions specific to matching:

1. **Explainable, enumerated decisions.** Every decision carries a `reasonCode`
   (`DOI_EXACT_MATCH` / `PERSISTENT_IDENTIFIER_MATCH` / `TITLE_YEAR_MATCH` /
   `TITLE_EXACT_MATCH` / `INSUFFICIENT_METADATA` / `NO_MATCH`) plus the matched
   identifier, the candidate/study years, and a `yearConflict` flag — surfaced in
   the M7.4B review UI.
2. **Conservative edges hardened.** A title that normalizes to empty can never
   match; a title match with an unconfirmed/conflicting year stays POSSIBLE (never
   PROBABLE). `Study ≠ Publication` is preserved — a DOI/id match only flags a
   related study and routes to review; nothing is merged, deleted, or published.
3. **LEVEL 5 fuzzy similarity deliberately NOT implemented.** It is the highest
   false-positive risk and would require an unauthorized `pg_trgm` migration or an
   unbounded scan; `TITLE_SIMILAR` is intentionally absent from the reason-code
   union. WiseEvidence prefers a missed duplicate over a wrong merge.
4. **Pure & indexed.** The matcher is deterministic (no randomness/clock/network/
   AI); the DB index uses existing `idx_identifier_value_canonical` /
   `idx_study_normalized_title` with bounded, per-study year aggregation — never a
   table scan.

**Scope firewall (M7.5).** M7.6, scheduling, Hermes, new providers (PubMed /
Europe PMC), AI enrichment, vector/keyword search, and any automatic
merge/accept/delete/classify/publish are **not started and not authorized**. No
live provider or Supabase run was performed; those remain PENDING/BLOCKED.

## Amendment (M7.6 — Europe PMC connector, implemented)

M7.6 realizes the EUROPE_PMC seam this ADR anticipated (the C2 source in
`docs/24`, the priority after Crossref), with **no contract change and no
migration**. It is the second real `DiscoveryProvider` and reuses the M7.2
security machinery unchanged. Decisions specific to the connector:

1. **Isolation.** `EuropePMCDiscoveryProvider` lives in
   `packages/discovery/src/europepmc/` and returns only provider-neutral
   discovery objects. A second architecture guard proves no Europe-PMC-specific
   code leaks into the generic contracts, `packages/domain`,
   `packages/database`, `packages/ai`, or `apps/web` (mirrors the Crossref
   guard).
2. **Host pinning + injected transport.** The host is a module constant
   (`www.ebi.ac.uk`), never a caller-supplied base URL; the only endpoint used is
   the structured REST `search` path. Every URL is gated through
   `assertUrlAllowed`; the shared injected `http.ts` provides the bounded read and
   content-type check; the package never uses an ambient global fetch. Registering
   EUROPE_PMC requires an injected `fetch` at resolve time, so it fails closed as
   `NOT_CONFIGURED` without configured egress. MOCK and CROSSREF are unchanged;
   PUBMED remains unregistered.
3. **Composite `SOURCE/ID` as the stable source id.** Europe PMC's persistent
   identifier is the `source`+`id` pair (e.g. `MED/36000001`); the connector uses
   that composite as the idempotency key, falling back to the canonical DOI. This
   means a DOI-less preprint that Crossref could not have keyed still gets a stable
   id and normalizes — a strength of the cross-linked Europe PMC id space. It also
   emits DOI/PMID/PMCID identifiers, strengthening later conservative dedup.
4. **Query hardening.** Free-text queries are stripped of Lucene/Europe-PMC
   operators and boolean keywords before they reach the field-scoped query, so
   untrusted text can never restructure the query; DOI/`SRC`/`EXT_ID` values are
   quote-escaped. No API key is required or accepted.
5. **No retries in the connector.** One request per operation; bounded retries,
   `Retry-After` honouring, and scheduling stay with the M7.3 orchestrator (which
   drives EUROPE_PMC through the registry unchanged — proven by an integration
   test). A 429 becomes a typed `RATE_LIMITED` error. Rate-limit/size caps are
   conservative app-level values labelled **REQUIRES LIVE VERIFICATION**.
6. **No scraping, no AI, no DB writes, no migration, no UI.** M7.6 uses only the
   structured Europe PMC REST API and produces discovery objects; ingestion,
   dedup-into-review, classification, and publication remain out of scope and
   unchanged. `DUPLICATE ≠ DELETE` and `Study ≠ Publication` hold: a Europe PMC
   record whose DOI already belongs to a known study is flagged
   `DUPLICATE_CANDIDATE` for human review, never merged or deleted.

**Live status.** A single opt-in live smoke test is gated on
`RUN_EUROPE_PMC_LIVE=1` and stays skipped in CI; the live Europe PMC call has
**not** been run from this egress-restricted environment (PENDING).

**Scope firewall (M7.6).** PubMed / NCBI (C3), scheduling, Hermes, queues,
workers, AI enrichment, fuzzy/vector search, full-text hosting, and any automatic
merge/accept/delete/classify/publish are **not started and not authorized**. No
live provider or Supabase run was performed; those remain PENDING/BLOCKED.
