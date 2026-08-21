# WiseEvidence
## Evidence Quality

**Document:** `docs/08-EVIDENCE-QUALITY.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `07-OUTCOME-CLASSIFICATION.md`, `09-CRITICISM-FRAMEWORK.md`

---

# 1. Purpose

Define **evidence quality** — methodological rigor — as a dimension entirely
separate from outcome and confidence (`00` §4).

A positive study is not automatically high quality; a negative study is not
automatically low quality. Quality answers "how methodologically sound is this
study?", independent of what it reported.

# 2. Quality Is Separate

Quality MUST NOT be derived from, or collapsed into, outcome. The data model
stores quality on its own `Classification` dimension (`05` §5, §9).

# 3. Quality Dimensions (v1)

Each dimension is assessed as `ADEQUATE | UNCLEAR | INADEQUATE | NOT_APPLICABLE`
(mirroring common risk-of-bias vocabularies), with an optional note:

- **Study design** — appropriateness of design for the question.
- **Sample size / power** — adequacy to detect a plausible effect.
- **Randomization** — presence and method (where applicable).
- **Allocation concealment.**
- **Blinding** — participants, practitioners, assessors.
- **Control quality** — appropriateness of comparator (placebo/active/none).
- **Attrition** — dropout handling, intention-to-treat.
- **Statistical methods** — appropriateness and pre-specification.
- **Reporting completeness** — outcomes reported vs registered.
- **Replication** — independent replication status.
- **Publication bias** — where assessable (esp. reviews/meta-analyses).
- **Other methodological concerns** — free-form, categorized where possible.

Dimensions that do not apply to a study type (e.g. blinding for an in-vitro
study) are `NOT_APPLICABLE`, not `INADEQUATE`.

# 4. Overall Quality Summary

A coarse overall summary (`HIGH | MODERATE | LOW | UNCLEAR`) MAY be derived for
display and filtering. If derived, its derivation rule is documented and shown;
it is a **descriptive aggregation of the dimensions above, not a validated
scientific score of truth**. Do not invent an authoritative numeric quality
score without a documented, defensible basis (`00` §7, master prompt §22).

# 5. Quality vs Criticism

Quality is a structured, dimension-by-dimension methodological assessment.
**Criticism** (`09`) is narrative or categorized commentary about a study, which
may come from authors, later publications, or WiseEvidence reviewers. A study can
be high quality and still attract criticism, and vice versa. They are stored
separately.

# 6. Provenance of Quality Judgements

Each quality assessment records who made it (AI suggestion vs human reviewer),
when, the prompt/model version if AI-assisted, and the reasoning. AI may propose
quality assessments; humans finalize published values (`05` §9, `10`).

# 7. Confidence vs Quality

Confidence (`07` §9) is about certainty in a *classification*; quality is about
the *methodology of the study*. They are distinct fields and may diverge.

# 8. Reversibility

Quality assessments are versioned and reversible; history is preserved (`05`
§10).
