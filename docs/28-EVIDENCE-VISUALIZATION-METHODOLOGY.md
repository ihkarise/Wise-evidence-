# WiseEvidence

## Evidence Visualization Methodology — Milestone 5 Design Checkpoint

**Document:** `docs/28-EVIDENCE-VISUALIZATION-METHODOLOGY.md`
**Version:** 0.1.0
**Status:** Implemented (M5)
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `03-INFORMATION-ARCHITECTURE.md`, `06-EVIDENCE-TAXONOMY.md`,
`07-OUTCOME-CLASSIFICATION.md`, `08-EVIDENCE-QUALITY.md`,
`09-CRITICISM-FRAMEWORK.md`, `14-SEARCH-ARCHITECTURE.md`,
`15-UI-UX-SPECIFICATION.md`, `05-DATABASE-ARCHITECTURE.md`, `16-SECURITY.md`,
`17-DATA-GOVERNANCE.md`, `20-TESTING.md`, `21-COST-CONTROL.md`, `22-ROADMAP.md`,
`26-MANUAL-RESEARCH-MVP.md`, `27-PUBLIC-RESEARCH-EXPLORER.md`, `ADR-009`,
`ADR-004`, `ADR-015`, `ADR-016`

---

# 0. Purpose, status, and gate

This is the **design checkpoint** for **Milestone 5 — Evidence Visualization**
(`22` §7). M5 adds the first public pages that *summarise the published
catalogue* — an evidence pyramid as navigation, and descriptive distributions of
outcome, quality, and criticism — plus the `/evidence`, `/evidence/[slug]`, and
`/statistics` routes from the information architecture (`03` §8, §16).

**M5 was methodology-gated.** This checkpoint defined the methodology, the exact
counting rules, the data-access surface, the visual/accessibility contract, and
the honesty safeguards so those decisions were reviewable *before* any pixel was
drawn. It (and `ADR-016`) were explicitly authorized, and M5 is now **implemented
exactly as specified here** — `packages/database/stats.ts` (+ tests), the
`/evidence` and `/statistics` pages, and the reusable `DistributionChart` /
`StatDisclaimer` components. The section numbering below is the normative contract
the implementation follows.

M5 introduces **no** new research model, **no** AI, **no** embeddings, **no**
vector database, **no** scraping, **no** background ingestion, **no** new mutable
state, and **no** score of any kind. It reads **only** PUBLISHED research through
the existing `packages/database` boundary and the existing anon RLS path, exactly
as M4 does.

The credibility core holds end to end and is the whole point of this milestone:

```text
Pyramid position  ≠ positivity ≠ negativity ≠ truth ≠ effectiveness ≠ superiority
Outcome           ≠ Evidence level ≠ Evidence quality ≠ Confidence ≠ Criticism
Criticism         ≠ Negative outcome
Study             ≠ Publication         (a study counts ONCE)
Missing outcome   = UNCLASSIFIED        (never silently mapped to Neutral)
Descriptive summary of a catalogue ≠ a scientific conclusion about homeopathy
```

---

# 1. The eighteen methodology definitions

This section is the normative core. Every later section (routes, functions,
tests) implements what is defined here.

## 1.1 Evidence pyramid methodology

The evidence pyramid is a **navigation and organization device** (`06` §4,
`03` §8, `04` §19). It groups published studies by their `EvidenceLevel` so a
reader can move *Home → Evidence → Study Type → Research* (`03` §27). It is a
table of contents drawn as a triangle, nothing more.

It is built from the versioned `taxonomy-v1` `evidence_level` reference rows
(`06` §4, migration `0009`), whose `pyramid_rank` is stored explicitly as
"ordering only, never certainty" (`0002`). A study's pyramid band is derived from
its **human-final** `research_study.study_type_id → study_type.evidence_level_id`
(`05` §4). The mapping `StudyType → EvidenceLevel` is explicit and versioned
(`06` §4); the visualization never re-derives it heuristically.

## 1.2 Evidence-level ordering

The ten bands and their ranks are fixed by `taxonomy-v1` (`0009`):

