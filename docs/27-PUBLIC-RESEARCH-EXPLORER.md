# WiseEvidence

## Public Research Explorer — Milestone 4 Design Checkpoint

**Document:** `docs/27-PUBLIC-RESEARCH-EXPLORER.md`
**Version:** 0.1.0
**Status:** Implemented (M4)
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `03-INFORMATION-ARCHITECTURE.md`, `14-SEARCH-ARCHITECTURE.md`,
`15-UI-UX-SPECIFICATION.md`, `05-DATABASE-ARCHITECTURE.md`,
`07-OUTCOME-CLASSIFICATION.md`, `08-EVIDENCE-QUALITY.md`, `16-SECURITY.md`,
`19-DEPLOYMENT.md`, `20-TESTING.md`, `21-COST-CONTROL.md`,
`26-MANUAL-RESEARCH-MVP.md`, `ADR-009`, `ADR-004`, `ADR-015`

---

# 0. Purpose and scope

This is the design checkpoint for **Milestone 4 — Public Research Explorer**: the
first public, read-only way to _find_ research. It adds a `/research` listing
with search, filters, sorting, pagination, and research cards, built strictly on
the existing M2/M3 architecture.

M4 introduces **no** new research model, **no** AI, **no** embeddings, **no**
vector database, **no** external search service, **no** scraping, **no**
background ingestion, and **no** evidence visualization (evidence pyramid /
statistics dashboards belong to M5). It operates **only** on PUBLISHED research
through the existing `packages/database` boundary and the existing
`/research/[id]` detail page (`26` §22).

The credibility core is preserved end to end:
`Outcome ≠ Quality ≠ Confidence ≠ Criticism`, `Evidence level ≠ efficacy`,
`Study ≠ Publication`, `Classification ≠ proof of efficacy`. Nothing in the
explorer combines those dimensions into a single score, ranks positive research
above negative, or introduces any efficacy/popularity/vote signal.

---

# 1. Where the code lives

- **Query layer** (`packages/database/src/service/search.ts`) — the only new
  business logic. Pure, framework-independent, on the shared `SqlExecutor`
  boundary. Exposes `parseSearchParams()`, `searchPublishedResearch()`, and
  `getFilterOptions()`; imports only `@wise-evidence/domain` and local modules.
- **Public page** (`apps/web/src/pages/research/index.astro`) — SSR
  (`prerender = false`) on the **anon** DB path; contains no SQL.
- **Card** (`apps/web/src/components/ResearchCard.astro`) — presentation only.
- The public detail page is **reused unchanged** from M3.

No second research table, no bypass of `packages/database`, no new SQL in the
Astro layer.

# 2. Design invariants

1. **PUBLISHED-only.** Every query filters `publication_state = 'PUBLISHED'`
   explicitly **and** runs on the anon RLS path, so the guarantee holds under
   any executor role (defense in depth). Drafts, pending, rejected, archived,
   AI, audit, review, correction and import records can never appear.
2. **PostgreSQL search only** (`14` §2, `ADR-009`). Postgres FTS + parameterized
   SQL. No AI, embeddings, vector DB, or external search service.
3. **Neutral ranking.** No efficacy score, no positive-minus-negative weighting,
   no popularity, no votes. Outcome/quality/confidence/criticism stay separate.
4. **Untrusted input.** Every search/filter value is a **bound parameter**;
   user input is never interpolated into SQL. Pagination is clamped; sort comes
   from a fixed whitelist; enum filters are validated against canonical
   vocabularies.

# 3. Public research listing

`/research` renders a page of **research cards** for PUBLISHED studies, one card
per study. The card carries only public/published fields and gives a reader
enough to decide whether to open the detail page (`03` §6): title, authors,
year, journal, study type, evidence level, reported outcome, quality summary,
conditions, interventions, DOI, and the human-authored summary. A `[DEMO]` badge
marks demo fixtures if they are visible in a test environment.

**Study ≠ Publication:** the listing joins each study to its single
`is_primary = true` publication, so a study reported in several publications
yields exactly **one** card (never duplicate rows).

# 4. PostgreSQL search strategy

