# WiseEvidence
## Evidence Taxonomy

**Document:** `docs/06-EVIDENCE-TAXONOMY.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `05-DATABASE-ARCHITECTURE.md`, `07-OUTCOME-CLASSIFICATION.md`, `08-EVIDENCE-QUALITY.md`

---

# 1. Purpose

Define the versioned, explicit taxonomy of **study types** and **evidence
levels** used across WiseEvidence. This taxonomy is a *navigation and
description* system. It must **not** be presented as a claim that a higher
pyramid level automatically proves a study is true (`00` §5–6, `04` §19).

Taxonomy is data, stored in the `StudyType` and `EvidenceLevel` tables (`05`).
Changing it is a versioned decision, recorded via an ADR when significant.

# 2. Taxonomy Versioning

- The taxonomy carries a `version` (this document: `taxonomy-v1`).
- Each `StudyType` / `EvidenceLevel` row records the taxonomy version it belongs
  to. Reclassification under a new version never silently rewrites historical
  human decisions; it creates a new classification with provenance (`05` §9–10).

# 3. Study Types (v1)

| Code | Label | Clinical? | Subject |
|------|-------|-----------|---------|
| `META_ANALYSIS` | Meta-analysis | Clinical (synthesis) | Human (usually) |
| `SYSTEMATIC_REVIEW` | Systematic Review | Clinical (synthesis) | Human (usually) |
| `RCT` | Randomized Controlled Trial | Clinical | Human |
| `CONTROLLED_TRIAL` | Controlled Clinical Trial (non-randomized) | Clinical | Human |
| `COHORT` | Cohort Study | Clinical (observational) | Human |
| `CASE_CONTROL` | Case-Control Study | Clinical (observational) | Human |
| `CROSS_SECTIONAL` | Cross-Sectional Study | Clinical (observational) | Human |
| `CASE_SERIES` | Case Series | Clinical | Human |
| `CASE_REPORT` | Case Report | Clinical | Human |
| `EXPERT_OPINION` | Expert Opinion / Narrative | Non-empirical | N/A |
| `ANIMAL` | Animal Research | Preclinical | Animal |
| `IN_VITRO` | In Vitro / Basic Research | Preclinical | In-vitro |
| `OTHER_UNCLASSIFIED` | Other / Unclassified | Unknown | Unknown |

# 4. Evidence Levels (v1) — Pyramid Ranks

The evidence pyramid is a **visualization/navigation ordering**. Rank orders how
studies are grouped in the UI; it is not a scientific certainty score.

```text
Rank 1  META_ANALYSIS
Rank 2  SYSTEMATIC_REVIEW
Rank 3  RCT
Rank 4  CONTROLLED_TRIAL
Rank 5  OBSERVATIONAL      (cohort / case-control / cross-sectional)
Rank 6  CASE_SERIES
Rank 7  CASE_REPORT
Rank 8  PRECLINICAL         (animal / in-vitro)
Rank 9  EXPERT_OPINION
Rank 10 OTHER / UNCLASSIFIED
```

`EvidenceLevel` may be a coarser grouping than `StudyType` (e.g. the three
observational study types share the `OBSERVATIONAL` evidence level). The mapping
from `StudyType → EvidenceLevel` is explicit and versioned.

# 5. Clinical vs Preclinical

- **Clinical**: conducted in humans (or synthesizing human studies).
- **Preclinical**: animal or in-vitro research.
Preclinical evidence is represented and browsable but is **not** rank-equivalent
to clinical trial evidence. The distinction must be visible in the UI (`15`).

# 6. Subject Type

Independent facet: `HUMAN | ANIMAL | IN_VITRO | MIXED | NOT_APPLICABLE`.
A study's subject type is stored even when its study type is ambiguous.

# 7. Edge Cases & Rules

- **Protocol / registered trial without results** → `OTHER_UNCLASSIFIED` with a
  tag `protocol`; not counted as completed evidence.
- **Preprint** → study type as assessed; provenance flags non-peer-reviewed
  status (`17`).
- **Secondary analysis / re-analysis** → its own study type where applicable, but
  linked to the same `ResearchStudy` to avoid double-counting (`05` §4).
- **Review that is not systematic** → `EXPERT_OPINION` (narrative), not
  `SYSTEMATIC_REVIEW`.
- **Unknown** → always allowed: `OTHER_UNCLASSIFIED`. Never force a false
  precise classification to avoid a null.

# 8. Human Override & AI

AI may *suggest* a study type / evidence level; a human confirms the final value
(`05` §9, `10`). Suggestions and finals are stored separately. Keyword-only
classification is not permitted for the final value (see `07` §on-rules).

# 9. Change Process

Adding, removing, renaming, or re-ranking a taxonomy entry:
1. Update this document and bump `taxonomy-vN`.
2. Record an ADR if the change alters public interpretation or ordering.
3. Provide a migration mapping old codes → new codes.
4. Never silently drop historical classifications.
