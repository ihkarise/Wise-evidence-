# ADR-015: Public Research Explorer — PostgreSQL Query Layer, Published-Only via RLS, Canonical-URL SEO

**Status:** Accepted
**Date:** 2026-08-29
**Related:** `docs/27-PUBLIC-RESEARCH-EXPLORER.md`, `docs/14-SEARCH-ARCHITECTURE.md`,
`docs/03-INFORMATION-ARCHITECTURE.md`, `docs/15-UI-UX-SPECIFICATION.md`,
`ADR-009` (PostgreSQL Search First), `ADR-004` (Static-First Public Web),
`ADR-013` (Database Foundation), `ADR-014` (Manual Research MVP)

## Context

Milestone 4 adds the first public way to _find_ research: a `/research` explorer
with search, filters, sorting, pagination, and research cards. It must build on
the existing M2 schema and M3 data-access/RLS architecture without inventing a
second research model, and must not violate the credibility core
(`Outcome ≠ Quality ≠ Confidence ≠ Criticism`, `Evidence level ≠ efficacy`,
`Study ≠ Publication`). The search technology is already decided (`ADR-009`:
PostgreSQL FTS first, no Elasticsearch/vector DB during MVP). Two forces needed a
recorded decision: (1) how the public search stays provably published-only and
injection-safe, and (2) how a large filter space avoids becoming thin duplicate
SEO pages.

## Decision

1. **One PostgreSQL query layer in `packages/database`** (`service/search.ts`) on
   the existing `SqlExecutor` boundary — `parseSearchParams()`,
   `searchPublishedResearch()`, `getFilterOptions()`. No SQL in the Astro layer;
   no second research table; no bypass of `packages/database`.
2. **Published-only, defense in depth.** The public page runs on the **anon** RLS
   path (RLS is authoritative), and every query _also_ filters
   `publication_state = 'PUBLISHED'` explicitly, so the function is correct under
   any executor role.
3. **PostgreSQL FTS + parameterized metadata match.**
   `websearch_to_tsquery`/`ts_rank` over the stored `publication.search_vector`
   (title+abstract), plus parameterized `ILIKE` `EXISTS` matches on
   author/journal/condition/intervention. Exact canonical-DOI matching (reusing
   `@wise-evidence/domain`) takes priority over FTS. No AI, embeddings, vector
   DB, external search service, popularity, votes, or efficacy score.
4. **All input is bound parameters.** User values are never interpolated into
   SQL; only fixed column/table names are concatenated. Pagination is clamped
   (`pageSize ≤ 50`), sort is whitelisted, enum filters are validated, and
   `classification.final_value` is compared as text so unexpected values match
   nothing. Filter options are loaded from canonical reference data, not
   hardcoded.
5. **One card per study.** The listing joins each study to its single
   `is_primary = true` publication, so `Study ≠ Publication` holds and a
   multi-publication study never duplicates.
6. **Canonical-URL SEO.** State lives in GET query parameters (bookmarkable,
   JS-free). The canonical URL is always the bare `/research`; any parameterized
   view is `noindex, follow`, so the filter permutation space is not turned into
   thin duplicate SEO pages.
7. **No new index / no new migration.** Existing GIN + FK + `publication_state`
   indexes suffice at current scale; a `pg_trgm` index is deferred to a measured
   need and would ship via migration with justification.

## Consequences

- **Positive:** the exact same SQL + RLS run in tests and production; the
  published-only and injection-safety guarantees are proven by deterministic
  PGlite tests (including SQL-injection-style inputs). The credibility core is
  preserved — cards show separate, labelled dimensions with no combined score.
  Zero new infrastructure and zero recurring cost (free-first). URLs are shareable
  without polluting search indexes.
- **Negative / deferred:** the author/journal/condition/intervention `ILIKE`
  metadata match is not index-backed — acceptable for small curated reference
  tables now, revisited with a trigram index only on a measured need.
  Country/Source/Journal filters and semantic/multilingual search are out of
  scope (later milestones). Live Supabase verification remains PENDING a
  provisioned project.
