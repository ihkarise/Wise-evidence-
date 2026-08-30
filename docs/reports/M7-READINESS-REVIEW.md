# Milestone 7 Readiness Review — Automated Research Discovery

**Status:** review only. **M7 IMPLEMENTATION = NOT STARTED. M7 AUTHORIZATION = NOT
GRANTED.**
**Prepared by:** M6.3 offline hardening pass (2026-08-30).
**Scope:** assess whether the current architecture is a sound foundation for a
*future* M7 design review. This document **identifies prerequisites and open
questions**; it adds **no** discovery, scraping, crawling, connector, scheduler,
queue, or ingestion functionality. Those require a separate methodology/design
review and explicit owner authorization (CLAUDE.md §6; `docs/22-ROADMAP.md`).

> Naming note: the roadmap uses **M7 = Automated Research Discovery** and **M8 =
> Multi-Source Ingestion & Hardening**. The approved design checkpoint
> [`docs/24-MULTI-SOURCE-INGESTION.md`](../24-MULTI-SOURCE-INGESTION.md) (+
> `ADR-012`) already covers the ingestion pipeline both phases share. This review
> reads M7 as "the first automated connector that discovers candidates and feeds
> the existing human-review pipeline", and checks the substrate against that.

---

## 1. Current capabilities (verified, offline)

The manual pipeline the automated one must feed is **complete and test-covered**:

- **Manual research lifecycle (M3).** `DRAFT → PENDING_REVIEW → PUBLISHED` (+
  `ARCHIVED`/`REJECTED`), enforced by a DB state machine
  (`app.enforce_publication_transition`) with a fail-closed, demo-protected,
  ADMIN-only publish guard.
- **Provider-independent metadata (M3).** `packages/metadata` fetches Crossref/mock
  metadata behind an SSRF-hardened boundary, provider-independent.
- **Public explorer + evidence + statistics (M4/M5).** Published-only, parameter-
  bound query layers; separate outcome/quality/criticism axes; no efficacy/combined
  score.
- **AI enrichment (M6), suggestion-only.** AI never writes canonical data, never
  publishes, never changes lifecycle, never enters statistics — all firewalls
  test-covered.
- **Provider-agnostic AI (ADR-019).** Switch provider/model by configuration only.

## 2. Existing ingestion-related schema (already present, unused by app code)

The M2 database foundation **already models the discovery pipeline** — the tables
exist, carry RLS, and are staff-private, but no service-layer or UI code touches
them yet (they await M7/M8):

| Object | Purpose | State |
|--------|---------|-------|
| `research_source` | Registry of approved sources (name, url, `import_method`, `external_id`, `license_info`, `transformation_notes`, `verification_timestamp`) | Table + RLS present |
| `import_job` | One ingestion run (`trigger`, `state`, `counts` jsonb, timing, `error_detail`) | Table + RLS present |
| `import_candidate` | A discovered item (`raw_payload`, `normalized_payload`, `dedup_decision`, `duplicate_of_study_id`, `state`) | Table + RLS present |
| `research_identifier` | Canonical identifiers per study/publication (`type`, `value_raw`, `value_canonical`, unique) | Table + used by M3 |
| Enums | `import_method`, `import_job_trigger`, `import_job_state`, `import_candidate_state` | Present |

RLS: `import_job` and `import_candidate` are **staff-only read** (`anon` hard-denied,
authenticated narrowed to reviewer/admin). Grants match the private-table posture
(migration 0008; hardened by 0012).

## 3. Existing provenance model

Sufficient primitives already exist to record where a record came from and how it was
transformed:

- **Source provenance:** `research_source.{url, external_id, import_method,
  license_info, transformation_notes, verification_timestamp}`, linked from
  `import_job.source_id`.
- **Candidate provenance:** `import_candidate.{raw_payload, normalized_payload}` keeps
  the untransformed source payload beside the normalized form.
- **AI provenance:** provider, model, prompt version, input hash, output, timestamp,
  status, confidence, cost (M6) — carried through to canonical values via
  `ai_result_id`.
- **Audit:** append-only `audit_log` records human decisions and transitions.

**Gap:** no explicit **per-field canonical provenance** linking a published field
back to the exact `import_candidate` / connector run that proposed it (today AI
provenance is per-field via `ai_result_id`; import provenance stops at the candidate
level). M7 design should decide whether automated imports need field-level lineage.

## 4. Existing deduplication model

The credibility-critical dedup order is defined and partly implemented:

- **Order (docs/domain rules):** `DOI → PMID/persistent id → normalized title →
  author + year → similarity`. Never auto-delete on fuzzy match — route to review.
- **Implemented:** `packages/domain` `normalizeDoi()` and `normalizeTitle()`
  (test-covered); `research_identifier.value_canonical` with a uniqueness constraint;
  M3 draft creation already does **DOI dedup** on create.
- **Schema-ready but unused:** `import_candidate.dedup_decision` and
  `duplicate_of_study_id` model a duplicate-review outcome without deletion.

