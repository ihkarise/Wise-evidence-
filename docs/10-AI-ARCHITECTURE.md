# WiseEvidence
## AI Architecture

**Document:** `docs/10-AI-ARCHITECTURE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `04-SYSTEM-ARCHITECTURE.md`, `05-DATABASE-ARCHITECTURE.md`, `16-SECURITY.md`, `21-COST-CONTROL.md`

---

# 1. Purpose

Define the AI subsystem: provider abstraction, tasks, prompts, validation,
caching, provenance, cost control, and — critically — the boundary that keeps AI
an **assistant, not the final authority** (`00` §3, master prompt §9).

# 2. Core Principle

```text
AI ≠ Final Authority
```

AI may extract, summarize, classify, tag, detect duplicates, and find related
research. It may **not** silently publish public classifications. Every AI output
is a *proposed interpretation* until a human reviews it where review is required
(`05` §9, `07` §8).

# 3. Provider Abstraction

Application logic never imports a provider SDK directly. It calls a
provider-independent service:

```text
AIService  (domain-facing operations)
   ├── summarizeResearch()
   ├── classifyOutcome()
   ├── classifyStudyType()
   ├── assessQuality()
   ├── extractCriticism()
   ├── extractMetadata()
   ├── generateKeywords()
   └── detectDuplicate()

AIProvider (swappable implementations, selected below the interface)
   ├── MockProvider        (deterministic, default in dev/test)
   ├── Provider A / B / C  (e.g. cheap hosted models)
   └── LocalProvider       (self-hosted / open-source model)
```

- `AIProvider` is selected by configuration, per task, choosing the **cheapest
  suitable** model (`21`).
- The domain (`Research`, `Classification`) contains **no** provider-specific
  code (`04` §17).

# 4. Job & Result Model

```text
AIJob    → operation, provider, model, prompt_version, input_hash,
           status, cost_estimate, created_at
AIResult → job_id, structured_output, confidence, validation_status, timestamp
```

Results are **immutable**. A new model, new prompt version, or changed input
creates a **new** job+result — historical results are never overwritten
(`05` §10, master prompt §69).

# 5. Prompts & Versioning

- Critical prompts live in the top-level `prompts/` directory, **not** buried in
  application code (master prompt §44).
- Layout: `prompts/<task>/vN.md`, e.g. `prompts/outcome-classification/v1.md`.
- Every AIResult records the `prompt_version` that produced it, so the database
  can always identify which prompt generated a value (master prompt §70).

Prompt tasks (initial):
`research-summary · outcome-classification · evidence-quality ·
criticism-extraction · metadata-extraction · duplicate-detection`.

# 6. Structured Outputs & Validation

Raw model output is **never trusted**. Every result is validated before storage
(master prompt §67):
- JSON structure / schema conformance.
- Enum values valid against the taxonomy (`06`, `07`, `08`, `09`).
- Required fields present; confidence within range; max lengths enforced.
- Any referenced taxonomy id exists.
Malformed output is rejected → retried (bounded) → routed to the review queue.

# 7. Cheap-First Escalation

```text
Cheap model
  → confidence check / validation
  → escalate to a stronger model only when necessary
  → still requires human review for published classifications
