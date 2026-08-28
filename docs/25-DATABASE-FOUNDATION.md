# WiseEvidence
## Database Foundation — Milestone 2 Design Checkpoint

**Document:** `docs/25-DATABASE-FOUNDATION.md`
**Version:** 0.1.0
**Status:** Implemented (Milestone 2)
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `05-DATABASE-ARCHITECTURE.md`, `06-EVIDENCE-TAXONOMY.md`,
`07-OUTCOME-CLASSIFICATION.md`, `08-EVIDENCE-QUALITY.md`,
`09-CRITICISM-FRAMEWORK.md`, `10-AI-ARCHITECTURE.md`,
`11-DATA-IMPORT-ARCHITECTURE.md`, `12-ADMIN-ARCHITECTURE.md`,
`14-SEARCH-ARCHITECTURE.md`, `16-SECURITY.md`, `17-DATA-GOVERNANCE.md`,
`19-DEPLOYMENT.md`, `20-TESTING.md`, `21-COST-CONTROL.md`, `22-ROADMAP.md`,
`ADR-002`, `ADR-003`, `ADR-006`, `ADR-009`, `ADR-013`

---

# 1. Purpose

This is the **Milestone 2 design checkpoint** required before writing migrations
(`22` §4, master prompt §36). It records the final logical→physical schema
derived from the conceptual model in `05-DATABASE-ARCHITECTURE.md`, the enums,
relationships, constraints, indexes, the Row-Level Security (RLS) model, the seed
and demo-fixture strategy, the data-access package boundary, and the deterministic
testing approach.

M2 delivers the **Database Foundation only** (`22` §4): version-controlled
migrations, the canonical schema, reference taxonomy, provenance, lifecycle and
publication states, indexes, RLS, reference seed, clearly-labelled demo fixtures,
a framework-independent `packages/database`, and deterministic database tests.

**Explicitly out of scope for M2** (later milestones): AI calls, scraping,
discovery connectors, the research explorer, evidence visualization, community
voting, and the authentication UI. The AI and import **tables** are created here
because the documented architecture requires them (`05` §5, `10` §4, `11` §8) —
no AI or import *logic* is implemented.

**No efficacy score, no positive-minus-negative weighting, no hidden evidence
score is created** (`00` §4, `07` §3, master prompt §3). Outcome, quality,
confidence, criticism, and provenance remain five independent dimensions.

# 2. Non-Negotiable Distinctions Encoded in the Schema

| Distinction | How the schema enforces it |
|---|---|
| `Study ≠ Publication` | `research_study` and `publication` are separate tables; `publication.study_id` FK is many-to-one. Multi-publication linking works without a rewrite. |
| `Outcome ≠ Quality ≠ Confidence ≠ Criticism` | Outcome/quality/confidence live in `classification` (one row per `dimension`, `UNIQUE(study_id, dimension)`); detailed quality in `evidence_quality_assessment`; criticism in `criticism`. No column mixes two dimensions. |
| `AI suggestion ≠ human final` | AI writes only to `ai_job`/`ai_result` (append-only). The human final value is `classification.final_value` (a different column). `classification.ai_result_id` links the suggestion; it never *is* the final value. |
| `Draft ≠ Published` | `publication_state` enum; RLS exposes only `PUBLISHED` studies (and their children) to `anon`. |
| `Duplicate candidate ≠ Deleted` | `research_study.lifecycle_state = 'DUPLICATE_CANDIDATE'` and `import_candidate.duplicate_of_study_id` route to review; nothing is auto-deleted. |
| `Classification ≠ proof of efficacy` | No aggregate/derived efficacy column exists anywhere. Evidence-level rank is a stored **navigation ordering**, not a score. |

# 3. Schema Organisation & Conventions

- All application tables live in the **`public`** schema (Supabase/PostgREST +
  RLS convention, `ADR-003`). A small **`app`** schema holds helper functions
  (role checks, `updated_at` touch, append-only guard).
