# WiseEvidence M6.2 Production Readiness

**Document:** `docs/reports/PRODUCTION-READINESS-6.2.md`
**Milestone:** 6.2 — Production Readiness + Live Provider Verification
**Date:** 2026-08-29
**Status legend:** VERIFIED · PARTIALLY VERIFIED · PENDING · BLOCKED

> This milestone is **verification and deployment preparation**, not features.
> M7 is **NOT started and NOT authorized**. Every infrastructure-dependent claim
> below is marked PENDING/BLOCKED where it could not be exercised from this
> environment; none is upgraded to VERIFIED on the basis of a previous report.

---

## Executive Summary

**Production Readiness Decision: READY WITH DOCUMENTED BLOCKERS.**

The application is code-complete and passes every offline gate: 331 tests pass
(1 live benchmark skipped), typecheck/lint/format are clean, the web build
succeeds, the secret scan is clean, and the compiled Astro Node **standalone
server starts and serves the public pages (200) while fail-closing `/admin` to
sign-in (302)**. The AI subsystem is provider-agnostic by configuration only, and
all M6 AI safety firewalls remain test-covered.

The remaining gates require real, external infrastructure that this environment
cannot legitimately reach:

- **Render deployment** — a `render.yaml` Blueprint for the *existing* Node
  standalone server was **created this milestone** (it was absent from the repo,
  contrary to the milestone brief's premise). Actual provisioning is an owner
  action; not performed here. **PENDING (owner).**
- **Live Supabase** connection, authentication, RLS, and the full research
  workflow against a real project. No project URL/keys are configured and none
  can be provisioned from here. **PENDING (owner).**
- **Live AI / OpenRouter benchmark** — `openrouter.ai` is unreachable from this
  environment's egress proxy (HTTP 000). Not routed around. **BLOCKED.**

No product features were added. One deployment descriptor (`render.yaml`) and
documentation were the only changes.

---

## Repository

**VERIFIED.** Inspected directly (`git`, `ls`, file reads). Reality vs. the
milestone brief:

| Brief premise | Repository reality |
| --- | --- |
| `render.yaml` exists | **Did NOT exist.** Created this milestone (see Render). |
| Migrations 0001–0012, no 0013/0014 | **Confirmed:** exactly `0001`–`0012`. |
| 331 tests pass, 1 skipped | **Confirmed.** |
| Typecheck/lint/format/build clean | **Confirmed.** |
| Provider-agnostic AI (ADR-019) | **Confirmed:** presets mock · openai-compatible · openrouter · ollama · lmstudio · vllm. |

Branch: `claude/wisevidence-m6-2-production-4vdasz`. Packages present: `ai`,
`benchmark`, `database`, `domain`, `metadata`; app in `apps/web`.

## Deployment

**PARTIALLY VERIFIED.** The deployable artifact is proven: `pnpm --filter web
build` emits `apps/web/dist/server/entry.mjs`, and running
`node apps/web/dist/server/entry.mjs` starts an HTTP server that answers real
requests (see Render / Public Research). Provisioning on a hosting provider is an
owner action and was **not** performed from this environment.

## Render

**PENDING (owner action).** `render.yaml` did not exist and was **created** as a
Blueprint for the **existing** `@astrojs/node` standalone server — no second SSR
architecture. It pins Node 22, uses the existing build command
(`pnpm install --frozen-lockfile && pnpm --filter web build`) and start command
(`node apps/web/dist/server/entry.mjs`), a `/` health check, `autoDeploy: false`,
and declares every credential with `sync: false` (no secret values committed; no
`PUBLIC_` prefix on server secrets). Local proof the server honours the runtime
contract: started with `HOST=127.0.0.1 PORT=4321`, it listened and served (below).
Actual `render.com` provisioning could not be performed here.

## GitHub Pages

**PARTIALLY VERIFIED (live PENDING).** Unchanged from ADR-018: the static preview
workflow builds under `SITE_BASE=/Wise-evidence-/`; production SSR sets neither
`SITE_BASE` nor `SITE_URL` (base stays `/`). Local subpath verification stands
from the production-readiness pass. The **live** `ihkarise.github.io/Wise-evidence-/`
URL cannot be opened from this egress-restricted environment — not claimed live.

## Supabase

**PENDING.** No `PUBLIC_SUPABASE_URL` / keys are configured in the repo, and no
project can be provisioned or reached from here. The SSR app degrades correctly
without them: public pages still render (200) and admin fail-closes. Live database
connection, auth, and role lookup are **PENDING** a provisioned project + owner
credentials.

## Migration State

**PENDING.** Repository migrations are `0001`–`0012` (VERIFIED by listing). The
**real production** migration state cannot be read from this environment and is
**not inferred** from prior reports. Owner must confirm which of `0001`–`0012` are
applied to the live project.

## Migration 0012

**VERIFIED (content) · PENDING (production application).** Read in full: it is
**REVOKE-only** — strips any Supabase default-grant that would give `anon` access
to the private/staff tables (`app_user`, `review`, `correction`, `audit_log`,
`import_job`, `import_candidate`, `ai_job`, `ai_result`), strips
`insert/update/delete/truncate` from `anon` across `public`, and revokes
`truncate` from `authenticated`. It **preserves** `anon` SELECT on the public
catalogue/research tables, `authenticated`'s M3 content grants, and
`service_role`'s `grant all`. Effect: defence-in-depth — moves the same denial one
gate earlier (privilege layer) than RLS; **no behaviour change** for legitimate
paths. Covered by `packages/database/test/grants.test.ts` (8 tests, passing).
Reversible in principle by re-granting, but there is no legitimate reason to.
**Applying it to production is an explicit owner decision; not applied here.**

## Authentication

**PARTIALLY VERIFIED.** Route-guard behaviour proven locally: anonymous `GET /admin`
→ **302** to `/admin/sign-in?next=%2Fadmin` (fail-closed, no Supabase configured).
Real Reviewer/Admin browser sign-in, `app_user` role lookup, and role-gated
capabilities (reviewer can create/edit/classify/submit but **not** publish/archive;
admin can approve/publish/archive) require a live Supabase project and are
**PENDING**.

## RLS

**PARTIALLY VERIFIED.** Enforced by migrations `0008`/`0010` and exercised by
deterministic PGlite tests (published-only anon reads, staff-only reads/writes,
audit isolation, publication guard). Verification **against the real project** is
**PENDING**. RLS is never bypassed for convenience.

## Admin Workflow

**PENDING (live).** Service/data-access layer (draft + DOI dedup, editor updates,
independent classifications, criticism, review transitions, `approveAndPublish()`,
append-only audit) is test-covered. End-to-end browser verification against real
Supabase is **PENDING**. The DEMO fail-closed publication guard (a `is_demo=true`
record can never be published) remains intact and must not be weakened for testing.

## Public Research

**PARTIALLY VERIFIED.** Against the local standalone server (no DB configured):
`/`, `/research`, `/evidence`, `/statistics` all return **200** and degrade
gracefully. Visibility guarantees (only PUBLISHED visible; drafts/pending/rejected/
archived, AI jobs/results, reviews, audit, import internals all invisible) are
enforced by RLS + the published-only query layer and are test-covered; **against
real published data they are PENDING**.

## Explorer

**PARTIALLY VERIFIED (code) · PENDING (live data).** `service/search.ts` is
PostgreSQL-only, published-only, fully parameter-bound, with **neutral sort options
only**. Grep confirms **no** efficacy score, popularity ranking, vote, or
positive-vs-negative weighting anywhere in the search path (only comments
forbidding them). Live search/filter/sort/paginate against real data is PENDING.

## Evidence

**PARTIALLY VERIFIED (code) · PENDING (live data).** `stats.ts` counts distinct
**studies** (`count(distinct s.id)`) so multi-publication studies count once;
evidence pyramid is a navigation device only. Confirmed by code inspection.

## Statistics

**PARTIALLY VERIFIED (code) · PENDING (live data).** Outcome, quality, and
criticism distributions are computed on **separate axes** — **no cross-tabulation**
and **no combined/efficacy/balance score** (confirmed in `stats.ts` and
`statistics/index.astro`). UNCLASSIFIED is explicit, never mapped to Neutral.

## Audit

**PARTIALLY VERIFIED.** `audit_log` is append-only, `anon` has no grant/policy
(0012 hardens this), and it is invisible on all public paths. Live confirmation
PENDING a real project.

## AI Provider Architecture

**VERIFIED.** Provider-agnostic per ADR-019: an `AIProviderRegistry`, separate
provider/model configuration, and thin presets (`mock`, `openai-compatible`,
`openrouter`, `ollama`, `lmstudio`, `vllm`) selected by configuration only, with
capability negotiation, base-URL SSRF policy, and secret-by-reference
(`secretRef`, server-only). Switching providers requires **no application code
change**. Mock is the keyless offline default (CI).

## Live Provider Verification

**BLOCKED.** `openrouter.ai/api/v1/models` is unreachable from this environment's
egress proxy (HTTP 000). The live benchmark was **not** run and network
restrictions were **not** circumvented. The existing provider-neutral harness
(`packages/benchmark`) remains ready; no new benchmark was built.

## Model Benchmark

**PENDING (no live evidence).** No real token/latency/cost/structured-output
measurements exist because no provider is reachable. See Primary/Fallback/Local
below.

## Cost

**VERIFIED (logic) · PENDING (live figures).** Cost derivation is unit-tested
(`packages/ai/src/cost.test.ts`): known usage + known pricing → calculated cost;
missing usage → null; missing pricing → null; local model → normally null. **Zero
is never silently written.** No live pricing is invented.

## Human Review

**VERIFIED (firewalls, test level).** The Accept/Edit/Reject workflow and its
guarantees (Accept → canonical changes; Edit → human value canonical; Reject →
canonical unchanged; AI result immutable; AI cannot publish or change lifecycle)
are enforced through the canonical ops with `ai_result_id` provenance and are
test-covered. Live browser walkthrough against real Supabase is PENDING.

## Security

**VERIFIED (offline).** Secret scan clean: no API keys, service-role keys, AI
secrets, DB credentials, or private tokens in source, built client assets, or
`render.yaml`. The only `PUBLIC_` env references are `PUBLIC_SUPABASE_URL` /
`PUBLIC_SUPABASE_ANON_KEY`; **no `PUBLIC_AI_*`**. `AI_API_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are server-only by construction. `render.yaml` commits
no secret values (`sync: false`).

## Accessibility

**VERIFIED (code, smoke).** `DistributionChart` uses a semantic `<table>` as the
**primary** representation, with an `sr-only` `<caption>`, `scope="col"/"row"`
headers, and purely decorative `aria-hidden` bars — no critical information depends
on colour, geometry, or hover. Full keyboard/screen-reader pass on the live site is
PENDING deployment.

## Performance

**PARTIALLY VERIFIED (code).** Public queries are published-only, parameter-bound,
and paginated; the explorer does not fetch the whole table, and stats use grouped
`count(distinct ...)` aggregates rather than N+1. No premature optimization for
millions of records. No real bottleneck found in code review; live profiling
PENDING deployment.

## Tests

**VERIFIED.** `pnpm -w test` → **331 passed, 1 skipped** (the env-gated live
benchmark), 33 files. `pnpm -w typecheck` → 0 errors/0 warnings. `pnpm -w lint`
clean. `pnpm -w format:check` clean. `pnpm --filter web build` → success
(standalone server + prerendered `/`, `/methodology`).

## Remaining Blockers

1. **OpenRouter/live AI — BLOCKED** (egress denies `openrouter.ai`). Live
   benchmark + model decision cannot proceed here.
2. **Live Supabase — PENDING** (no provisioned project/credentials reachable):
   real auth, RLS, workflow, public-read, explorer, evidence against real data.
3. **Render provisioning — PENDING** (owner connects repo + sets `sync:false`
   env values; Blueprint is now in the repo).
4. **Production migration state + 0012 application — PENDING** owner confirmation
   and explicit approval.
5. **Live GitHub Pages URL — PENDING** owner enabling Pages + a `main` deploy.

## Owner Actions

1. Provision a Render web service from `render.yaml`; set the `sync:false` env
   values (Supabase URL/anon/service-role/DB URL; AI vars only if enabling a real
   provider).
2. Confirm which migrations `0001`–`0012` are applied to the real Supabase
   project; explicitly approve (or defer) applying `0012_grant_hardening.sql`.
3. Provide a secure server-side environment with OpenRouter egress + a key to run
   the existing `packages/benchmark` harness (FULL/ESSENTIAL scenarios) — then the
   Model Benchmark / Primary·Fallback·Local decision can be filled in with real
   evidence.
4. Enable GitHub Pages and confirm the live preview URL.
5. After a live SSR host exists, run the Phase 8–12/16–18 browser verifications
   against real data (using clearly-marked `is_demo=true` records only).

## Production Readiness Decision

**READY WITH DOCUMENTED BLOCKERS.** All offline gates pass and the standalone
server runs; the only outstanding items are external-infrastructure provisioning
and live verification, each explicitly PENDING/BLOCKED above with the owner action
that unblocks it. No blocker is a code defect.

## M7 Status

**NOT STARTED. NOT AUTHORIZED.** No scraping, crawling, automated discovery,
source connectors, ingestion, queues, schedulers, vector search, community voting,
positive/negative weighting, efficacy scoring, or automated publication was added
or begun.
