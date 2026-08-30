# WiseEvidence
## Automated Research Discovery — Methodology & M7.1 Foundation

**Document:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`
**Version:** 0.2.0
**Status:** M7.1 IMPLEMENTED (contract + mock) · M7.2 IMPLEMENTED (Crossref connector). M7.3+ DESIGN-PENDING / NOT AUTHORIZED.
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
- **M7.3 and later (discovery orchestrator + candidate persistence, deduplication
  into the review queue, scheduling, PubMed / Europe PMC) are design-pending and
  NOT authorized.** Build in order (`docs/22`).

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