- Primary keys are `uuid` (`gen_random_uuid()`, core in PostgreSQL 13+ and in
  Supabase — no extension required).
- Timestamps are `timestamptz`; `created_at`/`updated_at` are standard.
  `updated_at` is maintained by a `BEFORE UPDATE` trigger.
- Naming: `snake_case`, singular table names, `*_id` foreign keys.
- Enums are PostgreSQL `ENUM` types for **fixed, credibility-critical
  vocabularies** (outcome, criticism category, quality value, lifecycle/publication
  state). **Growing, admin-curated taxonomies** (study types, evidence levels,
  conditions, interventions, tags) are **reference tables** so they can be
  extended and versioned without an `ALTER TYPE` migration (`06` §2, `12` §11).
  This split is recorded in `ADR-013`.

# 4. Enum Types

- `study_lifecycle_state`: DISCOVERED, IMPORTED, PROCESSING, PENDING_REVIEW,
  PUBLISHED, IMPORT_FAILED, DUPLICATE_CANDIDATE, REJECTED, ARCHIVED (`05` §6).
- `publication_state`: DRAFT, PENDING_REVIEW, PUBLISHED, ARCHIVED, REJECTED
  (`05` §7).
- `subject_type`: HUMAN, ANIMAL, IN_VITRO, MIXED, NOT_APPLICABLE (`06` §6).
- `outcome_value`: STRONG_POSITIVE, POSITIVE, LEANING_POSITIVE,
  NEUTRAL_INCONCLUSIVE, LEANING_NEGATIVE, NEGATIVE, STRONG_NEGATIVE,
  UNCLASSIFIED (`07` §2 — the canonical **stored** enum; labels are presentation).
- `classification_dimension`: OUTCOME, EVIDENCE_LEVEL, QUALITY, CONFIDENCE,
  STUDY_TYPE (`05` §9).
- `confidence_level`: LOW, MODERATE, HIGH (`07` §9) — independent of outcome.
- `quality_assessment_value`: ADEQUATE, UNCLEAR, INADEQUATE, NOT_APPLICABLE
  (`08` §3).
- `quality_dimension`: STUDY_DESIGN, SAMPLE_SIZE, RANDOMIZATION,
  ALLOCATION_CONCEALMENT, BLINDING, CONTROL_QUALITY, ATTRITION,
  STATISTICAL_METHODS, REPORTING_COMPLETENESS, REPLICATION, PUBLICATION_BIAS,
  OTHER (`08` §3).
- `quality_summary`: HIGH, MODERATE, LOW, UNCLEAR (`08` §4 — descriptive only).
- `criticism_category`: METHODOLOGY, RANDOMIZATION, BLINDING, SAMPLE_SIZE,
  STATISTICS, CONTROLS, REPLICATION, PUBLICATION_BIAS, REPORTING, INTERPRETATION,
  GENERALIZABILITY, OTHER (`09` §2).
- `criticism_origin`: AUTHOR_REPORTED, EXTERNAL_PUBLICATION, REVIEWER_ASSESSED,
  AI_SUGGESTED (`09` §3).
- `criticism_status`: ACTIVE, WITHDRAWN, SUPERSEDED (`09` §5).
- `identifier_type`: DOI, PMID, PMCID, EUROPEPMC, URL, OTHER (`05` §5).
- `intervention_type`: REMEDY, POTENCY, REGIMEN, OTHER (`05` §5).
- `import_method`: MANUAL, CONNECTOR (`05` §5).
- `app_role`: PUBLIC, REVIEWER, ADMIN (`16` §3).
- `review_action`: APPROVE, REJECT, REQUEST_CHANGES, EDIT, PUBLISH (`05` §5).
- `correction_status`: OPEN, ACCEPTED, REJECTED, MERGED (`05` §5).
- `import_job_trigger`: MANUAL, SCHEDULED (`05` §5).
- `import_job_state`: PENDING, RUNNING, COMPLETED, FAILED (`11` §8).
- `import_candidate_state`: DISCOVERED, FETCHING, FETCHED, NORMALIZED,
  DUPLICATE_CANDIDATE, IMPORTED, FAILED, REVIEW_REQUIRED (`11` §8).
