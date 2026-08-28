# ADR-017: Automated Discovery is Candidate-Generation, Behind a Connector Abstraction

**Status:** Accepted
**Date:** 2026-08-25
**Related:** `docs/25-RESEARCH-DISCOVERY.md`, `docs/11-DATA-IMPORT-ARCHITECTURE.md`, `ADR-007` (manual import before scraping), `ADR-016` (AI suggestion-only)

## Context

Milestone 7 adds the first automated way to find research. The credibility risk is
that "automated discovery" quietly becomes automated ingestion, classification, or
publication. ADR-007 already established manual import first; this ADR records how
the automated layer stays controlled and where its boundaries sit.

## Decision

1. **Discovery generates review candidates only.** The only flow is
   `discover → normalize → deduplicate → import_candidate → human review →
   createDraft`. Discovery never publishes, never writes a classification, never
   auto-invokes AI, and never deletes or merges research. Approval routes through
   the existing M3 `createDraft` (study is IMPORTED/DRAFT), and publication stays
   ADMIN-only and fail-closed.

2. **Provider-neutral connector abstraction (`packages/discovery`).** A portable
   `ResearchDiscoveryConnector` (`discover` + `normalize`) with two
   implementations: `MockDiscoveryConnector` (deterministic, CI/dev default) and
   `CrossrefDiscoveryConnector`. Discovery is kept separate from the M3 metadata
   provider — they answer different questions and share only the domain DOI
   normalizer. Selection is server-only env (`DISCOVERY_CONNECTOR`).

3. **First source: Crossref, via its structured works API, not scraping.** Chosen
   for free structured access, stable DOIs, no key, and prior trust in M3. The
   connector is host-pinned, https-only, bounded (`rows` ≤ cap ≤ 50), with a
   timeout, response-size cap, and no cross-host redirects; it never fetches
   arbitrary URLs found in results (no SSRF surface) and respects source terms.

4. **Deduplication flags, never destroys.** DOI (then source id) matching marks a
   candidate `DUPLICATE_CANDIDATE` and links the existing study; title similarity
   is never identity. Existing research is untouched; `Study ≠ Publication` holds.

5. **Reuse the M2 tables; smallest additive migrations.** `import_job` /
   `import_candidate` are reused. `0015` adds `REJECTED` to `import_state`; `0016`
   adds honest job counts + candidate provenance/review columns and widens import
   write-RLS from admin-only to reviewer-or-admin (discovery is staff-triggered).
   No new job/candidate tables, no queue, no second audit system.

6. **No scheduler in M7.** Discovery is staff-triggered on demand; recurring
   ingestion, additional connectors, and automatic AI enrichment are out of scope
   and require separate authorization.

## Consequences

- The credibility invariant is structural: a discovered record can only reach the
  public site by a human approving it into the normal draft→review→publish path.
- Adding a source is implementing the connector interface; the pipeline, dedup,
  review, and audit are unchanged.
- Real Crossref network verification is a documented pending gate; the mock
  connector runs the whole pipeline deterministically in CI with no network.
- Any future capability that would let discovery classify, publish, run on a
  schedule, or auto-enrich requires a new ADR.