- **Full-text:** the stored, GIN-indexed `publication.search_vector` (title +
  abstract, `english` config; migration `0003`, index `0007`). User text is
  compiled with `websearch_to_tsquery('english', $q)` — which safely tolerates
  quotes and operators — and ranked with `ts_rank`.
- **Metadata match:** in addition to FTS, a query also matches on author display
  name, journal name, linked condition name, and linked intervention name via
  parameterized `ILIKE` `EXISTS` subqueries (`14` §3 searchable fields).
- **Aggregation without N+1:** authors/conditions/interventions are aggregated
  with correlated `array_agg` subqueries evaluated only for the ≤ `pageSize` rows
  on the current page — one round trip, bounded work, FK-index-backed.

## 4a. DOI search

If the query normalizes to a DOI via `@wise-evidence/domain` `toCanonicalDoi()`,
the explorer does an **exact canonical-DOI match** and skips full-text ranking —
DOI matching takes priority over FTS (`14` §4). DOI canonicalization is the same
one shared with import and M3 (never duplicated).

## 4b. Title / metadata matching

Non-DOI queries run the FTS-plus-metadata predicate above. Relevance ordering is
`ts_rank` (title+abstract) with publication date and id as deterministic
tie-breakers.

# 5. Filters

Filter **options come from canonical database reference data**, not a hardcoded
UI list (`getFilterOptions()` reads `study_type`, `evidence_level`, `condition`,
`intervention`, and the distinct published years; outcome/quality use the fixed
enum vocabularies from `packages/database` constants). The documented dimensions
are preserved and kept independent (`14` §5, `03` §5):

- **study type** (`study_type.code`)
- **evidence level** (`evidence_level.code`)
- **reported outcome** (`outcome_value`) — labelled "Reported outcome", **never**
  "effectiveness"
- **evidence quality** (`quality_summary`) — methodological rigor, independent of
  outcome
- **condition** (`condition.slug`)
- **intervention** (`intervention.slug`)
- **publication year**

Multiple filters combine with AND. Enum filters are validated (unknown values are
dropped); taxonomy filters pass through as bound parameters, so an unknown
code/slug correctly matches nothing rather than leaking the whole catalogue.
`final_value` is compared as text (no enum cast), so an unexpected value can only
ever match zero rows.

Country/Source/Journal filters from `14` §5 are deferred: M3 does not populate
country, and journal/source filtering adds little at the current catalogue scale
— they can be added later without schema change.

# 6. Sorting

Only documented, neutral sorts (`14` §6): **relevance**, **newest**, **oldest**,
**title A–Z**. Sort is chosen from a fixed whitelist and mapped to a fixed
`ORDER BY`; the user string is never interpolated. Default is `relevance` when a
text query is present, else `newest`. There is deliberately **no** "most
effective", "strongest evidence", "most positive", "most successful",
popularity, or vote sort.

# 7. Pagination

Server-side `LIMIT`/`OFFSET`. `pageSize` defaults to 20 and is clamped to
`[1, 50]`; `page` is 1-based and clamped. The full catalogue is never sent to the
browser. A separate `count(*)` gives the true total; an out-of-range page returns
zero items with the correct total. All search/filter/sort parameters are
preserved across pagination links, so every view is **bookmarkable and
shareable**.

# 8. URL / query-parameter design & SEO

Query parameters: `q`, `studyType`, `evidenceLevel`, `outcome`, `quality`,
`condition`, `intervention`, `year`, `sort`, `page`, `pageSize`. The form submits
via **GET**, so state lives entirely in a shareable URL and the page works with
no JavaScript.

**SEO (`15` §10):** the canonical URL is always the bare `/research`, so the
thousands of possible filter permutations do not become thin duplicate SEO
pages. Any view that carries query parameters is served with
`<meta name="robots" content="noindex, follow">`, so search engines index only
the clean entry point while still following through to detail pages. `/research`
has its own title and description.

# 9. Database / data-access boundary

All SQL lives in `packages/database`. The Astro page calls
`searchPublishedResearch()` / `getFilterOptions()` through the same `SqlExecutor`
the tests and M3 server use. The functions hold **no** authorization of their own
— RLS decides visibility — so the public page genuinely exercises production RLS.

