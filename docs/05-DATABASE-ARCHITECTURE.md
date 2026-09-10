# WiseEvidence
## Database Architecture

**Document:** `docs/05-DATABASE-ARCHITECTURE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `04-SYSTEM-ARCHITECTURE.md`, `06-EVIDENCE-TAXONOMY.md`, `07-OUTCOME-CLASSIFICATION.md`, `10-AI-ARCHITECTURE.md`

---

# 1. Purpose

This document defines the conceptual data model for WiseEvidence: the core
entities, their relationships, lifecycle, provenance, and auditability.

It is a **conceptual and logical** specification. Exact DDL, column types, RLS
policies, and index tuning belong in version-controlled migrations delivered in
Milestone 2. Do not treat the field lists here as final column names — treat them
as the required information each entity must carry.

**PostgreSQL is the authoritative source of application state.** JSON, Markdown,
scraper output, and AI output are never the canonical database.

# 2. Modeling Principles

1. **Separation of dimensions.** Outcome, evidence quality, confidence,
   criticism, and provenance are distinct and must never be collapsed into one
   field or one score (see `00` §4, `07`, `08`, `09`).
2. **Study ≠ Publication.** A single underlying research study may be reported in
   multiple publications (preprint, journal article, conference abstract,
   secondary analysis). Counting publications as independent studies inflates the
   evidence base. Model the two separately (§4).
3. **AI suggestion ≠ final value.** AI-produced classifications are stored
   separately from human-reviewed final values, with full AI provenance
   preserved (§9, `10`).
4. **Nothing is destroyed.** Corrections and overrides append history; they do
   not overwrite prior values (§10, §11).
5. **Everything published is traceable.** Every canonical record links back to a
   source, identifiers, and an import/review history (§8).
6. **Avoid premature normalization.** Normalize where it protects integrity
   (identifiers, taxonomy, authorship); denormalize read-optimized projections
   only when a measured need appears.

# 3. Entity Overview

```text
                         ┌──────────────┐
                         │ ResearchStudy│  (the underlying study)
                         └──────┬───────┘
                                │ 1..*
                         ┌──────▼───────┐
                         │ Publication  │  (a specific published record)
                         └──────┬───────┘
        ┌───────────────┬───────┼────────┬───────────────┐
        ▼               ▼       ▼        ▼               ▼
  ResearchIdentifier  Author  Journal  Classification  ResearchSource
     (DOI/PMID)                          (per dimension)   (+provenance)
        │                                   │
        │                          ┌────────┴─────────┐
        ▼                          ▼                  ▼
     Taxonomy refs           AIResult (suggestion)  Review (human)
 (Condition, Intervention,
  StudyType, EvidenceLevel,
  Outcome, Quality,
  Criticism, Tag)