- `ai_job_status`: PENDING, RUNNING, SUCCEEDED, FAILED, REJECTED (`10` §4, §9).
- `ai_validation_status`: PENDING, VALID, INVALID (`10` §6).

# 5. Tables & Relationships

### Reference / taxonomy (curated, admin-extendable)
- **`taxonomy_version`** — `code` (e.g. `taxonomy-v1`), description. Every
  taxonomy row records the version it belongs to (`06` §2).
- **`study_type`** — `code` (unique), label, `is_clinical`, `subject_type`,
  `evidence_level_id` (FK, the coarser grouping), `hierarchy_position`,
  `taxonomy_version_id`. (`06` §3.)
- **`evidence_level`** — `code` (unique), label, `pyramid_rank`
  (**navigation ordering, not a truth score**), `taxonomy_version_id`. (`06` §4.)
- **`condition`** — `canonical_name`, `slug` (unique), `synonyms text[]`,
  `parent_id` (self-FK), description. (`05` §5.)
- **`intervention`** — `canonical_name`, `slug` (unique), `synonyms text[]`,
  `intervention_type`, description. (`05` §5.)
- **`tag`** — `label`, `slug` (unique). (`05` §5.)

### Bibliographic
- **`author`** — `normalized_name`, `display_name`, `orcid` (nullable),
  `disambiguation_notes`. **No reputation/popularity score** (`13` §2).
- **`journal`** — `normalized_name`, `issns text[]`, `publisher`, `homepage_url`.

### Provenance / source
- **`research_source`** — `name`, `url`, `import_method`, `external_id`,
  `imported_at`, `verification_timestamp`, `license_info`,
  `transformation_notes` (`05` §5, §8, `17` §3).

### Core research (Study ≠ Publication)
- **`research_study`** — `canonical_title`, `normalized_title` (dedup support),
  `study_type_id` (FK, human-final, nullable), `subject_type`, `lifecycle_state`,
  `publication_state`, **`is_demo`** (NOT NULL default `false`). (`05` §4, §6, §7.)
- **`publication`** — `study_id` (FK), `title`, `abstract`, `publication_date`,
  `language`, `journal_id` (FK, nullable), `source_id` (FK, nullable),
  `is_primary`, `is_demo`, `search_vector` (generated `tsvector`). (`05` §4.)
- **`publication_author`** — join, `author_order`, `PK(publication_id, author_id)`
  (ordered authorship, `05` §4).
- **`research_identifier`** — `study_id`/`publication_id` (at least one, CHECK),
  `type`, `value_raw`, `value_canonical`. **`UNIQUE(type, value_canonical)`**
  is the exact-identifier dedup gate (`05` §11, `11` §7).

### Study ↔ taxonomy links
- **`study_condition`**, **`study_intervention`**, **`study_tag`** — join tables,
  composite PKs.

### Classification dimensions (independent)
- **`classification`** — `study_id`, `dimension`, `final_value` (H, nullable
  until reviewed), `final_actor`, `final_reason`, `ai_result_id` (AI, nullable),
  `confidence`, `explanation`. **`UNIQUE(study_id, dimension)`**. A validation
  trigger checks `final_value` against the correct vocabulary per dimension
  (outcome enum, study-type/evidence-level codes, confidence/quality enums). The
  AI suggestion and the human final value are never the same column (`05` §9,
  `07` §8, `ADR-006`).
- **`evidence_quality_assessment`** — `study_id`, `dimension` (quality_dimension),
  `value` (quality_assessment_value), `note`, `actor`, `ai_result_id`.
  **`UNIQUE(study_id, dimension)`**. Stored entirely separately from outcome
  (`08` §2–3).