```text
Rank 1  META_ANALYSIS       Meta-analysis
Rank 2  SYSTEMATIC_REVIEW   Systematic Review
Rank 3  RCT                 Randomized Controlled Trial
Rank 4  CONTROLLED_TRIAL    Controlled Trial
Rank 5  OBSERVATIONAL       Observational (cohort / case-control / cross-sectional)
Rank 6  CASE_SERIES         Case Series
Rank 7  CASE_REPORT         Case Report
Rank 8  PRECLINICAL         Preclinical (animal / in-vitro)
Rank 9  EXPERT_OPINION      Expert Opinion / Narrative
Rank 10 OTHER               Other / Unclassified
```

Ordering comes **only** from `evidence_level.pyramid_rank ASC`, read from the
database — never a hardcoded UI list, never re-sorted by count or outcome. If
`taxonomy-v2` re-ranks a band, the pyramid re-orders automatically with no code
change (`06` §9).

## 1.3 Meaning of pyramid position — NON-NEGOTIABLE

A higher band means **only** "this study *design type* is conventionally placed
higher in the methodological-navigation hierarchy." Position **must not** imply,
by wording, ordering, colour, size, or adjacency:

- positivity or negativity of results,
- that the evidence is true, or that homeopathy is or is not effective,
- treatment effectiveness of any intervention,
- scientific superiority of one study over another.

Preclinical evidence is browsable but is **not** rank-equivalent to clinical
trial evidence, and that distinction stays visible (`06` §5). Every pyramid view
carries the standing disclaimer (§1.14) that position is organizational, and a
per-band tooltip/definition repeats it. A tall band is a *large section of the
catalogue*, not *strong evidence for a conclusion*.

## 1.4 Study-based counting

**`ResearchStudy` is the counting unit** (`05` §2, §4). Every count in every M5
visualization is a count of *distinct published studies*, produced by
`count(distinct research_study.id)` (or an equivalent one-row-per-study grouping)
filtered to `publication_state = 'PUBLISHED'`. No visualization counts
publications, classifications, criticism rows, authors, or DOIs as if they were
studies.

## 1.5 Study vs Publication counting — NON-NEGOTIABLE

A study reported in several publications (preprint + journal article + secondary
analysis) **counts as exactly one study** (`05` §2). Where a publication
attribute is needed (e.g. publication year for the `/statistics` "by year"
breakdown), the query joins the single `publication.is_primary = true` row, so a
multi-publication study contributes one row, never several — the same guard the
M4 explorer uses (`27` §3). Publications MAY be displayed separately on a detail
surface, but the study-count aggregates never include a non-primary publication.
"Publications by year" (`03` §16), when shown, is explicitly labelled as a
*publication* count and visually separated from every *study* count so the two
are never conflated.

## 1.6 Outcome distribution

The outcome distribution shows **how many published studies carry each reported
outcome value** — "what the catalogue reports," never "how well homeopathy
works" (`07` §1, `15` §5). It is a count of distinct studies grouped by the
human-reviewed `classification.final_value` on the `OUTCOME` dimension (`05` §9),
across the full documented spectrum (§1.7). It is presented as parallel,
independent categories — never summed, subtracted, netted, or reduced to a
single figure (see §1.11 and §1.18).

## 1.7 The complete documented outcome spectrum

All seven documented outcome categories are always represented, in their
canonical stored order (`07` §2), even when a category's count is zero (an empty
category is shown as `0`, never omitted — omission would distort the picture):

```text
STRONG_POSITIVE   Strong Positive
POSITIVE          Positive
LEANING_POSITIVE  Mixed / Leaning Positive
NEUTRAL_INCONCLUSIVE  Neutral / Inconclusive
LEANING_NEGATIVE  Mixed / Leaning Negative
NEGATIVE          Negative
STRONG_NEGATIVE   Strong Negative
```

Plus a distinct, non-scientific **Unclassified** bucket (§1.8). Supportive,
mixed, neutral, inconclusive, and critical findings are all first-class — never a
positive-vs-negative binary (`07` §1).

## 1.8 Unclassified handling — NON-NEGOTIABLE