```

# 4. Study vs Publication

## ResearchStudy
The conceptual unit of research (one trial, one experiment, one review effort).
Classifications that describe *the research itself* (study type, evidence level,
outcome, quality, confidence, criticism) attach at the study level, or at the
primary publication and are surfaced at the study level.

Required information:
- `id`
- canonical title (normalized)
- study kind reference (`StudyType`) — human-final
- lifecycle state (§6)
- publication state (§7)
- created_at / updated_at

## Publication
A specific published artifact reporting a study.

Required information:
- `id`, `study_id` (FK → ResearchStudy)
- title (as published), abstract (where permitted), publication date, language
- journal reference (FK → Journal, nullable)
- authorship (via `PublicationAuthor` join, ordered)
- identifiers (via ResearchIdentifier)
- source reference (FK → ResearchSource)
- `is_primary` (the canonical publication for the study)

**MVP simplification:** the MVP may create one Publication per ResearchStudy and
treat them 1:1, while keeping the two tables distinct so that de-duplication and
multi-publication linking can be introduced later without a schema rewrite.

# 5. Core Entities & Required Fields

Below, **H** = human-reviewed final value, **AI** = AI suggestion stored
separately, **P** = provenance/audit.

## Author
`id`, normalized name, display name, optional ORCID, disambiguation notes.
No reputation/popularity score is stored (see `13`).

## Journal
`id`, normalized name, ISSN(s), publisher, homepage URL.

## Condition (taxonomy)
`id`, canonical name, `slug` (unique), synonyms[], parent (nullable), description.

## Intervention (taxonomy)
`id`, canonical name, `slug` (unique), synonyms[], type (e.g. remedy, potency,
regimen), description.

## StudyType (taxonomy)
`id`, code (enum, versioned in `06`), label, hierarchy position, clinical vs
preclinical flag, subject type (human/animal/in-vitro/other).

## EvidenceLevel (taxonomy)
`id`, code, label, pyramid rank. Rank is a **navigation ordering**, not a truth
score (`00` §5–6, `04` §19).

## Outcome (taxonomy + classification)
Canonical enum (see `07`): `STRONG_POSITIVE · POSITIVE · LEANING_POSITIVE ·
NEUTRAL_INCONCLUSIVE · LEANING_NEGATIVE · NEGATIVE · STRONG_NEGATIVE`.
Applied to a study via `Classification` (§9), never as a free-text field.

## EvidenceQuality (taxonomy + classification)
Quality dimensions (see `08`), stored independently of Outcome.

## Criticism
`id`, category (enum from `09`: methodology, randomization, blinding, sample
size, statistics, controls, replication, publication bias, reporting,
interpretation, generalizability, other), text, **origin** (author-reported |
reviewer-assessed | ai-suggested), linked study/publication, actor, timestamp.
Criticism ≠ negative outcome.

## Tag
`id`, label, `slug`. Free-form but curated; used for cross-cutting facets.

## ResearchIdentifier
`id`, study/publication ref, `type` (DOI | PMID | PMCID | EuropePMC | URL |
other), `value_raw`, `value_canonical`. DOI canonicalization rules in `07`/`20`.
Unique constraint on (`type`, `value_canonical`) supports deduplication.

## ResearchSource (+ provenance)  **P**
`id`, source name, source URL, import method (manual | connector name),
imported_at, external_id, verification_timestamp, license info, transformation
notes. One publication may carry multiple source observations over time.

## Classification  **H + AI**
The join that binds a study to a value on **one dimension**:
`id`, study_id, `dimension` (outcome | evidence_level | quality | confidence |
study_type), `final_value` (**H**), `final_actor`, `final_reason`,
`ai_result_id` (**AI**, nullable), `confidence` (of the human/AI judgement),
`explanation` (why-this-classification text), updated_at.
The **AI suggestion and the human final value are never the same column.**

## Confidence
Not a separate table by default — a field on `Classification` for the relevant
dimensions. Confidence is independent of outcome (a positive outcome may have low
confidence and vice versa; `00` §8).

## AIJob / AIResult  **AI + P**
See `10`. `AIJob`: operation, model, provider, prompt_version, input_hash,
status, cost estimate, created_at. `AIResult`: job_id, structured output,
confidence, validation status, timestamp. Historical results are immutable — a
new run creates a new job+result (`10`).

## Review  **H + P**
`id`, study_id, reviewer (User), action (approve | reject | request-changes |
edit), affected dimension(s), before/after snapshot ref, reason, timestamp.

## Correction  **P**
Community- or reviewer-originated change request: `id`, target ref, field,
proposed value, submitter, status (open | accepted | rejected | merged),
resolution actor, reason, timestamps. Corrections never overwrite history (§10).

## AuditLog  **P**
`id`, actor, action, entity, entity_id, field, before, after, timestamp, reason
(where required). Append-only.

## ImportJob / ImportCandidate  **P**
`ImportJob`: source, trigger (manual | scheduled), state, counts, started/ended.
`ImportCandidate`: raw payload, normalized payload, dedup decision, duplicate-of
ref (nullable), state (from `04` §32), error detail.

**Migration `0013` (M7.4A) — discovery candidate identity.** Automated discovery
persistence requires candidate idempotency, which the original `import_candidate`
could not enforce. `0013` adds two nullable columns — `source_key` and
`source_stable_id` (e.g. `crossref` + the canonical DOI) — and a **partial** unique
index `import_candidate_source_identity_uniq` on `(source_key, source_stable_id)`
`WHERE source_key IS NOT NULL AND source_stable_id IS NOT NULL`. The partial
predicate exempts NULL identities (manual entry / DEMO fixtures) so they never
collide, keeping the change additive and safe for existing rows. Writes are the
`service_role` server path (RLS unchanged: staff-only SELECT, anon denied); the
adapter inserts idempotently via `ON CONFLICT … DO NOTHING`, preserving the
existing candidate. See `docs/30` §10.7, `docs/reports/M7.4A-DATABASE-PERSISTENCE.md`.

## User / Role
`User`: id, auth subject (Supabase auth id), email, display name.
`Role`: `PUBLIC | REVIEWER | ADMIN` (future: SENIOR_REVIEWER, DATA_CURATOR,
SOURCE_MANAGER — `04` §40). Reviewers never receive database-admin privileges.

# 6. Research Lifecycle State

```text
DISCOVERED → IMPORTED → PROCESSING → PENDING_REVIEW → PUBLISHED
```

Plus failure/terminal states: `IMPORT_FAILED`, `DUPLICATE_CANDIDATE`,
`REJECTED`, `ARCHIVED`. The fuller conceptual pipeline (`00` §11) —
`Discovered → Imported → Normalized → Deduplicated → AI Enriched → Pending
Review → Reviewed → Published → Updated/Re-reviewed` — maps onto these states.
A record must **not** transition to `PUBLISHED` while human review is required.

# 7. Publication State

```text
DRAFT → PENDING_REVIEW → PUBLISHED → (ARCHIVED | REJECTED)
```

Only `PUBLISHED` records are exposed to the public read path. Drafts and pending
records are never publicly queryable (enforced by RLS, not by client hiding —
`04` §15).

# 8. Provenance Requirements

Every canonical study/publication must be traceable via at least:
`source`, `source_url`, `external_id`, `DOI` (where available), `imported_at`,
`updated_at`, `import_method`, `review_status`. See `17-DATA-GOVERNANCE.md`.

# 9. AI/Human Separation (storage contract)

- AI writes to `AIJob`/`AIResult` and may populate `Classification.ai_result_id`.
- A human sets `Classification.final_value` via a `Review`.
- If a human changes an AI suggestion (e.g. AI said POSITIVE, human sets
  LEANING_POSITIVE), **both are retained**: the AIResult is immutable, the final
  value records the human decision and reason.
- Public pages render final human-reviewed values; AI-only values are labeled
  "AI-assisted, pending review" and are not presented as authoritative.

# 10. History & Corrections

- `AuditLog` is append-only and records actor/action/before/after/reason.
- `Correction` preserves original value → proposed value → actor → reason →
  timestamp and never destroys the prior canonical value.
- Model-version or prompt-version changes never overwrite historical AIResults.

# 11. Deduplication (storage support)

Dedup priority (`00`/`04`): `DOI → PMID/persistent id → normalized title →
author+year → similarity`. The unique constraint on
`ResearchIdentifier(type, value_canonical)` catches exact-identifier duplicates;
weaker matches produce a `DUPLICATE_CANDIDATE` routed to review. **Never
auto-delete** a possibly-distinct paper on fuzzy match alone.

# 12. Indexing (initial guidance)

- Unique: `ResearchIdentifier(type, value_canonical)`, `Condition.slug`,
  `Intervention.slug`, `Tag.slug`.
- Search: PostgreSQL full-text index over title/abstract/authors/journal
  (see `14`). DOI exact-match lookup prioritized.
- Foreign-key and lifecycle/publication-state indexes for the review queue and
  public read path.

# 13. Row-Level Security (direction)

- Public role: read only `PUBLISHED` publications and their published fields.
- Reviewer/Admin: authenticated access to drafts, review queue, AI results,
  audit. Privileged writes are server-side only. Full policy detail in `16` and
  the Milestone-2 migrations.

# 14. Out of Scope Here

Exact SQL types, migration files, seed content, RLS policy SQL, and search index
configuration. Those are produced in Milestones 1–2 and governed by `19`/`20`.