### Criticism (≠ negative outcome)
- **`criticism`** — `study_id`/`publication_id` (at least one, CHECK),
  `category`, `origin`, `text`, `source_reference`, `source_url`, `actor`,
  `ai_result_id`, `status`. Adding criticism never mutates any outcome value
  (`09` §4).

### Users, review, correction, audit
- **`app_user`** — `id` (uuid; corresponds to the Supabase `auth.users` id /
  `auth.uid()`), `email`, `display_name`, `role` (`app_role`). Reviewers never
  receive DB-admin privileges (`16` §3).
- **`review`** — `study_id`, `reviewer_id`, `action`, `dimensions text[]`,
  `before_snapshot jsonb`, `after_snapshot jsonb`, `reason` (`05` §5).
- **`correction`** — `target_type`, `target_id`, `study_id`, `field`,
  `proposed_value`, `submitter`, `status`, `resolution_actor`, `reason`.
  Canonical values are never overwritten by community input (`13` §4).
- **`audit_log`** — `actor`, `action`, `entity`, `entity_id`, `field`,
  `before jsonb`, `after jsonb`, `reason`. **Append-only** — a trigger rejects
  `UPDATE`/`DELETE` (`05` §10, `12` §13).

### Import infrastructure (schema only)
- **`import_job`** — `source_id`, `trigger`, `state`, `counts jsonb`,
  `started_at`, `ended_at`, `error_detail` (`05` §5, `11` §8).
- **`import_candidate`** — `import_job_id`, `raw_payload jsonb`,
  `normalized_payload jsonb`, `dedup_decision`, `duplicate_of_study_id` (FK),
  `state`, `error_detail`. Failures are visible, never swallowed (`11` §8).

### AI infrastructure (schema only — no AI logic)
- **`ai_job`** — `research_study_id`, `operation`, `provider`, `model`,
  `prompt_version`, `input_hash`, `status`, `cost_estimate`. **Unique cache key**
  `UNIQUE(research_study_id, operation, input_hash, model, prompt_version)`
  (`10` §8, `21` §4).
- **`ai_result`** — `job_id`, `structured_output jsonb`, `confidence`,
  `validation_status`. **Immutable / append-only** — a trigger rejects
  `UPDATE`/`DELETE`; a new run creates a new job+result (`10` §4).

# 6. Constraints (integrity highlights)

- `UNIQUE(type, value_canonical)` on `research_identifier` — exact-identifier
  deduplication (`05` §11).
- `UNIQUE(study_id, dimension)` on `classification` and on
  `evidence_quality_assessment` — one value per dimension per study.
- `UNIQUE` cache key on `ai_job` (`10` §8).
- `slug`/`code` uniqueness on taxonomy tables.
- CHECK "at least one target" on `research_identifier` and `criticism`.
- `classification.final_value` validated per dimension by trigger.
- Append-only triggers on `audit_log` and `ai_result`.
- All FKs `ON DELETE` chosen conservatively: `CASCADE` for owned children
  (publication → identifiers, study → classifications), `RESTRICT`/`SET NULL`
  for references that must not silently destroy history (e.g. `ai_result_id`,
  `reviewer_id`).

# 7. Indexes & Full-Text-Search Preparation

- Uniques above are backed by unique indexes.
- FK/lookup indexes on `publication.study_id`, `research_identifier.value_canonical`,
  `classification.study_id`, `criticism.study_id`, `review.study_id`,
  `import_candidate.import_job_id`, `ai_result.job_id`, `ai_job.research_study_id`,
  and the join tables.
- Lifecycle/publication-state indexes: `research_study(publication_state)`,
  `research_study(lifecycle_state)`, `publication(study_id)` — for the review
  queue and the public read path (`05` §12).
