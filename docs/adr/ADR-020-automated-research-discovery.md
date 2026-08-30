# ADR-020: Automated Research Discovery — Provider-Neutral Connector, Candidate-Only Output, Deferred Scheduler

**Status:** Accepted (design; implementation NOT authorized)
**Date:** 2026-08-30
**Related:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`,
`docs/11-DATA-IMPORT-ARCHITECTURE.md` §4–§11,
`docs/24-MULTI-SOURCE-INGESTION.md`, `docs/05-DATABASE-ARCHITECTURE.md` §5, §11,
`docs/16-SECURITY.md` §4, §8, §10, `docs/21-COST-CONTROL.md`, `docs/29-AI-ENRICHMENT.md`,
`docs/adr/ADR-005-ai-provider-abstraction.md`,
`docs/adr/ADR-007-manual-import-before-scraping.md`,
`docs/adr/ADR-012-multi-source-ingestion.md`,
`docs/adr/ADR-017-ai-enrichment.md`,
`docs/adr/ADR-019-provider-agnostic-ai-architecture.md`,
`docs/reports/M7-READINESS-REVIEW.md`

## Context

Milestone 7 (Phase 7, `22-ROADMAP.md`) introduces the **first automated research
discovery** path: a structured source connector that discovers, fetches, normalizes,
deduplicates, and queues external homeopathy research for human review. It is the
foundation the M8 multi-source design (`ADR-012`, `docs/24`) assumes and extends.

Unlike when `ADR-012`/`docs/24` were written (repository was documentation-only),
Phases 0–6.3 are now complete: the pnpm workspace, `packages/{domain,database,
metadata,ai,benchmark}`, `apps/web`, migrations `0001`–`0012` with RLS, the manual
research MVP, the public explorer/evidence pages, and the provider-agnostic AI
subsystem all exist and are test-covered (`M7-READINESS-REVIEW.md`). The ingestion
schema (`research_source`, `import_job`, `import_candidate`, `research_identifier`)
and discovery lifecycle enums already exist but are untouched by application code.

Four questions require a recorded decision because they constrain architecture,
schema, security, and the automation boundary:

1. How is a source reached without coupling the app to a vendor?
2. What may discovery produce — and what must it never produce?
3. Where does AI sit relative to discovery?
4. Does M7 introduce a scheduler/worker (and specifically, "Hermes")?

This ADR governs the **design**; implementation is a separate, explicitly-authorized
milestone. Nothing here is built in the authoring session.

## Decision

1. **Provider-neutral connector behind a registry.** The application depends on a
   `DiscoveryProvider` interface (`discover` / `fetch` / `normalize`), never on a
   vendor, mirroring the AI provider seam (`ADR-005`, `ADR-019`). Every connector is
   reached only through the source registry with a static, validated
   `SourceDescriptor` (stable `source_key`, retrieval method, **host allowlist**,
   HTTPS requirement, timeout, response-size cap, per-run request/candidate caps, rate
   limit, emitted identifier types) plus an operational `research_source` row
   (`enabled`, health, run timestamps, failure counter, checkpoint). A connector runs
   only if its descriptor validates **and** its row is enabled. Outbound fetch is
   refused for any non-allowlisted host or non-HTTPS scheme; the item id/DOI builds a
   path only, never chooses a host (SSRF control, `16` §10). `fetch` is injected, so
   CI is offline and deterministic.

2. **Discovery produces only `ImportCandidate`s.** Discovery never classifies,
   never invokes production AI, never merges or deletes records, and never creates a
   draft or publishes. Candidate lifecycle is separate from publication state.
   Promotion to a draft is a **human** action (`createDraft()`), and publication stays
   ADMIN-only behind the existing fail-closed, demo-protected guard (migration
   `0010`). Deduplication is conservative and grades matches
   (`DOI → persistent id → normalized title → author+year → similarity`): exact
   identifiers **link** (`Study ≠ Publication`), weak matches **route to review**, and
   nothing is auto-merged or auto-deleted (`Duplicate ≠ Delete`). Provenance is
   append-only; no full text is hosted merely because it was fetched.

3. **AI is downstream of discovery and is a suggestion engine.** No AI call occurs in
   the discovery path. AI may enrich a candidate only **after** it becomes a draft,
   reusing the provider-agnostic subsystem (`ADR-017`, `ADR-019`) with all existing
   firewalls intact (never canonical, never publish, never lifecycle, never
   statistics). Relevance is not efficacy: discovery introduces no efficacy/outcome/
   popularity ranking or combined score (`00` §3, `28`).

4. **No production scheduler in M7 (defer Hermes).** M7 runs are ADMIN-triggered,
   bounded, and on-demand. The checkpoint/idempotency design makes future scheduling
   safe, but the scheduler/worker/queue — and specifically the long-envisioned
   "Hermes" worker — is **deferred**. When a cadence justifies scheduling, the
   **simplest free, failure-isolated mechanism** that meets the need (e.g. an existing
   GitHub Actions cron invoking the same bounded run) is preferred over a bespoke
   worker; Hermes is adopted only if a measured requirement shows the simpler options
   are insufficient. This extends `ADR-007` and is consistent with `ADR-012` §3.

The first source is a free, keyless public API (Crossref is the natural first
connector; `docs/24` §4). No new infrastructure, no production AI, no scraping.

## Alternatives considered

- **Couple directly to one source SDK/HTTP client in app code.** Rejected: repeats
  the vendor-lock-in the AI seam (`ADR-019`) exists to avoid, and makes offline CI and
  a future second source harder. The registry + injected fetch cost little now and
  save a rewrite later.
- **Let discovery create drafts automatically (and let humans only review drafts).**
  Rejected: violates `Candidate ≠ Draft` and the human-authority rule (`ADR-006`);
  pollutes the research table and the review queue with unvetted machine output;
  undermines provenance and credibility.
- **Run AI relevance/classification during discovery to pre-filter.** Rejected for
  M7: makes AI a de-facto authority over what enters the pipeline, couples discovery
  to a provider, and risks efficacy-shaped ranking. AI stays downstream and
  suggestion-only.
- **Build a scheduler/worker (Hermes) now.** Rejected: no measured cadence
  requirement; adds cost, secrets surface, and maintenance for no current benefit.
  On-demand runs plus an idempotent design keep the door open without the spend.
- **Allow HTML scraping for the homeopathy-org sources without APIs.** Rejected for
  M7: `ADR-007` mandates API-first; scraping needs its own terms/robots review and
  owner sign-off. Those sources remain deferred candidates.

## Consequences

- **Positive:** discovery is provider-neutral, offline-testable, and safe by
  construction (candidate-only, human-gated, RLS-private); it reuses existing
  substrate (schema, normalizers, AI subsystem, publish guard) with minimal or no
  schema change; the M8 multi-source design layers on without redesign; security
  (SSRF/RLS/secrets) and cost (free API, offline CI, no new infra) posture is
  preserved; a future scheduler can be added additively.
- **Negative / accepted:** manual/on-demand runs only until a later scheduler
  decision; a single source at M7 (breadth is M8); no scraping-based sources; and
  implementation is blocked pending explicit authorization and a per-source terms/
  robots/licensing review.
- **Commits us to:** version-controlled additive migrations for any registry/
  candidate/job hardening (unique `(source_key, stable_source_id)`, health/checkpoint
  columns, append-only source observations), RLS keeping ingestion data private, the
  `DiscoveryProvider` interface + registry, injected-fetch SSRF-hardened connectors,
  and deterministic fixture-based tests — none authored in this design session.

## Status of implementation

**M7 DESIGN = COMPLETE. M7 IMPLEMENTATION = NOT STARTED. M7 IMPLEMENTATION
AUTHORIZATION = NOT GRANTED.**
