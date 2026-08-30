# M7 Implementation Plan — Automated Research Discovery

**Status:** plan only. **M7 IMPLEMENTATION = NOT STARTED. AUTHORIZATION = NOT
GRANTED.**
**Design:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`, `docs/adr/ADR-020-…md`
**Consistency:** builds the "Phase 7" foundation that `docs/24` / `ADR-012` (M8)
extend.

This breaks a *future, authorized* M7 into small, independently-shippable
sub-milestones. Each is additive, failure-isolated, offline-testable, and preserves
every credibility rule. A sub-milestone that cannot be finished cleanly is deferred,
not half-built. Nothing here is code; it is the order in which code would be written.

## Guardrails for every sub-milestone

- No `Source → Draft` and no `Source → Published` path; output is `ImportCandidate`
  only.
- All schema changes are version-controlled migrations with rollback + tests; **none
  are created before implementation is authorized.**
- Injected `fetch` + fixtures; CI stays offline. Live-source tests are opt-in.
- Reuse existing substrate: `@wise-evidence/domain` normalizers, `packages/metadata`
  sanitization, `packages/ai` (only downstream of review), the M3 review/publish
  workflow + audit, RLS.
- Extend `packages/domain/test/architecture-boundaries.test.ts` to pin new seams
  (discovery package imports no vendor SDK; discovery never imports the publish/
  canonical-write ops; orchestrator depends only on the `DiscoveryProvider`
  interface).

## Sub-milestones

### M7.1 — Connector contract (no network)
- Define `DiscoveryProvider` (`discover`/`fetch`/`normalize`), `SourceDescriptor`,
  `DiscoveryQuery`, `SourceItem(Ref)`, and widen `NormalizedResearchInput` beyond the
  M3 `NormalizedMetadata`. Pure types + a **deterministic mock connector**.
- Tests: contract conformance, mock determinism, no vendor import.
- Exit: interface + mock compile and are covered; zero network; zero schema change.

### M7.2 — First source connector (Crossref), fixture-only
- Implement `CrossrefConnector` against the contract, reusing the existing
  host-pinned, injected-fetch, timeout+size-capped fetch pattern. **No live calls in
  CI** — fixtures only.
- Tests: happy path, malformed/empty response, timeout, 429+`Retry-After`, oversize
  body, SSRF refusal (non-allowlisted host / non-HTTPS), UA/politeness contact from
  env.
- Exit: connector passes all fixture tests offline.

### M7.3 — Discovery run (orchestrator + bounded loop)
- Source-agnostic orchestrator: registry lookup → cap validation → bounded
  discover/fetch loop → run record with counts/state. ADMIN-triggered only.
- Tests: per-run caps stop the run; run state/counts correct; one bad item fails that
  item, not the run; unavailable source recorded, existing data untouched.
- Exit: a bounded run executes end-to-end against the mock/fixture connector.

### M7.4 — Normalization + identifier resolution
- Deterministic normalization via domain normalizers; identifier resolution
  (`DOI→PMID→PMCID→source id→URL`), canonical vs alternate.
- Tests: normalization snapshots; malformed/missing identifiers recorded (never
  delete); canonical form matches `normalizeDoi()`.
- Exit: `SourceItem → NormalizedResearchInput` is deterministic and covered.

### M7.5 — Deduplication (conservative, graded)
- Candidate-level idempotency `(source_key, stable_source_id)`; research-level graded
  dedup (definite→link, probable/possible→review). Never merge/delete.
- Tests: exact DOI/id links (study≠publication); weak match → `DUPLICATE_REVIEW`;
  re-run is a no-op (idempotency); multi-publication separation.
- Exit: dedup grades are correct and conservative.

### M7.6 — Candidate queue (persistence + lifecycle)
- Persist candidates + lifecycle (`DISCOVERED…READY_FOR_REVIEW/FAILED/…`) through the
  `packages/database` service boundary. Any additive schema authored here as a
  migration (see §Schema). RLS keeps candidates private.
- Tests: lifecycle transitions; RLS (anon hard-denied); append-only integrity.
- Exit: candidates persist with correct state and privacy.

### M7.7 — Human review integration
- Extend `/admin/imports` + review surface: source, identifiers, dedup reason,
  provenance, errors; actions accept/reject/link-duplicate/correct/refetch/defer.
  Accept → `createDraft()`. Publication stays ADMIN-only.
- Tests: reviewer can act but not admin-control sources/publish; accept creates a
  draft, not a study directly; audit entries written.
- Exit: a discovered candidate can be reviewed and promoted by a human.

### M7.8 — Provenance & audit
- Append-only source-observation record; raw-payload hash; transformation notes;
  audit on every state change. No full-text hosting; metadata minimization.
- Tests: provenance written and append-only; re-sighting adds an observation, never
  overwrites; audit completeness.
- Exit: every candidate is fully traceable.

### M7.9 — Scheduling (design/decision only in M7)
- **Do not build a scheduler in M7.** Record the decision to run on-demand; evaluate
  GitHub Actions cron vs Render cron vs Supabase scheduled fn vs a custom worker
  ("Hermes") on cost/reliability/secrets/limits/observability/recovery (`docs/30`
  §14). Recommendation: defer; prefer the simplest free mechanism when a cadence is
  justified.
- Exit: decision recorded; no scheduler code.

### M7.10 — Optional AI enrichment hook (downstream only)
- Wire the existing M6 enrichment so it can run on an accepted **draft** (never on a
  candidate, never during discovery), as a suggestion with human accept/edit/reject.
- Tests: no AI in the discovery path; enrichment only post-draft; firewalls intact.
- Exit: AI remains a downstream suggestion engine; discovery stays AI-free.

## Schema (design only — authored in M7.6, not now)

Additive migrations, each with rollback + RLS + tests, consistent with `docs/24` §12.
No migration is created by this plan.

| Change | Table | Column / constraint | Index | RLS | Reason |
|--------|-------|---------------------|-------|-----|--------|
| Idempotency key | `import_candidate` | `source_key`, `stable_source_id`, `ingest_key`, `last_seen_at`; **unique `(source_key, stable_source_id)`** | unique on the pair | staff-only (unchanged) | re-run safety; no duplicate candidates |
| Dedup transparency | `import_candidate` | `dedup_reason` (reuse `dedup_decision`), keep `duplicate_of_study_id` | — | staff-only | reviewer sees why flagged |
| Run operations | `import_job` | `source_key`, counts (`discovered/new/duplicates/errors`), `started_at`, `ended_at`, `error_summary`, `request_count` | `(source_key, started_at)` | staff read; ADMIN control | run observability |
| Source registry | `research_source` | `key` (unique), `enabled`, `health_status`, `last_run_at`, `last_success_at`, `consecutive_failures`, `checkpoint` (jsonb) | unique `key` | read staff; write ADMIN | governed, health-tracked sources |
| Provenance | new `import_source_observation` | append-only: candidate ref, `fetched_at`, `raw_payload_sha256`, transformation notes | by candidate | staff read | append-only lineage |

Reuse the existing `import_candidate_state`/`import_job_state` enums where possible;
add enum values only if a state has no equivalent, as its own migration.

## Definition of done for M7 (when authorized)

All sub-milestones green offline; architecture-boundary guards extended and passing;
one source discoverable end-to-end to a reviewable candidate; zero auto-draft/auto-
publish; RLS/SSRF/provenance/audit covered; docs/manifest/ADR index updated; live-
source verification remains opt-in/PENDING.

**M7 IMPLEMENTATION = NOT STARTED. AUTHORIZATION = NOT GRANTED.**
