# WiseEvidence
## Criticism Framework

**Document:** `docs/09-CRITICISM-FRAMEWORK.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `07-OUTCOME-CLASSIFICATION.md`, `08-EVIDENCE-QUALITY.md`

---

# 1. Purpose

Define how **methodological criticism** is represented. Criticism is a distinct
dimension: it is **not** a negative outcome and **not** the same as the
structured quality assessment (`00` §4, `08` §5).

A paper may report a **positive** outcome and still carry substantial criticism.
A paper may be **negative** and well-conducted with no significant criticism.

# 2. Criticism Categories (v1)

Stored enum on the `Criticism` entity (`05` §5):

`METHODOLOGY · RANDOMIZATION · BLINDING · SAMPLE_SIZE · STATISTICS · CONTROLS ·
REPLICATION · PUBLICATION_BIAS · REPORTING · INTERPRETATION · GENERALIZABILITY ·
OTHER`

# 3. Criticism Origin (mandatory)

Every criticism records its **origin**, which must always be distinguishable:

- `AUTHOR_REPORTED` — a limitation the study's own authors stated.
- `EXTERNAL_PUBLICATION` — criticism raised by a later paper, systematic review,
  or replication study (with citation/provenance).
- `REVIEWER_ASSESSED` — a structured observation added by a WiseEvidence
  reviewer.
- `AI_SUGGESTED` — extracted or proposed by AI, pending human review.

The UI must visibly separate "author-reported limitation" from "WiseEvidence
reviewer assessment" from "AI suggestion" (master prompt §23). These are never
merged into an anonymous "criticism" blob.

# 4. Criticism ≠ Negative Outcome

Adding criticism to a study never changes its outcome value and never
"downgrades" a positive result automatically. Outcome (`07`), quality (`08`), and
criticism (`09`) move independently. Do not use criticism as a backdoor to
suppress or re-score positive findings (master prompt §3, §8).

# 5. Fields

Each `Criticism` row: `id`, target (study/publication), `category`, `origin`,
`text`, source reference/citation (for external), actor, timestamp, status
(active | withdrawn | superseded). Withdrawn/superseded criticism is retained for
history, not deleted.

# 6. Balance & Transparency

WiseEvidence does not hide criticism to favor positive research, and does not
manufacture criticism to suppress it. Both would corrupt the platform's
credibility (master prompt §3). Criticism is presented alongside — never instead
of — the study's reported outcome and quality.

# 7. AI Assistance

AI may extract author-reported limitations and *suggest* criticism categories.
Suggestions are stored as `AI_SUGGESTED` and require human review before being
presented as reviewer-assessed (`05` §9, `10`). AI must never silently convert a
suggestion into an authoritative criticism.

# 8. Community Input

Community members may *flag* possible issues or classification disagreements
(`13`), which enter the correction/review workflow as candidate criticism — they
do not directly edit canonical criticism records.
