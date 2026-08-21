# WiseEvidence
## Admin Architecture

**Document:** `docs/12-ADMIN-ARCHITECTURE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `05-DATABASE-ARCHITECTURE.md`, `10-AI-ARCHITECTURE.md`, `15-UI-UX-SPECIFICATION.md`, `16-SECURITY.md`

---

# 1. Purpose

Define the admin subsystem: the reviewer/administrator workflow that turns
imported candidates into published, human-reviewed research. Admin is a
**core feature**, not an afterthought (master prompt §17).

# 2. Principle: Structured Controls, Never Raw Rows

Reviewers must never edit raw database rows. All corrections happen through
structured controls — dropdowns, buttons, `+ Add` / Remove, checkboxes, quick
approve/reject (`00`, master prompt §6, §12).

# 3. Admin Routes

From `03` §21:

```text
/admin            dashboard
/admin/review     review queue
/admin/research   research listing & editor
/admin/imports    import monitoring
/admin/sources    source configuration
/admin/taxonomy   taxonomy management
/admin/ai         AI runs & suggestions
/admin/corrections community corrections
/admin/users      user & role management
/admin/audit      audit history
```

Public and admin authorization boundaries stay separate (`04` §10). Privileged
operations are server-side (`04` §11); security does not rely on client-side
hiding (`04` §15, `16`).

# 4. Review Queue

The queue surfaces (`02` §7): new imports, low AI confidence, missing data,
possible duplicates, user corrections, and classification disagreements. Each
item shows enough context to decide quickly.

# 5. Quick Review Interface

Conceptual per-record control set (master prompt §17):

```text
Research title
AI summary (labeled AI-assisted)

Study Type     [ RCT ▼ ]
Evidence Level [ RCT ▼ ]
Outcome        [ Positive ▼ ]
Confidence     [ Moderate ▼ ]
Quality        [ Moderate ▼ ]

Conditions     [ Asthma ] [+]
Interventions  [ ... ]    [+]
Tags           [ RCT ] [ Placebo ] [+]
Criticism      [ Small sample ] [+]

[ Accept AI ] [ Save ] [ Approve ] [ Publish ] [ Reject ]
```

A reviewer should be able to process a paper in a few interactions. The exact UI
may evolve; the interaction must stay simple (`15`).

# 6. AI Suggestions in Review

- AI suggestions are shown as suggestions, clearly labeled, alongside editable
  final fields (`10` §11).
- "Accept AI" copies a suggestion into the final value; the AIResult remains
  immutable (`05` §9).
- Overriding an AI value preserves both values.

# 7. Override Reasons

For important overrides, capture a reason (master prompt §72). Suggested presets:
- AI misread primary endpoint
- Secondary outcome incorrectly prioritized
- Abstract incomplete
- Full text contradicts abstract
- Study design misclassified

Reasons are stored on the `Review`/`AuditLog` (`05` §5, §10).

# 8. Duplicate Review

Duplicate candidates (`11` §7) are confirmed or rejected by a human. The system
never auto-deletes; a confirmed duplicate is linked (same `ResearchStudy`) rather
than destroyed (`05` §4, §11).

# 9. Publish Workflow

```text
DRAFT → PENDING_REVIEW → PUBLISHED
```

Publishing requires the human-reviewed final values to be set for the required
dimensions. Nothing publishes automatically while review is required (`05` §6–7,
`00` §human-review).

# 10. Bulk Operations

Bulk actions (e.g. bulk approve low-risk imports, bulk tag) are permitted but
must respect the same review rules and write to the audit log. Bulk publish of
unreviewed classifications is not allowed.

# 11. Taxonomy Management

Admins manage conditions, interventions, study types, evidence levels, criticism
categories, outcome/quality categories, and tags (`04` §18). Taxonomy changes are
versioned (`06` §9) and audited.

# 12. Corrections

Community-submitted corrections (`13`) appear in `/admin/corrections`, enter the
review workflow, and are accepted/rejected with a reason. Canonical records are
never directly overwritten by community input (`02` §10).

# 13. Audit

Every admin action affecting canonical data writes an append-only audit entry:
actor, action, entity, field, before, after, timestamp, reason (`04` §21,
`05` §10).

# 14. Roles

`REVIEWER` and `ADMIN` access admin; `PUBLIC` does not. Reviewers do not receive
database-admin privileges (`04` §40, master prompt §53). Future roles
(SENIOR_REVIEWER, DATA_CURATOR, SOURCE_MANAGER) extend, not replace, this model.
