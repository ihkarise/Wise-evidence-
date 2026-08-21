# WiseEvidence
## Outcome Classification

**Document:** `docs/07-OUTCOME-CLASSIFICATION.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `06-EVIDENCE-TAXONOMY.md`, `08-EVIDENCE-QUALITY.md`, `09-CRITICISM-FRAMEWORK.md`, `10-AI-ARCHITECTURE.md`

---

# 1. Purpose

Define how a study's **reported outcome** is classified — the dimension that
answers "what did the researchers report?" Outcome is kept strictly separate
from evidence quality, confidence, and criticism (`00` §4).

Outcome describes **what a study reported**, not whether homeopathy works, not
how good the study is, and not how certain we are. WiseEvidence must be able to
represent supportive, mixed, neutral, inconclusive, and critical findings — never
a positive-vs-negative binary.

# 2. Canonical Outcome Enum

Stored value (canonical, machine form) and public display label:

| Enum (stored) | Public label |
|---------------|--------------|
| `STRONG_POSITIVE` | Strong Positive |
| `POSITIVE` | Positive |
| `LEANING_POSITIVE` | Mixed / Leaning Positive |
| `NEUTRAL_INCONCLUSIVE` | Neutral / Inconclusive |
| `LEANING_NEGATIVE` | Mixed / Leaning Negative |
| `NEGATIVE` | Negative |
| `STRONG_NEGATIVE` | Strong Negative |

> **Naming note (resolves a cross-doc discrepancy):** earlier drafts (`00` §7,
> `02` §4) list the *labels* ("Neutral/Inconclusive", "Mixed/Leaning Positive").
> This document makes the **enum** the canonical stored form and the label the
> presentation form. See `docs/reports/ARCHITECTURE-CROSSCHECK.md`.

An additional stored state `UNCLASSIFIED` is permitted for records not yet
reviewed. It is never shown as a scientific outcome; it means "not yet assessed."

# 3. Outcome Is Not a Validated Numeric Scale

An internal ordinal index (e.g. −3…+3) MAY drive visualization ordering, but it
must **not** be presented as a validated scientific measurement of efficacy
(`00` §7, master prompt §5, §59). If any positive/negative balance visualization
is built, its methodology must be disclosed (see `08` and `15`).

# 4. What the Classification Is Based On

Outcome is assigned from **evidence extracted from the paper**, prioritizing:
1. The study's **primary outcome/endpoint** as pre-specified.
2. Direction and magnitude of the primary result.
3. Statistical significance **and** clinical significance (distinct — see §6).
4. Consistency across endpoints (primary vs secondary).
5. Authors' own stated conclusion, cross-checked against the data.

# 5. Classification Rules

- **Primary over secondary.** A positive secondary endpoint does not make a study
  `POSITIVE` if the primary endpoint was null. Prioritize the pre-specified
  primary outcome.
- **Mixed endpoints.** When primary results are genuinely split, use a
  `LEANING_*` or `NEUTRAL_INCONCLUSIVE` value rather than forcing a pole.
- **Null / no significant difference** on the primary endpoint → `NEGATIVE` or
  `NEUTRAL_INCONCLUSIVE` depending on whether the study was adequately powered to
  detect an effect (an underpowered null leans `NEUTRAL_INCONCLUSIVE`; this is an
  *outcome* judgement, and the underpowering is *also* recorded as `08` quality /
  `09` criticism — not folded into outcome).
- **Conflicting results within a review** → reflect the review's synthesized
  conclusion; if the review itself is inconclusive, `NEUTRAL_INCONCLUSIVE`.
- **`STRONG_*`** is reserved for large, consistent, primary-endpoint effects (for
  positive) or clearly powered null/harm findings (for negative), not for
  rhetorical strength of the abstract.

# 6. Statistical vs Clinical Significance

These are recorded distinctly and both inform the outcome:
- **Statistical significance** — did the result pass the study's own test?
- **Clinical significance** — is the effect size meaningful for patients?
A statistically significant but clinically trivial result should not be inflated
to `STRONG_POSITIVE`.

# 7. No Keyword-Only Classification

The **final** outcome must not be assigned by naive keyword matching (e.g.
"significant" → positive). AI may *suggest* an outcome using structured
extraction, but final values require human review for published records (`05`
§9). Keyword heuristics may only pre-sort the review queue, never publish.

# 8. AI Suggestion → Human Review → Final

```text
AI structured extraction (outcome + rationale + confidence)
   → stored as AIResult (immutable)
   → reviewer confirms or overrides (with reason)
   → Classification.final_value (human) published
```

If a reviewer overrides (AI: `POSITIVE`, human: `LEANING_POSITIVE`), both are
preserved (`05` §9). Common override reasons (`12` §override): "AI misread
primary endpoint", "secondary outcome incorrectly prioritized", "abstract
incomplete", "full text contradicts abstract".

# 9. Confidence (separate field)

Each outcome classification carries a **confidence** (`LOW | MODERATE | HIGH`)
that is independent of the outcome value. A `POSITIVE` outcome may have `LOW`
confidence; a `NEGATIVE` outcome may have `HIGH` confidence (`00` §8).

# 10. Classification Explanation

Every published outcome should carry a short **"why this classification"**
explanation (`03` §7 research-detail "Why This Classification?"). This is
human-authored or human-approved text, distinct from the AI summary.

# 11. Reversibility

Outcome classifications are reversible via the review/correction workflow
(`05` §10, `12`). History is preserved; nothing is silently overwritten.
