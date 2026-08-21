# ADR-014: PostgreSQL Full-Text Search for the Public Explorer

**Status:** Accepted
**Date:** 2026-08-21
**Related:** ADR-009, `docs/14-SEARCH-ARCHITECTURE.md`, `docs/05-DATABASE-ARCHITECTURE.md`, `docs/16-SECURITY.md`

## Context

Milestone 4 adds the public research explorer: search, filters, sorting, and
pagination over PUBLISHED research. ADR-009 already committed to PostgreSQL
full-text search first (no Elasticsearch/vector DB). M2 laid a GIN index on
`publication(title, abstract)`. The explorer needs to match more than a single
publication's text — study title, human summary, authors, journal, conditions,
and interventions — while keeping ranking deterministic and the public data
boundary (RLS, PUBLISHED-only) authoritative.

## Decision

Implement explorer search as a **deterministic, parameterized PostgreSQL query**
(`packages/database/src/search.ts`), not a new service:

1. **Index-backed core.** Add `research_study_fts_idx` — a GIN index over
   `to_tsvector('english', canonical_title || ' ' || coalesce(summary,''))`
   (migration `0012`).
2. **Query-time document for recall.** On the already-filtered PUBLISHED
   candidate set, match a composed document (title, summary, publication
   title/abstract, journal, authors, conditions, interventions) via
   `websearch_to_tsquery`.
3. **Ranking tiers (documented):** exact DOI → exact title → title/summary FTS
   rank → related-entity FTS rank; ties broken by publication date.
4. **Offset pagination** now (page size capped), with the data-access API shaped
   so keyset/cursor pagination can replace it without UI changes.
5. **RLS-authoritative boundary.** All reads run under the `anon` role, so
   PostgreSQL returns PUBLISHED rows only; the query never depends on
   client-side filtering.

No `pg_trgm`, embeddings, or vector search — deferred until real search data
justifies them (Phases 26–27).

## Consequences

- Search, filters, and facets are one aggregating query per page (no N+1),
  returning only card columns plus a total count.
- The title/summary core is GIN-backed; the broader document match may
  sequential-scan the (small, pre-filtered) candidate set at MVP scale — an
  accepted trade-off. The scale path is a trigger-maintained `search_tsv` column,
  to be introduced (with its own ADR) only when measured need appears.
- Deterministic ranking — no AI, no popularity, no efficacy weighting. Sorting
  and outcome filters use neutral "reported outcome" language and never imply
  scientific consensus.
