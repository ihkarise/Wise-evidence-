# WiseEvidence
## Automated Research Discovery — Methodology & M7.1 Foundation

**Document:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`
**Version:** 0.1.0
**Status:** M7.1 IMPLEMENTED (provider contract + deterministic mock). M7.2+ DESIGN-PENDING / NOT AUTHORIZED.
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
- **M7.2 and later (Crossref adapter, orchestrator + candidate persistence,
  deduplication into the review queue, scheduling) are design-pending and NOT
  authorized.** Build in order (`docs/22`).

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