A published study with **no visible human-reviewed outcome** is counted as
**UNCLASSIFIED**, shown as its own explicitly-labelled category, and **never**
silently folded into `NEUTRAL_INCONCLUSIVE` or any other scientific value
(`07` §2). "No visible outcome" means, on the anon path, either: no `OUTCOME`
`classification` row for the study, or a row whose `final_value is null` (which
anon RLS hides — `0008` `class_read_published`). Both resolve to Unclassified via
a `LEFT JOIN … IS NULL` count, so the distribution's category counts always sum
to the total published-study count. `UNCLASSIFIED` is described as "not yet
assessed," never as a scientific outcome (`07` §2), and is visually distinct from
the seven real categories (e.g. hatched/neutral-grey, set apart).

## 1.9 Quality distribution

Evidence **quality** has its **own** distribution, entirely separate from outcome
(`08` §1–2). It counts distinct published studies grouped by the human-reviewed
coarse quality summary `classification.final_value` on the `QUALITY` dimension
(`HIGH | MODERATE | LOW | UNCLEAR`; `08` §4, `constants.ts`
`QUALITY_SUMMARIES`), with a separate **Unassessed** bucket for studies lacking a
visible quality value (same `LEFT JOIN … IS NULL` rule as §1.8). It is presented
as a descriptive aggregation of methodology, explicitly *not* a validated
scientific score of truth (`08` §4), and never combined with outcome (a positive
study is not automatically high quality; `08` §1). The finer per-dimension
`evidence_quality_assessment` rows (risk-of-bias style, `08` §3) are **not**
aggregated into a public chart in M5 (§1.18 / §14); only the coarse documented
summary is shown.

## 1.10 Criticism distribution

Criticism has its **own** distribution (`09` §1). Two independent breakdowns, both
counting **distinct published studies that carry at least one ACTIVE criticism**
in a bucket (never counting criticism *rows*, which would let one heavily-annotated
study dominate):

- **By category** — the twelve `criticism_category` values (`09` §2).
- **By origin** — the four `criticism_origin` values, kept visibly distinguishable
  (`AUTHOR_REPORTED`, `EXTERNAL_PUBLICATION`, `REVIEWER_ASSESSED`, `AI_SUGGESTED`;
  `09` §3). Author-reported limitations, reviewer assessments, and AI suggestions
  are **never** merged into an anonymous "criticism" blob.

Only `status = 'ACTIVE'` criticism on PUBLISHED research is counted (withdrawn /
superseded is retained for history but not shown; `09` §5, `0008`
`crit_read_published`). A "studies with no criticism" figure MAY accompany the
breakdown for honest context.

## 1.11 Criticism ≠ negative outcome — NON-NEGOTIABLE

Criticism is **never** converted into, weighted against, or displayed as a
negative outcome (`09` §4). The criticism distribution lives on its own axis and
its own panel. Nothing in M5 subtracts criticism from a positive result,
"downgrades" an outcome because a study attracted criticism, or co-locates
criticism and outcome in a way that reads as arithmetic. A study may be
`STRONG_POSITIVE` and carry substantial criticism; both facts are shown, side by
side, unreconciled.

## 1.12 Valence-neutral visual encoding — NON-NEGOTIABLE

Outcome categories have a valence *spectrum* (positive … negative), but the
visualization **must not** encode that spectrum so that one category looks
scientifically superior, more correct, or more desirable (`15` §6, master prompt
§29). Concretely:

- **No good/bad colour semantics.** No green-for-positive / red-for-negative
  traffic-light palette. Outcome categories use a single perceptually-uniform,
  *diverging-but-neutral* ramp (e.g. one hue lightening toward the neutral centre
  and a *different, non-judgemental* hue toward the other pole) whose endpoints
  are not culturally "success" and "failure" colours. Colour is decorative; the
  data is legible in greyscale.
- **No ordering by desirability.** Bars/segments follow the fixed canonical
  spectrum order (§1.7), not "best first."
- **No size/emphasis implying quality.** A larger positive bar means "more studies
  reported this," shown identically to a larger negative bar.
- **Text label always present** on every segment (the outcome label), so meaning
  never rides on colour alone (`15` §8).
