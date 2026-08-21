# WiseEvidence
## Search Architecture

**Document:** `docs/14-SEARCH-ARCHITECTURE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `04-SYSTEM-ARCHITECTURE.md`, `05-DATABASE-ARCHITECTURE.md`, `21-COST-CONTROL.md`

---

# 1. Purpose

Define search: what is searchable, how it is filtered, and the technology
strategy. Search must not become the canonical store, and its failure must not
make research pages disappear (`04` §46).

# 2. Technology Strategy

- **MVP: PostgreSQL full-text search** (`04` §37, master prompt §28). No
  Elasticsearch, no vector database, no dedicated search cluster during MVP
  unless a measured requirement appears (`00` §16, master prompt §7, §28).
- The application calls a **search service abstraction**, so the backend can
  evolve (better FTS, then optionally semantic search) without rewriting callers
  (`04` §37).

# 3. Searchable Fields

`02` §6 / `03` §20 / `04` §37:
Title · Abstract · Authors · Journal · DOI · Conditions · Interventions ·
Keywords.

# 4. DOI Priority

If a query resembles a DOI, exact canonical-DOI matching takes priority over
full-text ranking (`03` §20). DOI canonicalization rules are shared with import
(`11` §6, `20`).

# 5. Filters

`02` §6 / `03` §5:
Study Type · Evidence Level · Outcome · Year · Condition · Intervention ·
Journal · Country · Source · Quality.

Filters operate on structured, human-reviewed classification fields (`05`, `07`,
`08`) — never on raw AI suggestions for published results.

# 6. Sorting

Relevance, recency (publication date), and evidence level ordering (pyramid rank
as *navigation*, not truth). Sort options must not imply that ordering equals
scientific validity.

# 7. Result Shape

Search returns published records only (`05` §7, enforced by RLS). Result cards
carry the fields in `03` §6 (title, authors, year, journal, study type,
condition, outcome, evidence level, short summary, DOI).

# 8. Performance & Caching

Cache popular search results and taxonomy selectively (`04` §38); do not
over-engineer caching before measuring need. Search pages must be fast on mobile
and low bandwidth (`54`).

# 9. Future (post-MVP)

Semantic search, citation-graph-aware ranking, and multilingual search are P3
(`02` §12) and require their own ADR + cost justification before adoption. A
vector database is not introduced without a demonstrated requirement (master
prompt §28).

# 10. Milestone 4 Implementation (ADR-014)

The public explorer (`/research`) is implemented in
`packages/database/src/search.ts`:

- **`searchPublishedResearch`** — one parameterized query per page: FTS over a
  composed document (title, summary, publication title/abstract, journal,
  authors, conditions, interventions) via `websearch_to_tsquery`, plus
  exact-DOI matching. Ranking tiers: exact DOI → exact title → title/summary FTS
  → related-entity FTS; ties by publication date. Filters (study type, evidence
  level, outcome, quality, condition, intervention, year) apply on canonical
  relations. Sorts: relevance/newest/oldest/title. Offset pagination (page size
  capped), keyset-ready API.
- **`getPublishedResearchFacets`** — facet options present among PUBLISHED
  research for the filter controls.
- **`normalizeExplorerParams`** — enum/integer validation of query-string input.
- Index-backed by `research_study_fts_idx` (GIN, migration `0012`).
- All reads run under the `anon` RLS role → PUBLISHED only; multi-publication
  studies de-duplicated to one card. Deterministic — no AI, popularity, or
  efficacy weighting. Scale path (trigger-maintained `search_tsv`) is deferred.
