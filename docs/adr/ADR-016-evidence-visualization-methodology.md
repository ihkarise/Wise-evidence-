# ADR-016: Evidence Visualization — Pyramid as Navigation-not-Truth, Study-Based Counting, Valence-Neutral Encoding, No Combined Score

**Status:** Accepted — implemented (M5)
**Date:** 2026-08-29
**Related:** `docs/28-EVIDENCE-VISUALIZATION-METHODOLOGY.md`,
`docs/06-EVIDENCE-TAXONOMY.md`, `docs/07-OUTCOME-CLASSIFICATION.md`,
`docs/08-EVIDENCE-QUALITY.md`, `docs/09-CRITICISM-FRAMEWORK.md`,
`docs/15-UI-UX-SPECIFICATION.md`, `docs/03-INFORMATION-ARCHITECTURE.md`,
`docs/05-DATABASE-ARCHITECTURE.md`, `docs/16-SECURITY.md`, `docs/22-ROADMAP.md`,
`ADR-009` (PostgreSQL Search First), `ADR-004` (Static-First Public Web),
`ADR-006` (Human Review Requirement), `ADR-015` (Public Research Explorer)

## Context

Milestone 5 (`22` §7) adds the first public pages that *summarise the published
catalogue*: an evidence pyramid and descriptive distributions of outcome,
quality, and criticism (`03` §8, §16; `15` §5). This is the single most
dangerous milestone for the platform's credibility: visualization is exactly
where a research aggregator is tempted to collapse independent dimensions into a
score, colour results good/bad, or let a tall pyramid band read as "strong proof
that homeopathy works." The master prompt and domain rules forbid this outright
(`00` §4–6; master prompt §3, §5, §8, §29, §59). M5 is therefore
methodology-gated: a design checkpoint (`docs/28`) and this ADR must be settled
before any code.

The forces needing a recorded decision: (1) what a pyramid position is *allowed*
to mean; (2) what unit is counted, given `Study ≠ Publication`; (3) how a
valenced outcome spectrum is drawn without implying superiority; (4) how missing
data is handled; (5) how the aggregates stay published-only and cheap; and (6)
the hard line on scores and cross-tabs.

## Decision

1. **The evidence pyramid is a navigation/organization device only.** Position
   encodes a study *design type's* place in the versioned `taxonomy-v1`
   `evidence_level.pyramid_rank` (read from the DB, ordered by rank), and **must
   not** imply positivity, negativity, truth, treatment effectiveness, or
   scientific superiority. Every pyramid view carries a standing "position is
   organizational, not a certainty score" note; preclinical stays visibly
   non-equivalent to clinical evidence.

2. **`ResearchStudy` is the counting unit.** Every count is
   `count(distinct research_study.id)` filtered to `publication_state =
   'PUBLISHED'`. A study reported in multiple publications counts **once**; the
   `is_primary = true` publication join is used only when a publication attribute
   is required and never multiplies the study count. Publications may be shown
   separately but never inflate study counts.

3. **Separate distributions, never combined.** Outcome, quality, and criticism
   each get their own independent distribution on its own axis and panel.
   **No** efficacy/evidence/balance/positive-minus-negative/weighted/combined
   score; **no** outcome×evidence or any cross-tabulation; **no** AI-generated
   conclusion. Positive/negative/mixed/neutral are never netted into one figure.
   Criticism is never converted into, or weighed against, a negative outcome.

4. **Valence-neutral visual encoding.** The outcome spectrum is drawn in fixed
   canonical order with a neutral, non-traffic-light palette (no green-good /
   red-bad), no ordering by desirability, no size/emphasis implying quality, and
   a text label on every segment so meaning never rides on colour. The same
   neutrality applies to quality and the pyramid.

5. **Missing data is explicitly UNCLASSIFIED.** A published study with no visible
   human-reviewed value (no row, or an AI-only `final_value IS NULL` row hidden by
   RLS) is counted in an explicit `UNCLASSIFIED` / `Unassessed` bucket, **never**
   silently mapped to Neutral or any scientific value. Buckets + unclassified sum
   to the total (a tested identity).

6. **Anon RLS path, published-only, defense in depth.** All aggregates run on the
   anon `SqlExecutor` under existing M2/M3 policies (`0008`) **and** filter
   `publication_state = 'PUBLISHED'` explicitly. RLS is authoritative: AI-only
   suggestions, drafts, non-active criticism, and private tables are invisible for
   free. No new grants, policies, migration, or index are introduced; new SQL
   lives only in `packages/database` (`service/stats.ts`), never in the Astro
   layer.

7. **Descriptive, catalogue-scoped wording.** Pages state counts and shares "of
   the published catalogue," show denominators and unclassified counts, name the
   taxonomy version, link to `/methodology`, and carry a persistent "descriptive
   summary, not a scientific conclusion about whether homeopathy works" safeguard.
   Every visualization ships an equivalent accessible data table (JS-free,
   colour-independent).

## Consequences

- **Positive:** the credibility core is preserved at the most tempting surface —
  independent dimensions stay independent, a study counts once, no number on any
  page can be read as a verdict, and missing data is honest rather than flattering.
  Ordering and vocabularies are data-driven (`taxonomy-v1`), so a taxonomy re-rank
  needs no code change. Zero new infrastructure and zero recurring cost
  (free-first, Postgres-only, `ADR-009`); the same SQL + RLS run in deterministic
  PGlite tests and production. Sum-identity and study-based-counting invariants are
  test-enforced, and a structural test guards against any regression toward a
  forbidden score or cross-tab.
- **Negative / deferred:** visual neutrality (§4) is partly a human design-review
  responsibility that automated tests cannot fully certify — flagged for explicit
  sign-off. Fine-grained `evidence_quality_assessment` risk-of-bias dimensions are
  not aggregated publicly in M5 (only the coarse documented quality summary);
  per-condition/intervention distributions, `/timeline`, `/authors`, `/journals`,
  `/criticism/:slug`, and country stats are out of scope for later milestones
  (`22`). Live Supabase verification remains PENDING a provisioned project.
- **Commitments / rules out:** commits M5 to a pure descriptive-aggregation layer
  and rules out — for this milestone and as a standing constraint until a future
  ADR explicitly revisits it — any efficacy/combined score, cross-tab, AI verdict,
  popularity/voting/reputation, vector/semantic search, or advanced analytics.
- **Status:** the design was authorized and M5 is now implemented exactly to this
  decision — a PostgreSQL-only `stats.ts` aggregation layer, the `/evidence` and
  `/statistics` pages, and a reusable valence-neutral `DistributionChart`, with 21
  new deterministic tests (176 total) including a structural guard against any
  forbidden score. Live Supabase verification remains PENDING a provisioned
  project.