- The same neutrality rules apply to quality (Unclear/Low are not "red") and to
  the pyramid (higher bands are not "greener").

## 1.13 Accessibility representation

Every visualization ships with a **non-visual, non-colour equivalent** that
carries the same information (`03` §24, `15` §8, `20` a11y):

- A semantic data **`<table>`** (or an ordered `<dl>`) with band/category, study
  count, and percentage — the table is the source of truth; the chart is a
  progressive enhancement rendered from the same numbers.
- Charts are inline SVG with `role="img"` and a full `<title>`/`<desc>`, or are
  simply CSS-sized bars with visible numeric labels; no canvas, no chart that is
  invisible to a screen reader.
- No information conveyed by colour alone (§1.12); every segment is text-labelled.
- Keyboard navigable, visible focus, sufficient contrast, `prefers-reduced-motion`
  respected (no count-up animations for users who opt out). Works with JavaScript
  disabled — the server renders the table and the static bars (`ADR-004`,
  static-first).

## 1.14 Statistical wording

All wording is descriptive and catalogue-scoped, never inferential (`15` §6,
`13` §5, master prompt §59). Mandatory language rules:

- Say "**N published studies in this catalogue** reported X," never "X% of
  studies prove/show/confirm…".
- Never "efficacy," "effectiveness," "success rate," "proof," "evidence that
  homeopathy works," or "net positive."
- Percentages are "share **of the published catalogue**," always shown next to the
  raw count and the total denominator, with the denominator stated.
- Counts of `UNCLASSIFIED`/`Unassessed` are shown, so the reader sees coverage
  gaps rather than a falsely complete picture.
- Every page states the taxonomy version (`taxonomy-v1`) and links to
  `/methodology` (`03` §17).

## 1.15 Public interpretation safeguards

Each M5 page carries a persistent, unmissable note, e.g.:

> *This is a descriptive summary of the studies currently published in the
> WiseEvidence catalogue. It describes what has been indexed and classified —
> it is **not** a scientific conclusion about whether homeopathy works, and study
> counts are not a measure of scientific certainty (`00` §6). Outcome, evidence
> level, quality, and criticism are separate dimensions and are shown separately.*

The pyramid additionally carries the §1.3 note; the outcome distribution the
"reported, not proven" note (`15` §5); the quality distribution the "descriptive
aggregation, not a truth score" note (`08` §4). No page presents a headline
number that could be read as a verdict.

## 1.16 RLS / public-data boundary

M5 changes **nothing** about security. All aggregates run on the **anon**
`SqlExecutor` (`asAnon`), under the exact M2/M3 SELECT policies (`0008`), and
**also** filter `publication_state = 'PUBLISHED'` explicitly (defense in depth,
identical to `27` §2/§10). Consequences that fall out of RLS *for free* and are
relied upon rather than re-implemented:

- Only PUBLISHED studies and their published children are counted; drafts,
  pending, rejected, archived never appear in any total.
- Only human-reviewed classifications (`final_value not null`) are visible, so an
  AI-only suggestion can never enter a public distribution — it counts as
  Unclassified/Unassessed instead (§1.8).
- Only ACTIVE criticism on published research is visible.
- Private tables (`ai_job`, `ai_result`, `review`, `correction`, `audit_log`,
  `import_*`, `app_user`) are hard-denied and are never touched by an aggregate.

The aggregate functions hold **no** authorization of their own; RLS is
authoritative, so the public pages genuinely exercise production RLS.

## 1.17 Performance strategy

Free-first, Postgres-only (`21`, `ADR-009`). The aggregate pages are read-mostly
and change only when a study is published, so:

- Each distribution is **one grouped aggregate query** (`GROUP BY … count`), not
  N+1 and not a full-catalogue transfer to the browser. Denominators come from
  the same or one extra `count` query.
- Queries are backed by existing indexes from `0007` (`publication_state`, the FK
  indexes on `classification.study_id`, `criticism.study_id`,
  `study_type.evidence_level_id`). **No new index and no new migration** are
  expected; a covering index is added later only on a *measured* need, via
  migration with justification (`21`, master prompt §28) — never speculatively.