- `research_study(normalized_title)` for title-similarity dedup lookups.
- **FTS:** `publication.search_vector` is a `STORED` generated column
  (`to_tsvector('english', title || abstract)`) with a **GIN index** (`14` §2–3,
  `ADR-009`). Author/journal/condition/intervention search is composed via joins
  at query time in M4; the column prepares the title/abstract path now.

# 8. Row-Level Security Model

The database is the **authoritative security boundary** (`16` §4, `04` §15). RLS
is enabled on **every** table. Security never depends on client-side hiding.

**Roles** (these exist in real Supabase — they are **not** invented): `anon`,
`authenticated`, `service_role`. `service_role` has `BYPASSRLS` and is the only
path for privileged server-side writes; it is never exposed to the browser
(`16` §5).

**Helper functions** (in `app`, `SECURITY DEFINER`, `search_path=''`):
`app.is_reviewer_or_admin()`, `app.is_admin()` — resolve the caller's app role
from `app_user` keyed by `auth.uid()`. `SECURITY DEFINER` avoids RLS recursion.

**Read policies**
- **Public-readable** (published research and its children): `research_study`
  (`USING publication_state = 'PUBLISHED'`), and `publication`, `classification`
  (also `final_value IS NOT NULL`), `criticism` (also `status='ACTIVE'`),
  `evidence_quality_assessment`, `research_identifier`, `publication_author`, and
  the study↔taxonomy joins — each gated by an `EXISTS` check that the parent
  study is `PUBLISHED`. Granted to `anon` + `authenticated`.
- **Reference/bibliographic** (`taxonomy_version`, `study_type`,
  `evidence_level`, `condition`, `intervention`, `tag`, `author`, `journal`,
  `research_source`): public `SELECT` — non-sensitive catalogue data.
- **Reviewer/Admin superset:** an additional permissive policy grants
  `authenticated` reviewers/admins read access to all rows (drafts included) via
  `app.is_reviewer_or_admin()`.
- **Private** (`app_user`, `review`, `correction`, `audit_log`, `import_job`,
  `import_candidate`, `ai_job`, `ai_result`): **no `anon` policy** (hard-denied)
  plus no `SELECT` grant to `anon`; `authenticated` reviewers/admins only.
  `app_user` additionally lets a user read their own row.

**Write policies (M2 posture):** anon and authenticated are granted **no**
`INSERT`/`UPDATE`/`DELETE` on any table. **All mutations go through
`service_role`** (server-side), which bypasses RLS. Reviewer-facing write flows
arrive with the M3 admin workflow (server-side, audited). This guarantees that in
M2 *no unauthorized role can mutate protected data* — verified by tests.

# 9. Seed Strategy — Reference vs Demo (kept strictly separate)

- **Reference data is canonical** and ships as a **migration**
  (`0009_reference_data.sql`): `taxonomy-v1`, the 13 study types, the 10 evidence
  levels + their mapping, and a small starter set of conditions / interventions /
  tags. Production needs this to function; it is versioned like schema (`06` §9).
- **Demo research fixtures** are **not** a migration. They live in
  `supabase/seed/demo_fixtures.sql`, are loaded only for local dev/tests, and are
  **impossible to mistake for real research**:
  - every row has `is_demo = true` (column defaults to `false`, so real inserts
    are never demo);
  - every study/publication title is prefixed `[DEMO]`;
  - demo DOIs use the reserved non-existent registrant `10.0000/…` (`17` §10,
    `20` §6).

Demo fixtures cover the required representative cases (`20` §6): positive,
negative, mixed/leaning, neutral/inconclusive, missing-DOI, duplicate-candidate,
one study with multiple publications, an AI suggestion overridden by a human, a
study carrying criticism, and a draft/unpublished study. **No real scientific
claim is asserted** — fixtures are labelled DEMO and use invented content.

# 10. Data-Access Package (`packages/database`)

