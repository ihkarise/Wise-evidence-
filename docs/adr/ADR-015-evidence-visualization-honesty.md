# ADR-015: Evidence Visualization Honesty Rules

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/24-EVIDENCE-VISUALIZATION-METHODOLOGY.md`, `docs/06`, `docs/07`, `docs/08`, `docs/09`, `docs/13` §5

## Context

Milestone 5 adds visual summaries of the research landscape (`/evidence`,
`/statistics`). Visualizations can imply scientific conclusions even over a
correct database — the exact failure mode WiseEvidence exists to avoid. A binding
set of rules is needed so future visualization work cannot drift into implying
efficacy or proof.

## Decision

Evidence visualizations are governed by these rules (detailed in `docs/24`):

1. **Study-based counting.** The unit is `ResearchStudy`; study counts use
   `count(distinct research_study.id)`. Publications are counted and labelled
   separately ("Publications"); the two are never mixed.
2. **Distributions, not conclusions.** Views show frequency distributions of
   database contents. No efficacy score, combined evidence score, positive/
   negative balance, weighting, or `positive − negative` computation exists.
3. **Valence-neutral encoding.** Outcome categories are not coloured green=good /
   red=bad. Meaning lives in labels; colour never implies good/bad, true/false,
   or proven/disproven.
4. **Separation preserved.** Outcome, evidence level, evidence quality, and
   criticism are shown as independent distributions. Evidence-level position is
   navigation ordering, not truth. No outcome × evidence-level cross-tab in M5.
5. **Explicit Unclassified.** Missing evidence-level or outcome classifications
   are shown as "Unclassified", never silently mapped to neutral.
6. **RLS-authoritative, PUBLISHED-only.** Aggregation runs under the `anon` role;
   no bypass of RLS; no new tables (no migration).

## Consequences

- The pyramid is a browse/compare affordance linking into the M4 explorer, not a
  ranking of validity.
- Any future positive/negative balance or weighted synthesis requires its own
  methodology specification and ADR before it may be built — it is out of scope
  here and remains forbidden by default.
- Aggregation is deterministic PostgreSQL over existing tables — no AI, no vector
  search, no paid services, no schema change.