- Server-rendered, cacheable static output (`ADR-004`); results can carry an HTTP
  `Cache-Control`/s-maxage and, if ever needed, an in-process short TTL — deferred
  until measured. No client-side data fetching, no chart library bundle shipped
  for the base view.
- Bounded output: the pyramid is ≤ 10 rows, outcome ≤ 8, quality ≤ 5, criticism
  ≤ 12 + 4 — all tiny, fixed-cardinality result sets.

## 1.18 Explicit exclusions — what M5 does NOT build

Prohibited outright (violates the credibility core; master prompt §3, §5, §8,
§59, and this task's non-negotiables):

- **No efficacy score, evidence score, positive/negative score, balance meter,
  positive-minus-negative calculation, weighted efficacy, or any combined score.**
- **No outcome × evidence cross-tabulation** and no outcome × quality / outcome ×
  criticism cross-tab. Each dimension is shown on its own axis only.
- **No AI-generated conclusion**, no automated verdict, no "what this means."
- **No popularity weighting, community voting, upvotes, or reputation** (`13` §2).
- **No vector/semantic search, embeddings, or external search service**
  (`ADR-009`).
- **No advanced analytics**: no trend inference, no citation graph, no
  correlations, no forecasting, no per-author/per-journal quality ranking.
- **No collapsing** of positive/negative/mixed/neutral into one figure.
- **No silent mapping** of missing data to a scientific value.

Deferred (legitimate future work, not in M5): per-condition / per-intervention
mini-distributions on `/conditions/:slug` and `/interventions/:slug` (`03` §9–10)
beyond a simple count; `/timeline` (`03` §15); `/criticism/:slug`,
`/authors`, `/journals` pages; aggregation of the fine-grained
`evidence_quality_assessment` risk-of-bias dimensions; publication-by-country
stats (country is not yet populated, `27` §5).

---

# 2. Where the code will live (proposed)

Mirrors the M4 shape exactly (`27` §1), so the boundary is unchanged:

- **Aggregate query layer** — new `packages/database/src/service/stats.ts`. The
  only new business logic: pure, framework-independent, on the shared
  `SqlExecutor` boundary; imports only `@wise-evidence/domain`/local constants;
  contains **all** SQL. No score, no cross-tab — enforced by construction and by
  tests.
- **Public pages** (Astro SSR, `prerender = false`, anon DB path, no SQL):
  `apps/web/src/pages/evidence/index.astro` (pyramid + overview),
  `apps/web/src/pages/evidence/[slug].astro` (one band → its studies, reusing the
  M4 explorer listing/cards), `apps/web/src/pages/statistics/index.astro`
  (outcome + quality + criticism distributions).
- **Presentation components** (no SQL, no data logic):
  `EvidencePyramid.astro`, `DistributionChart.astro` (renders a passed-in
  count array as accessible table + neutral bars), `StatDisclaimer.astro`.
  Reuse `ResearchCard.astro` and `labels.ts` unchanged.
- **Homepage** (`index.astro`) MAY embed a compact pyramid + outcome summary
  (`03` §3) rendered from the same functions.

No second aggregate table, no bypass of `packages/database`, no new SQL in the
Astro layer, no new mutable state.

---

# 3. Proposed routes

| Route | Purpose | Rendering |
|-------|---------|-----------|
| `/evidence` | Evidence pyramid (navigation) + catalogue overview counts | SSR, anon, static-cacheable |
| `/evidence/[slug]` | One evidence band → its published studies (reuses M4 listing/cards) | SSR, anon |
| `/statistics` | Outcome / quality / criticism distributions + definitions | SSR, anon, static-cacheable |
| `/` (home) | Compact pyramid + outcome overview embed (optional) | SSR/prerender, anon |

`[slug]` is an `evidence_level.code` (lower-cased), validated against the
canonical vocabulary; an unknown slug → 404 (never an unfiltered dump). `/research`
and `/research/[id]` are reused unchanged.

---

# 4. Proposed data-access functions (`packages/database/src/service/stats.ts`)

All return plain count arrays; **none** returns or computes a score, ratio-verdict,
or cross-tab. All run published-only on the anon executor.

```ts
// One row per evidence band, ordered by pyramid_rank ASC, INCLUDING zero-count
// bands and an explicit "unclassified" band for studies with no study_type.
getEvidencePyramid(db): Promise<{ code; label; rank; studyCount }[]>

// Distinct published studies grouped by human-reviewed OUTCOME final_value across
// ALL seven canonical categories (zero-filled) PLUS an explicit UNCLASSIFIED
// bucket; also returns the total published-study denominator.
getOutcomeDistribution(db): Promise<{ buckets: { value; studyCount }[]; total }>

// Distinct published studies grouped by human-reviewed QUALITY summary across the
// four documented values (zero-filled) PLUS an explicit UNASSESSED bucket; + total.
getQualityDistribution(db): Promise<{ buckets: { value; studyCount }[]; total }>

// Distinct published studies carrying >=1 ACTIVE criticism, grouped by category
// and (separately) by origin; zero-filled across the fixed vocabularies; + the
// count of published studies with no active criticism, + total.
getCriticismDistribution(db): Promise<{
  byCategory: { value; studyCount }[];
  byOrigin:   { value; studyCount }[];
  studiesWithNoCriticism; total;
}>

// Small catalogue overview for the pyramid/home header (all study-counts).
getCatalogueOverview(db): Promise<{ publishedStudies; publishedPublications; ... }>
```

Zero-filling is done against the canonical vocabularies in `constants.ts`
(`OUTCOME_VALUES`, `QUALITY_SUMMARIES`, `CRITICISM_CATEGORIES`,
`CRITICISM_ORIGINS`) and the `evidence_level` rows, so a category with no studies
still appears as `0` (§1.7). Counting uses `count(distinct s.id)` with
`s.publication_state = 'PUBLISHED'` and `LEFT JOIN … IS NULL` for the
unclassified/unassessed buckets.

---

# 5. Exact counting methodology (query shape)

**Base set (every aggregate):** distinct `research_study s` where
`s.publication_state = 'PUBLISHED'` (RLS + explicit predicate). The counting unit
is `s.id`. A primary-publication join (`publication p on p.study_id = s.id and
p.is_primary = true`) is added only when a publication attribute is needed
(year); it never multiplies the study count (§1.5).

- **Pyramid:** `LEFT JOIN study_type st ON st.id = s.study_type_id LEFT JOIN
  evidence_level el ON el.id = st.evidence_level_id`, then
  `count(distinct s.id) GROUP BY el.code`; studies with `study_type_id IS NULL`
  fall into the explicit `OTHER/UNCLASSIFIED` band; result right-joined against
  all 10 `evidence_level` rows so empty bands show `0`, ordered by
  `pyramid_rank`.
- **Outcome:** `LEFT JOIN classification oc ON oc.study_id = s.id AND
  oc.dimension = 'OUTCOME'` (anon RLS already restricts visible rows to
  `final_value not null`), `count(distinct s.id) GROUP BY oc.final_value`; a
  `NULL` final_value → `UNCLASSIFIED` bucket; zero-filled across the seven
  canonical values so the buckets sum to the total.
- **Quality:** identical shape on `dimension = 'QUALITY'`; `NULL` → `Unassessed`;
  zero-filled across `HIGH|MODERATE|LOW|UNCLEAR`.
- **Criticism (category):** `count(distinct s.id)` where
  `EXISTS (select 1 from criticism cr where cr.study_id = s.id and
  cr.status='ACTIVE' and cr.category = :cat)`, evaluated per category and
  zero-filled; **studies**, not rows, so annotation volume cannot skew it. Origin
  breakdown is the same with `cr.origin`.
- **Denominators:** a single `count(distinct s.id)` over the base set; every
  percentage divides by it and is displayed with the raw count (§1.14).

Sums are self-checking: outcome buckets + `UNCLASSIFIED` == total; quality
buckets + `Unassessed` == total. A test asserts these identities (§8).

---

# 6. Taxonomy handling

- Pyramid bands, labels, and order come from the `evidence_level` table
  (`taxonomy-v1`), not a hardcoded list; `study_type → evidence_level` mapping is
  read from the DB (`06` §4). A `taxonomy-v2` re-rank/rename flows through with no
  UI change; a re-classification creates a new classification with provenance and
  never rewrites history (`06` §2, §9).
- Outcome/quality vocabularies come from the canonical `constants.ts` enums
  (single source of truth mirroring the Postgres enums), so the displayed spectrum
  cannot drift from the stored one.
- The `taxonomy-v1` version string is shown on each page (`§1.14`).

---

# 7. Visualization design

- **Pyramid:** a stack of full-width horizontal bands, widest visual band = Rank 1
  at the top down to Rank 10, each band labelled with its name, study count, and
  share; each band links to `/evidence/[slug]`. Width/emphasis encodes *rank
  position in the taxonomy*, not certainty; the band's study count is a separate
  printed number. Neutral single-hue fill (§1.12). Persistent §1.3 + §1.15 notes.
- **Distributions:** horizontal bar rows (label · bar · count · %) rendered as an
  accessible table first, bars as CSS-width/inline-SVG enhancement. Outcome uses
  the fixed spectrum order with the neutral diverging ramp; Unclassified set apart
  (§1.8, §1.12). Quality and criticism are independent panels with their own
  headers and their own disclaimers — never interleaved with outcome, never
  cross-tabbed.
- **No** pie chart implying a whole-truth, **no** gauge/meter, **no** single
  headline verdict number, **no** animation that implies momentum.

---

# 8. Test strategy

Deterministic PGlite + Supabase shim, no network, no cost — extending the existing
`packages/database/test` suite (`20`, `27` §15). New `stats.test.ts` covers:

- **Study-based counting:** a study with **multiple publications** counts once in
  every aggregate (the core `Study ≠ Publication` guarantee).
- **Published-only:** draft / pending / rejected / archived studies and their
  classifications/criticism never appear in any count (asserted on the anon path).
- **Unclassified:** a published study with no OUTCOME row, and one with a
  `final_value IS NULL` OUTCOME row (AI-only), both land in `UNCLASSIFIED`, never
  in `NEUTRAL_INCONCLUSIVE`; identical assertion for quality `Unassessed`.
- **Sum identities:** outcome buckets + Unclassified == total; quality + Unassessed
  == total; per-band pyramid counts sum to total.
- **Full spectrum:** all seven outcome categories and all quality/criticism
  vocabularies are present even at count 0 (zero-fill).
- **Criticism:** counted by distinct study not by row (a study with 3 active
  criticisms in one category counts once); withdrawn/superseded excluded; origin
  and category breakdowns independent; criticism never alters an outcome count.
- **Pyramid:** bands ordered by `pyramid_rank`; `study_type_id IS NULL` →
  Other/Unclassified band; mapping read from DB.
- **RLS honesty:** the anon executor is used throughout, so AI-only suggestions
  and private tables are provably invisible.
- **No-score invariants:** a structural test asserts `stats.ts` exposes no
  function returning a combined/efficacy/net figure and builds no cross-tab (guard
  against regression toward a forbidden score).

Web-layer: a11y test (`20`) that each visualization renders a data table and
text labels with JS disabled, and that no outcome relies on colour alone. All
M1–M4 tests preserved.

---

# 9. SEO

Per `15` §10 / `03` §25. `/evidence` and `/statistics` are canonical, indexable
entry points with their own title/description/Open Graph and sitemap inclusion.
`/evidence/[slug]` band pages are canonical per band. Any parameterized/filtered
view served through the reused explorer stays `noindex, follow` (`27` §8).
Structured data only where genuinely appropriate; **no** mass-generated thin
pages (master prompt §56). Numbers on the page are catalogue-descriptive so the
snippet cannot read as a medical claim.

---

# 10. Mobile behavior

`03` §24 / `15` §9. The pyramid and bars are full-width, single-column,
touch-friendly stacks on narrow viewports; the data **table** is the graceful
degradation target and remains fully readable. No horizontal scroll on the body;
any wide table scrolls inside its own container. Reduced-motion honoured. Search,
Research, Explore, Evidence stay prioritized in navigation.

---

# 11. Error / pending states

Mirrors M4 (`27` §14):

- **Pending (no DB configured):** a clear "catalogue not connected" note; the page
  chrome and disclaimers still render (M1 credential-boundary pattern).
- **Error:** a generic, internal-free "something went wrong" message; DB internals
  never surfaced (`16` §12).
- **Empty catalogue:** every band/category shows `0` with an honest "no published
  research yet" panel — an empty catalogue is shown truthfully, never hidden or
  faked.

---

# 12. Security / RLS

Restated for the checkpoint: anon executor + explicit `publication_state =
'PUBLISHED'`; RLS authoritative (§1.16). All identifiers/slugs bound as
parameters and validated against canonical vocabularies (no interpolation, same
posture as `27` §12). Aggregates read only the public-readable tables; no private
table is queryable on this path. No new grants, no new policies, no RLS change.

---

# 13. Future extensibility

- Per-condition / per-intervention distributions reuse the same `stats.ts`
  functions with an added `study_id IN (studies for this slug)` filter — no new
  model.
- A `taxonomy-v2` re-rank flows through unchanged (data-driven ordering).
- If aggregates ever become slow at scale, a materialized view or covering index
  is added **via migration with a measured justification** (`21`) — the function
  signatures stay stable.
- The distribution component is generic (`{label, count}[]`), so new descriptive
  breakdowns (e.g. study-type counts on `/statistics`, `03` §16) drop in without
  new infrastructure. None of this relaxes §1.18.

---

# 14. Scope boundary — explicitly NOT in M5

Repeats §1.18 as the milestone gate: no efficacy/evidence/balance/combined score
of any kind; no outcome×evidence (or any) cross-tab; no AI conclusion; no
popularity/voting/reputation; no vector/semantic search; no advanced analytics or
trend inference; no aggregation of fine-grained risk-of-bias dimensions into a
public score; no country stats; no `/timeline`, `/authors`, `/journals`,
`/criticism/:slug` pages; no new migration expected. These belong to later
milestones (`22`) and, where they touch public interpretation, need their own ADR.

---

# 15. Supabase pending gate

As with M2/M3/M4 (`26` §25, `27` §18): the same canonical migrations/policies used
in tests deploy to Supabase unchanged; deterministic PGlite verification is
authoritative for correctness; **live Supabase verification remains PENDING** a
provisioned project and is never fabricated.

---

# 16. Milestone checkpoint summary (pre-implementation)

- **Completed (this deliverable):** the M5 methodology + design checkpoint and
  `ADR-016`. No application code.
- **Files (proposed, on authorization):** `packages/database/src/service/stats.ts`
  (+ export in `index.ts`); `packages/database/test/stats.test.ts`;
  `apps/web/src/pages/evidence/index.astro`, `evidence/[slug].astro`,
  `statistics/index.astro`; `EvidencePyramid.astro`, `DistributionChart.astro`,
  `StatDisclaimer.astro`; optional home embed; nav update.
- **Tests (proposed):** §8 — study-based counting, published-only, unclassified,
  sum identities, full spectrum, criticism-by-study, pyramid ordering, RLS honesty,
  no-score invariant, a11y.
- **Database changes:** none expected (no new migration/index).
- **Architecture decisions:** `ADR-016` — pyramid as navigation-not-truth,
  study-based counting, valence-neutral encoding, no combined score, separate
  distributions on the anon RLS path.
- **Known issues / risks:** live Supabase verification PENDING; visual-neutrality
  is a design-review responsibility (§1.12) that automated tests can only partly
  guard — flagged for human sign-off.
- **Cost impact:** zero. Free-first, Postgres-only, no AI, no new infrastructure.
- **Security:** unchanged; RLS authoritative; anon path; no new grants/policies.
- **Next (smallest step):** on explicit authorization, implement `stats.ts` +
  `stats.test.ts` first (pure, testable, no UI), review the counting against §5,
  then build `/evidence` and `/statistics`.

**STOP.** No M5 application code is written until this checkpoint and `ADR-016`
are explicitly authorized.