# 10. RLS / public visibility

The page runs on the **anon** executor (`asAnon`), under the M2/M3 SELECT
policies (`0008`): anon reads only PUBLISHED studies and their published
children, only human-reviewed (`final_value not null`) classifications, and only
ACTIVE criticism; private tables (audit, review, AI, import, corrections) are
hard-denied. The explicit `publication_state = 'PUBLISHED'` predicate is a second
gate, not the boundary. RLS remains authoritative.

# 11. Performance

- One count query + one page query per request. No N+1: per-row aggregation is
  bounded to the current page and backed by existing FK indexes.
- FTS uses the existing GIN index on `publication.search_vector`; the
  `publication_state` and FK indexes from `0007` back the joins and filters.
- Only card fields are selected — never `SELECT *`, never abstracts in the list.
- **No new index and no new migration were required.** The author/journal/
  condition/intervention `ILIKE` metadata match is not index-backed, but those
  are tiny curated reference tables; at the current free-first scale this is
  well within budget. A `pg_trgm` GIN index is the documented next step **only**
  if a measured need appears (`21`, master prompt §28) — added via migration with
  justification at that point, not speculatively.
- No Elasticsearch / Meilisearch / Algolia / vector DB / embeddings.

# 12. Security

- Every search/filter parameter is treated as untrusted and bound as a SQL
  parameter — never interpolated. Only fixed column/table names are concatenated.
- Pagination clamped; enum/taxonomy values validated; sort whitelisted.
- Errors are caught and shown as a generic message — database internals are never
  surfaced to the client (`16` §12).
- RLS is authoritative; private/unpublished records cannot leak through search
  (proven by tests, including SQL-injection-style inputs).

# 13. Accessibility (`15` §8)

- Works without JavaScript: a semantic `<form method="get">` with a `role=search`
  region, a `<fieldset>`/`<legend>` for filters, and a `<label>` for every
  control.
- Results are an ordered list; pagination is a `<nav aria-label="Pagination">`
  with real prev/next links (disabled state via `aria-disabled`), and the results
  region is `aria-live="polite"`.
- Keyboard navigable; visible focus rings; no reliance on colour alone (every
  dimension is text-labelled). Reduced-motion is respected (global CSS; no new
  animations introduced).

# 14. Empty / error / pending states

- **Pending (no DB configured):** a clear "catalogue not connected" note; the
  explorer UI still renders (matches the M1 credential-boundary pattern).
- **Error:** a generic, internal-free "something went wrong" alert.
- **Empty:** a distinct "no research matches" panel that offers to clear filters
  when filters are active, or explains an empty catalogue otherwise.

# 15. Test strategy

All M1–M3 tests are preserved. New deterministic tests
(`packages/database/test/search.test.ts`, PGlite + Supabase shim, no network, no
cost) cover: published-only results; drafts / pending / rejected / archived
excluded; exact DOI lookup (bare + URL form, and no fuzzy fallback); title,
abstract, author, journal, condition/intervention search; every filter and filter
combinations; each sort; pagination, disjoint pages, out-of-range pages, and
clamping; empty results; invalid/untrusted parameters; SQL-injection-style input
(query and filter values) proven inert; the one-study-multiple-publications
single-card guarantee; correct result counts; canonical filter options; and card
dimension separation. The realistic anon RLS path is used throughout.

# 16. Cost

Free-first (`21`): no paid services, no AI, no OpenRouter, no scraping, no
background ingestion, no vector database, no new infrastructure. Pure Postgres on
the existing stack.

# 17. Scope boundary (explicitly NOT in M4)

Evidence pyramid, statistics dashboard, positive/negative weighing, efficacy
score, AI enrichment, OpenRouter benchmarking, scraping, automated discovery,
multi-source connectors, community voting, advanced analytics — all belong to
later milestones (`22`).

# 18. Supabase pending gate

As with M2/M3 (`26` §25): the same canonical migrations/policies used in tests
deploy to Supabase unchanged, deterministic verification is done, and **live
Supabase verification remains PENDING** a provisioned project — never fabricated.