- Framework-independent: **no** Astro, React, Supabase-client, or AI imports in
  its published surface. SQL is isolated from the UI (`23` §5).
- Reuses **`@wise-evidence/domain`** `normalizeDoi()` for DOI canonicalisation —
  DOI logic is **not** duplicated. `packages/domain` stays free of DB/Supabase/AI
  deps (`23` §5).
- Exports: the canonical enum/constant sets and TypeScript types (single source
  of truth shared with tests and later app code), the ordered migration file list
  loader, and the reference/demo seed SQL locators.
- A **test-only** harness (`packages/database/test/`, not part of the exported
  API) boots the deterministic PostgreSQL test database.

# 11. Deterministic Testing Approach (no live Supabase required)

- **PGlite** (`@electric-sql/pglite`) — a real PostgreSQL (WASM) running
  in-process — is the architecture-approved, deterministic,
  PostgreSQL-compatible local infrastructure. No Docker, no network, no paid
  service, runs in CI (`20` §2, `21` §3). Recorded in `ADR-013`.
- Because PGlite is stock PostgreSQL, it does **not** ship Supabase's `anon` /
  `authenticated` / `service_role` roles or the `auth.*` helper functions. A
  clearly-labelled **test shim** (`packages/database/test/supabase-shim.sql`)
  creates exactly those roles and an `auth.uid()`/`auth.role()` that read
  `request.jwt.claims` — **replicating what production Supabase already
  provides**, nothing invented. The canonical migrations contain **no** shim; the
  shim is loaded only by the test harness. Real-Supabase verification is tracked
  separately (§13).
- Tests set the session role (`SET LOCAL ROLE anon|authenticated`) and JWT claims
  to exercise RLS the way PostgREST would.

Tests verify (`20` §3, task contract): migrations apply; tables exist;
relationships work; constraints work; DOI uniqueness/dedup; Study/Publication
separation; classification-dimension independence; criticism does not become
outcome; an AI suggestion cannot become canonical without the human field;
publication state is enforced on the public read path; demo records cannot be
mistaken for production research; audit rows exist and are append-only; RLS
boundaries hold; anonymous users cannot read private data; unauthorized roles
cannot mutate protected data.

# 12. Migration Order (forward-only, idempotent where practical)

```text
0001_foundation.sql            schema app, enum types, generic triggers
0002_reference_taxonomy.sql    taxonomy_version, study_type, evidence_level,
                               condition, intervention, tag, author, journal,
                               research_source
0003_core_research.sql         research_study, publication, publication_author,
                               research_identifier, study_condition/intervention/tag
0004_ai_and_import.sql         ai_job, ai_result, import_job, import_candidate
0005_classification_criticism.sql  classification, evidence_quality_assessment,
                               criticism (+ classification validation trigger)
0006_users_review_audit.sql    app_user, review, correction, audit_log
                               (+ append-only triggers)
0007_indexes.sql               performance/FK/lifecycle indexes + FTS GIN
0008_rls.sql                   role helper functions, RLS enable, grants, policies
0009_reference_data.sql        canonical reference seed (taxonomy-v1 data)
```

Supabase migrations are **forward-only** by convention (`19` §6–7: forward-fixing
preferred; destructive change needs a backup + ADR-level decision). DDL uses
`IF NOT EXISTS`/guarded drops where practical so a partial apply can be re-run.

# 13. Supabase Verification Status

**PENDING.** The deterministic portion (migrations, constraints, RLS, seed,
tests) is fully verified against PGlite in CI. Applying the same migrations to a
live Supabase project (`supabase db push`) and re-checking RLS with real
`auth.users`/JWTs is deferred until a project is provisioned — no live Supabase
project is required to complete M2, and none is created here (no credentials, no
service-role keys committed).

# 14. Cost

Zero recurring cost. PGlite is a dev/test dependency; no database service, search
cluster, or AI provider is provisioned (`21` §2–3, §7).