```

Do not send every paper through an expensive model (`00` §14, master prompt §11,
`21`).

# 8. Caching

Cache key (`04` §25):

```text
research_id + operation + input_hash + model + prompt_version
```

If nothing relevant changed, reuse the cached result rather than re-calling the
provider. Cache invalidation follows changes to input, model, or prompt version.

# 9. Retries

Bounded retries only — never infinite loops (master prompt §68):

```text
Attempt 1 → Retry (bounded) → Failed → Review queue
```

# 10. AI Provenance

Every AIResult preserves: provider, model, prompt_version, input_hash, output,
timestamp, status, confidence, and cost information where available
(`00` §9–10, `04` §26). This provenance is queryable and shown (in admin, and in
public "AI-assisted" labeling).

# 11. Human Review Boundary

```text
AI suggestion → Human review → Final published value
```

- Published public classifications reflect human-reviewed final values.
- AI-only values are labeled "AI-assisted, pending review" and never presented as
  authoritative (`05` §9).
- Human overrides preserve both the AI suggestion and the human decision +
  reason (`07` §8, `12` §override).

# 12. Prompt-Injection Defense (critical)

Research abstracts, article text, and scraped web content are **untrusted input**
and are treated strictly as data (`16`, master prompt §30, §66):
- Paper/scraped text must **never** be able to override system instructions.
- Use clear separation between instruction context and untrusted content;
  constrain the model to structured outputs; validate everything (§6).
- Treat any instruction-like text inside a paper as content to classify, not a
  command to follow.

# 13. Failure Isolation

AI failure must not break research browsing or publishing of already-reviewed
records (`04` §46). If enrichment fails, the record remains in its prior state
and is surfaced for review; the public site is unaffected.

# 14. Local Development Without Paid AI

The `MockProvider` returns deterministic fixtures so developers and CI run the
full pipeline without spending money (`04` §47, `20`, `21`). Deterministic mocks
are the default AI provider in development and tests.

# 15. Cost Tracking

Where the provider exposes it, per-job cost is estimated and recorded on `AIJob`,
enabling the AI-cost success metric (`02` §14) and cost controls (`21`).

# 16. Milestone 6 — Delivered Implementation

M6 realizes this architecture as staff-triggered, suggestion-only enrichment.
Binding decisions are recorded in `ADR-016`.

- **`packages/ai`** — the provider-neutral surface. `AIProvider` interface +
  `enrich(task, input)`; `MockAIProvider` (deterministic; default in dev/test/CI)
  and `OpenAICompatibleProvider` (a host-configurable `chat/completions` client
  for **OpenRouter / DeepSeek / any OpenAI-compatible aggregator** — chosen at the
  M6 review gate for no model lock-in). No provider SDK is imported anywhere;
  `packages/domain` stays provider-free.
- **Six tasks** (all exposed in the editor): `summary`, `study-type`,
  `evidence-level`, `outcome`, `quality`, `criticism`. Each maps to an
  `ai_operation` (`0013` adds `CLASSIFY_EVIDENCE_LEVEL`) and to a strict output
  schema validated before storage (§6). AI confidence is the model's own
  certainty — labeled as such, distinct from the human `CONFIDENCE` dimension,
  and **never** part of the M5 statistics (§11, `docs/24`).
- **Prompt registry** — `prompts/<task>/v1.md`, loaded by the AI package; the
  active version is recorded on every `ai_job.prompt_version` (§5).
- **Persistence & cache** — `packages/database/src/ai-jobs.ts` writes `ai_job` +
  immutable `ai_result` under RLS (staff-read + staff-write, reviewer/admin;
  results are insert-only — migration `0014`) and reuses a prior
  `SUCCEEDED` result matching `study_id + operation + model + prompt_version +
  input_hash` (§8). No `RUNNING` state: a job is `PENDING` while in flight, then
  `SUCCEEDED`/`FAILED` (synchronous request; no enum change).
- **Orchestration** — `apps/web/src/server/ai.ts` selects the provider from
  server-only env (`AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`; never
  `PUBLIC_`), reads study input in a transaction, calls the provider *outside* the
  transaction, validates, persists, and returns the suggestion. The provider call
  never holds a DB lock, and AI failure leaves the record untouched (§13).
- **Editor UI** — per-task "Get AI suggestion" with Accept / Edit / Reject.
  Accept fills the matching control and threads `ai_result_id` into the save
  payload, so the human-final `classification` records which AI result it came
  from. Suggestions are labeled "AI-assisted — pending human review".
- **Copyright & injection** — input is built only from fields already held
  (title, human summary, study type, subject, journal, year, and abstract only
  where stored/permitted); full-paper text is never sent. Untrusted content is
  delimiter-wrapped and can never override instructions (§12, `docs/16`).
- **CI** — no live AI. The mock runs the full pipeline; the OpenAI-compatible
  adapter is tested through an injected fake `fetch`. Real provider access is a
  documented pending gate alongside Supabase (`docs/19` §11).