**Gap:** no service that runs the **full** dedup ladder (beyond exact DOI) over
import candidates, and **no duplicate-review UI/workflow** to adjudicate a
`DUPLICATE_CANDIDATE`. These are M7 work, not present today.

## 5. Existing review workflow

- Human-in-the-loop is the spine: `Import → AI enrichment → Review queue → Human
  review → Publish`. The **Review queue** and human decision/audit already exist and
  are enforced by RLS + the publish guard.
- The lifecycle enum already includes the automated-discovery states
  (`DISCOVERED`, `IMPORTED`, `PROCESSING`, `IMPORT_FAILED`, `DUPLICATE_CANDIDATE`)
  even though only the manual states are exercised today.

**Gap:** the review queue lists human-created drafts; it has no lane for
**machine-discovered candidates awaiting triage** (accept into pipeline / reject /
mark duplicate). That lane is M7 UI work.

## 6. Existing AI enrichment & audit

- AI enrichment is ready to run on *any* study regardless of origin (manual or
  imported) — the orchestrator, cache, and human-decision firewall are origin-
  agnostic. An automated import can reuse it unchanged.
- Audit is append-only and already records actor + action; it can absorb
  import/connector events with new action types.

## 7. Missing prerequisites for M7 (documented, not built)

None of the following exist yet; each is genuine M7 design/implementation work:

1. **Connector abstraction** — a provider-independent `Source connector` interface
   (discover → return raw payloads) mirroring the AI `AIProvider` seam, with a
   deterministic **mock connector** for offline CI. Nothing connector-shaped exists.
2. **Import service layer** — `packages/database` functions to open an `import_job`,
   insert `import_candidate`s, run the dedup ladder, and promote a candidate to a
   `DRAFT` study. No code touches the import tables today.
3. **Politeness/compliance layer** — robots/ToS respect, per-source rate limiting,
   backoff, and **egress allow-listing** (structured APIs preferred over HTML;
   licensing respected; no PDF hosting by default). Must exist before any live fetch.
4. **Idempotency & bounded runs** — idempotency keys and `counts`/state transitions so
   re-running a source is safe and observable (the `import_job.counts` jsonb is a
   placeholder for this).
5. **Duplicate-review workflow + UI** — adjudicate `DUPLICATE_CANDIDATE` without
   deletion; surface `dedup_decision`.
6. **Source registry admin UI** — manage `research_source` rows (add/verify/disable a
   source, record license terms) rather than raw row edits.
7. **Scheduling** — only if/when justified; the roadmap keeps discovery **manual-
   trigger first**. No scheduler/queue should be added speculatively (CLAUDE.md §4
   cost philosophy).
8. **Per-field import lineage** (see §3 gap) — a decision, then possibly schema.

## 8. Risks

- **Credibility risk (highest):** an automated path that publishes without human
  review, or that collapses outcome/quality/criticism, would corrupt the data model.
  Mitigated structurally today (publish guard, suggestion-only AI, separate
  dimensions) — M7 must **not** add a bypass. A CI architecture guard
  (`architecture-boundaries.test.ts`) already pins several of these seams.
- **Legal/licensing risk:** scraping before the compliance layer (item 3) exists
  would violate source terms. ADR-007 already forbids scraping-first.
- **SSRF/egress risk:** a connector that fetches operator- or source-supplied URLs is
  a fetch-anywhere primitive; reuse the base-URL SSRF hardening pattern from
  `packages/ai`/`packages/metadata`.
- **Cost risk:** running AI enrichment on every discovered item at scale is a
  measured-requirement decision, not a default (cache on
  `research_id + operation + input_hash + model + prompt_version` already exists).
- **Dedup over-merge risk:** fuzzy matching must route to review, never auto-delete
  (domain rule). The schema supports this; the service must honor it.

## 9. Open questions requiring methodology/design decisions

1. Which **first source** and access method (structured API vs. metadata feed)?
2. Manual-trigger only for M7, or a bounded schedule — and what justifies a scheduler?
3. Does an automated import need **per-field provenance** (§3), or is candidate-level
   provenance sufficient at M7?
4. What is the **minimum dedup ladder** for automated candidates before human triage
   (exact identifiers only, or through normalized-title/author-year)?
5. Confidence/threshold policy for auto-routing a candidate to `DUPLICATE_CANDIDATE`
   vs. a fresh draft.
6. Licensing/robots policy per source, and where it is recorded and enforced.
7. Should discovered-but-unpublished candidates ever be visible publicly? (Default
   **no** — published-only remains the anon contract.)

## 10. Conclusion

The substrate is **well-positioned** for a future M7 design review: the schema,
provenance primitives, dedup normalizers, review lifecycle (including the automated-
discovery states), AI enrichment, RLS, and audit already exist and are test-covered.
What is missing is exactly the connector/import/compliance/duplicate-review layer that
M7 is *for* — none of which should be built before its own design/methodology review
and explicit authorization.

**M7 IMPLEMENTATION = NOT STARTED. M7 AUTHORIZATION = NOT GRANTED.**
