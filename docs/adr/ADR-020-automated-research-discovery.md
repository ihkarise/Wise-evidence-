# ADR-020: Automated Research Discovery — Provider-Neutral Contract & Deterministic Mock (M7.1)

**Status:** Accepted — IMPLEMENTED (Milestone 7.1). M7.2+ NOT started, NOT authorized.
**Date:** 2026-08-30
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

**Scope firewall.** M7.2 (Crossref adapter) and all later M7/M8 work — real
connectors, orchestrator, dedup, scheduling, scraping, AI discovery — are **not
started and not authorized** by this ADR.
