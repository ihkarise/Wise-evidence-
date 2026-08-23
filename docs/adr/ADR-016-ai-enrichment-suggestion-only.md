# ADR-016: AI Enrichment as Suggestion-Only, Behind a Provider-Neutral Abstraction

**Status:** Accepted
**Date:** 2026-08-23
**Related:** `docs/10-AI-ARCHITECTURE.md`, `docs/16-SECURITY.md`, `docs/21-COST-CONTROL.md`, `ADR-005` (AI provider abstraction), `ADR-006` (human review requirement)

## Context

Milestone 6 introduces AI to WiseEvidence for the first time. AI must accelerate
staff review by proposing values, without ever becoming the authority for any
public classification. ADR-005 already fixed the *principle* of a provider
abstraction and ADR-006 the *principle* of mandatory human review; this ADR
records the concrete M6 realization: which provider surface is targeted, which
tasks are exposed, how suggestions are persisted, and the boundaries that keep AI
an assistant.

Two decisions were taken at the M6 architecture-review gate:

1. **Real adapter target** — an **OpenAI-compatible aggregator** (OpenRouter,
   DeepSeek, or a comparable open-source-model aggregator), not a single vendor
   SDK. This preserves "no model lock-in" and lets the cheapest suitable model be
   selected per deployment by configuration.
2. **Task scope** — **all six** enrichment tasks are exposed in the editor:
   summary, study-type, evidence-level, reported-outcome, evidence-quality, and
   criticism.

## Decision

1. **Suggestion-only boundary.** The only enrichment flow is
   `Research data → AI suggestion → Human review → Canonical final value`. AI
   never writes a canonical `classification`, never changes `lifecycle_state` or
   `publication_state`, never publishes, approves, changes roles, or bypasses
   RLS. Every AI output is stored **only** in `ai_job` / `ai_result` and becomes
   canonical only when a human performs `setClassification` (which records the
   originating `ai_result_id` as provenance).

2. **Provider-neutral abstraction (`packages/ai`).** Application code calls the
   `AIProvider` interface; no provider SDK is imported anywhere in the app or
   domain. Two implementations ship: `MockAIProvider` (deterministic, the default
   in dev, test, and CI) and `OpenAICompatibleProvider` (a host-configurable
   OpenAI `chat/completions` client for OpenRouter / DeepSeek / similar).
   Selection is by server-only env: `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`,
   `AI_API_KEY` — **never** `PUBLIC_`-prefixed and never shipped to the client.

3. **All six tasks, structured + validated.** `summary`, `study-type`,
   `evidence-level`, `outcome`, `quality`, `criticism`. Raw model text is never
   trusted: each task has a strict output schema (enum membership against the
   taxonomy, length caps, confidence range) validated before persistence.
   Malformed output is marked `validation_status = INVALID` / job `FAILED` and
   surfaced for manual review — never silently coerced.

4. **Prompt registry + versioning.** Prompts live in top-level
   `prompts/<task>/vN.md`. The active version per task is recorded on every
   `ai_job.prompt_version`, so any suggestion is reproducible to its exact prompt.

5. **Caching / idempotency.** A suggestion is reused when a prior `SUCCEEDED`
   job matches `study_id + operation + model + prompt_version + input_hash`
   (`docs/10` §8). Changing input, model, or prompt version produces a new job —
   results are immutable and never overwritten.

6. **No new `RUNNING` state.** Enrichment is synchronous within a staff request:
   a job is inserted `PENDING`, then transitioned to `SUCCEEDED` / `FAILED`.
   `PENDING` denotes the in-flight/attempted job; no `ai_status` enum change is
   made. (A future async/queued design may revisit this with its own migration.)

7. **AI confidence ≠ evidence confidence.** `ai_result.confidence` describes the
   model's self-reported certainty about a suggestion. It is labeled as such in
   the UI, is distinct from the human `CONFIDENCE` classification dimension, and
   **never** feeds the M5 statistics/landscape aggregates.

8. **Security & copyright.** Abstracts / titles / metadata are untrusted data:
   they are wrapped in explicit delimiters and can never override instructions
   (`docs/10` §12, `docs/16`). Full-paper text is never sent or stored; input is
   built from fields already held (title, human summary, study type, subject,
   journal, year, and abstract only where already stored/permitted).

9. **CI stays free and offline.** No live AI call runs in CI. Tests exercise the
   mock and validate the OpenAI-compatible adapter through an injected fake
   `fetch`. Real provider calls are a documented pending gate, like Supabase.

Two additive schema changes accompany this ADR: migration `0013` adds
`CLASSIFY_EVIDENCE_LEVEL` to the `ai_operation` enum (so the sixth task has a
provenance operation), and migration `0014` widens `ai_job` / `ai_result` writes
from admin-only to reviewer-or-admin (enrichment is staff-triggered) while making
`ai_result` insert-only (immutable). Neither changes any canonical boundary: AI
still writes only to these provenance tables; human-final classification stays
reviewer/admin and publication stays ADMIN-only.

## Consequences

- Staff get one-click suggestions for all six dimensions with Accept / Edit /
  Reject, and every accepted value keeps a provenance link to the AI result.
- Swapping models or aggregators is a config change; no application code changes.
- Because suggestions live only in `ai_job`/`ai_result` and canonicalization
  requires a human `setClassification`, the credibility invariant
  (`AI ≠ Final Authority`) is enforced structurally, not by convention.
- Any future capability that would let AI write canonical values, auto-publish,
  produce a public score, or run without human review is out of scope and
  requires a new ADR.
