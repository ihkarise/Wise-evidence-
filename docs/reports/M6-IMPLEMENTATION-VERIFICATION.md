# WiseEvidence — Milestone 6 Implementation Verification

**Report:** `docs/reports/M6-IMPLEMENTATION-VERIFICATION.md`
**Milestone:** 6 — AI-Assisted Evidence Enrichment
**Related:** `docs/29-AI-ENRICHMENT.md`, `ADR-017`, `docs/10-AI-ARCHITECTURE.md`
**Date:** 2026-08-29

This report records the ACTUAL verification results for the Milestone 6
implementation. Nothing here is fabricated: where a check requires a live AI
provider or a provisioned Supabase project, it is marked **PENDING**, not invented.

---

## 1. Automated quality gate (all run locally in this environment)

| Check | Command | Result |
|-------|---------|--------|
| Install | `pnpm install --frozen-lockfile` | ✅ resolved, lockfile respected |
| Tests | `pnpm -w test` | ✅ **246 passed** (20 files), 0 failed |
| Typecheck | `pnpm -w typecheck` | ✅ 0 errors (5 packages `tsc --noEmit` + `apps/web` `astro check` 0 errors) |
| Lint | `pnpm -w lint` | ✅ eslint clean |
| Format | `pnpm format:check` | ✅ all files match Prettier style |
| Build | `pnpm --filter @wise-evidence/web build` | ✅ built (client + SSR server) |
| Whitespace | `git diff --check` | ✅ clean |

### Test breakdown (246 total = 176 preserved M1–M5 + 70 new M6)

- `packages/ai/src/providers/providers.test.ts` — 12 (mock determinism + all-task
  validity + usage null/fixture; OpenAI-compatible: success/usage, status mapping
  429/5xx/401/403/418, non-JSON, empty choices, timeout-abort, oversized,
  misconfig, **key never in error message**).
- `packages/ai/src/validation.test.ts` — 12 (valid per task; malformed JSON;
  unexpected field incl. fabricated DOI; invalid enum; invalid confidence;
  oversized string; oversized payload; too-many items; non-uuid candidate;
  injection-as-data).
- `packages/ai/src/orchestrator.test.ts` — 8 (valid run + provenance; cost
  only-with-pricing; bounded-retry on malformed → INVALID; transient failure →
  provider-error after retries; non-transient no-retry; retry recovery; untrusted
  wrapping; system-prompt-is-registry-not-input).
- `packages/ai/src/registry.test.ts` — 5 (load all; unknown version refused;
  manifest pins all; `verifyRegistry` passes; loaded hash == pinned hash).
- `packages/ai/src/hash.test.ts` — 6 (canonicalize key-order/array-order/undefined;
  hash determinism; per-field change; known SHA-256 vector).
- `packages/ai/src/cost.test.ts` — 5 (usage×pricing; null on missing usage; null on
  missing pricing; real zero → 0; parsePricing).
- `packages/database/test/ai.test.ts` — 14 (minimised input incl. no-DOI +
  duplicate candidates; record VALID; cache hit; cache isolation by
  prompt-version/model/input/operation; duplicate-key rejected; ai_result
  immutable; NULL usage → NULL cost; hard failure → FAILED job no result;
  getSuggestionOutput; append-only decision; accept writes canonical + records
  `ai_result_id` provenance; non-staff refused ×2).
- `packages/database/test/ai-security.test.ts` — 8 (anon hard-denied on
  ai_job/ai_result; non-staff sees none; reviewer reads; AI record + decision
  leaves lifecycle/publication state untouched; AI creates no canonical value; **M5
  firewall** — suggestion does not change the outcome distribution or overview; the
  published study's canonical outcome is unchanged; human-approved value DOES
  appear in M5).

## 2. Secret scan

| Check | Result |
|-------|--------|
| AI key / base URL / `Bearer` / `sk-` / `openrouter` in `apps/web/dist/client` | ✅ none found |
| `PUBLIC_AI_*` anywhere in source | ✅ none |
| `.env` tracked in git | ✅ no `.env` tracked |
| AI secret persisted in `ai_job` / `ai_result` | ✅ the DB layer never receives a key; only provider/model/task/prompt-version/hashes/usage are stored |
| Service-role key exposure | ✅ unchanged from M3; server-only |

The API key lives only in the `Authorization` header of the (injected-fetch)
provider and is never placed in an error message (a dedicated test asserts this),
a log line, or a database row.

## 3. Firewalls verified

- **Canonical firewall** — AI writes only `ai_job`/`ai_result`; canonical values
  are written only by the existing human ops (`setOutcome`/`setQualitySummary`/
  `addCriticism`/`updateStudyIdentity`), which now carry `ai_result_id` provenance.
  A test asserts an AI suggestion creates no canonical classification value.
- **Publication firewall** — the M3 ADMIN-or-service, non-demo, PENDING_REVIEW
  publish guard is untouched. AI has no publish/archive/lifecycle path; a test
  asserts state is unchanged after a suggestion + decision.
- **M5 firewall** — `stats.ts` counts only PUBLISHED + human `final_value`. A test
  generates a suggestion for a published study and asserts the outcome distribution
  and catalogue overview are byte-for-byte unchanged; a second test confirms a
  human-approved value does appear.
- **RLS** — `ai_job`/`ai_result` have no anon grant (anon reads are rejected
  outright) and are staff-only for authenticated users; verified against the real
  policies via the PGlite harness.
- **Immutability** — `ai_result` UPDATE is rejected by the 0006 append-only trigger
  (verified).

## 4. Database changes

- **Migration `0011_ai_enrichment.sql`** (additive, nullable, backward-compatible):
  `ai_job` gains `input_tokens`/`output_tokens`/`total_tokens` (non-negative),
  `started_at`/`finished_at`, `error_detail`, `prompt_content_hash`; `ai_result`
  gains `validation_error`, `raw_output_sha256`. No new tables, no RLS change, no
  new privilege. The migration applies cleanly (schema + RLS suites pass), and the
  DEMO fixtures keep working.

## 5. What is NOT included (by design)

- **No live AI call** in CI or in this verification — the default and CI provider is
  the offline `MockAIProvider`; the real provider is exercised only through an
  injected fake `fetch`.
- **No M6.1 benchmark**, no OpenRouter call, no API key requested or configured.
- **No scraping, no automated discovery, no new analytics/search infra, no
  efficacy/combined score.**

## 6. Pending (requires a real environment; not fabricated)

- **Live AI provider verification** — running the six tasks against a real
  OpenAI-compatible endpoint (token counts, latency, cost) is **PENDING** a secure
  server-side environment. No provider results, pricing, token counts, or latency
  are asserted here.
- **Live Supabase verification** — the browser/auth/DB round-trip of the enrichment
  endpoint and AI panel against a provisioned Supabase project is **PENDING**,
  consistent with M3–M5.

## 7. Status

- **M6 = COMPLETE.**
- **M6.1 = NOT STARTED** (later, secure environment only).
- **M7 = NOT STARTED.**
