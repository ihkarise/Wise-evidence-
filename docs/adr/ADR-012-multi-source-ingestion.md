# ADR-012: Multi-Source Ingestion — Source Registry, Idempotent Checkpointing, Deferred Scheduler

**Status:** Accepted (design; implementation blocked on Phases 1–7)
**Date:** 2026-08-28
**Related:** `docs/24-MULTI-SOURCE-INGESTION.md`,
`docs/11-DATA-IMPORT-ARCHITECTURE.md` §4–§11,
`docs/05-DATABASE-ARCHITECTURE.md` §5, §11,
`docs/16-SECURITY.md` §4, §10, `docs/21-COST-CONTROL.md`,
`docs/adr/ADR-007-manual-import-before-scraping.md`

## Context

Milestone 8 extends ingestion from a single Phase-7 connector to several approved
scholarly sources and hardens repeated ingestion. Three questions require a
recorded architectural decision because they constrain schema, security, and the
future automation boundary:

1. How are multiple connectors discovered, governed, and constrained?
2. How is repeated ingestion made safe (no uncontrolled duplicate candidates, no
   silent overwrite of prior discovery data)?
3. Does M8 introduce a production scheduler/worker?

At the time of this ADR the repository is documentation-only; Phases 1–7 (repo
foundation, database, manual MVP, AI mock, first connector) do not yet exist, so
this ADR governs the design and is implemented when that foundation lands.

## Decision

1. **Source registry.** Every connector is reached only through a registry with a
   static, validated `SourceDescriptor` (stable `key`, retrieval method, host
   allowlist, HTTPS requirement, timeout, response-size cap, per-run request and
   candidate caps, rate limit, emitted identifier types) plus an operational
   database row (`enabled`, `health_status`, run timestamps, failure counter,
   checkpoint). A connector runs only if its descriptor validates **and** its row
   is `enabled`. Outbound fetch is refused for any non-allowlisted host or
   non-HTTPS scheme.

2. **Idempotent checkpointing.** Each source keeps a checkpoint/cursor advanced
   transactionally with candidate persistence. Every item has a deterministic
   `ingest_key = (source_key, stable_source_id)` under a unique constraint, so a
   re-run of the same source is a no-op for unchanged items and records a new
   append-only source observation for changed ones — never a second candidate and
   never an overwrite. Cross-source dedup follows the fixed order
   `DOI → persistent id → normalized title → author+year → similarity`; exact
   identifiers link (study≠publication), weak matches route to human review, and
   nothing is auto-merged or deleted.

3. **No production scheduler in M8.** Runs are ADMIN-triggered, bounded, and
   on-demand. The checkpoint/idempotency design makes future scheduling safe, but
   the scheduler/worker/queue system is deferred to a later milestone and must be
   additive and failure-isolated (extends ADR-007).

Ingestion continues to produce only `ImportCandidate`s routed to human review
before `createDraft()`. There is no `Source → Draft` or `Source → Published`
path. Sources added now (Crossref, Europe PMC, PubMed) are free, keyless APIs;
no new infrastructure, no production AI, no scraping.

## Consequences

- **Positive:** repeated ingestion is safe and resumable; duplicates are
  conservative and reviewable; sources are governed and rate-bounded in one place;
  security (SSRF/RLS/secrets) and cost (free APIs, offline CI) posture is
  preserved; a future scheduler can be added without redesign.
- **Negative / accepted:** manual/on-demand runs only until a later scheduler
  milestone; the homeopathy-org candidate sources without structured APIs remain
  deferred (no scraping); implementation is blocked until Phases 1–7 exist.
- **Commits us to:** version-controlled migrations for the registry/candidate/job
  tables, unique `(source_key, stable_source_id)`, RLS keeping ingestion data
  private, and deterministic fixture-based tests.
