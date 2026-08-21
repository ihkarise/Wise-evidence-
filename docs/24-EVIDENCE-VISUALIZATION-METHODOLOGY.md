# WiseEvidence
## Evidence Visualization Methodology

**Document:** `docs/24-EVIDENCE-VISUALIZATION-METHODOLOGY.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `06-EVIDENCE-TAXONOMY.md`, `07-OUTCOME-CLASSIFICATION.md`, `08-EVIDENCE-QUALITY.md`, `09-CRITICISM-FRAMEWORK.md`, `13-COMMUNITY-ARCHITECTURE.md` §5, ADR-015

---

# 1. Purpose

Milestone 5 introduces visual summaries of the WiseEvidence research landscape
(`/evidence`, `/statistics`). A visualization can imply a scientific conclusion
even when the underlying database is correct. This document fixes the methodology
so those views describe **what the database contains** and never imply efficacy,
proof, or scientific consensus. The assumptions here are documented **before**
the visualizations are built (master prompt §20, `13` §5).

# 2. What these views are — and are not

Every landscape/statistics view is a **descriptive summary of PUBLISHED records**.

It is **not**: a truth pyramid, an efficacy pyramid, an effectiveness ranking, a
quality score, a positive/negative balance, or a combined evidence score.

Non-implications (must hold in every view):

```text
more positive studies      ≠ homeopathy proven
more negative studies      ≠ homeopathy disproven
more high-level studies     ≠ intervention effective
evidence level              ≠ study result
criticism                   ≠ negative outcome
publications                ≠ independent studies
```

# 3. Unit of analysis — ResearchStudy

The primary unit is the **ResearchStudy**. A study with multiple publications
counts as **one** study. Study counts use `count(distinct research_study.id)`
(or a study-first aggregation); they are **never** computed by counting rows
after joining `publication`.

Publication counts may be shown **separately** and are always labelled
**"Publications"**. Context may state: **"N studies across M publications."**
The two counts are never mixed.

# 4. Evidence pyramid (`/evidence`)

- **Axis:** `evidence_level` (the pyramid-rank taxonomy in `06` §4). Rank is a
  **navigation ordering**, not a truth score.
- **Meaning:** distribution of published **research studies** by evidence level,
  for navigation and comparison.
- **Study type** is a **separate facet** — related to, but not the same as,
  evidence level (`06`). They are shown distinctly and never conflated.
- **Unclassified band:** studies without a human EVIDENCE_LEVEL classification are
  shown explicitly as "Unclassified" — never hidden, never forced upward.
- **Navigation:** each level links to `/research?evidenceLevel=<code>` (the same
  canonical explorer filter, ADR-014).
- **Required caption (wording may be refined, meaning fixed):**
  > "Studies are organized by evidence level for navigation and comparison.
  > Position does not indicate positivity, negativity, truth, or treatment
  > effectiveness."
- Visual hierarchy encodes **evidence level only** — never valence. Positive
  studies are not placed above negative ones; supportive research is not placed
  at the top.

# 5. Outcome distribution (`/statistics`)

- A **frequency distribution** over the seven documented categories
  (`STRONG_POSITIVE · POSITIVE · LEANING_POSITIVE · NEUTRAL_INCONCLUSIVE ·
  LEANING_NEGATIVE · NEGATIVE · STRONG_NEGATIVE`), plus an explicit
  **UNCLASSIFIED** bucket for studies with no final reported-outcome
  classification. Missing classification is **never** silently mapped to neutral.
- Labelled **"Reported outcome"** — never "proof", "effectiveness", or "efficacy".
- **Valence-neutral encoding:** categories are **not** coloured green=good /
  red=bad. A single neutral hue is used; meaning lives in the labels, not the
  colour (decision: `AskUserQuestion`, ADR-015).
- **Forbidden computations:** collapsing into Positive/Negative;
  `positive_count − negative_count`; `positive_% − negative_%`; any overall
  efficacy, balance, weighting, or combined score.

# 6. Evidence quality (`/statistics`)

Displayed **independently** of outcome (ADEQUATE/UNCLEAR/INADEQUATE/
NOT_APPLICABLE + UNCLASSIFIED). The UI states **quality ≠ outcome**: a positive
outcome with low quality and a negative outcome with high quality both remain
possible. Never merged with outcome into a single score.

# 7. Criticism (`/statistics`)

Displayed **independently** (studies flagged, by criticism category). The UI
states **criticism ≠ negative outcome**: a study may have a positive reported
outcome and recorded criticism, or a negative outcome and none. Criticism is
never converted into a hidden negative value or a downvote.

# 8. No cross-tabulation in M5

M5 ships **separate** distributions only. No outcome × evidence-level cross-tab
(decision: `AskUserQuestion`). Independence of the dimensions is asserted in
captions, not via a 2-D matrix.

# 9. Data boundary

All landscape/statistics queries run through the public read path under the
`anon` RLS role and include **PUBLISHED studies only**. DRAFT, PENDING_REVIEW,
REJECTED, ARCHIVED, AI results, reviews, corrections, import candidates, and
audit are excluded. RLS remains authoritative; the visualization layer never
bypasses it. Demo studies are counted but the pages disclose that demo data is
included (as the explorer does).

# 10. Accessibility

Every chart has (1) a visual CSS bar representation and (2) an equivalent
semantic `<table>`/text representation. No information exists only in geometry or
colour. Interactive links (evidence-level segments) are keyboard accessible.

# 11. No schema change

M5 requires no migration. If implementation reveals the methodology cannot be
represented with the existing schema, work **stops** and the exact mismatch is
reported with the smallest proposed correction — no silent workaround.
