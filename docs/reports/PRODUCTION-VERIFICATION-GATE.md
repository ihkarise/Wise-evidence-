# WiseEvidence Production Verification Gate

**Generated:** 2026-08-29 (Production Verification Gate session)
**Scope:** Prepare and verify the EXISTING application for the production gate.
No product features added. **M7 is NOT started and NOT authorized.**

Status labels: **VERIFIED** (reproduced here with evidence) · **PARTIALLY
VERIFIED** (verified at a lower tier — local/PGlite — but not against the live
production surface) · **PENDING** (not done; needs an owner action or
infrastructure) · **BLOCKED** (attempted, prevented by this sandbox's egress/no
credentials; not fabricated).

Evidence tiers used below: LOCAL (built/ran here) · PGLITE (deterministic DB test
harness running the real ordered migrations) · REAL SUPABASE (reported) (prior
owner verification of project `zqvcwywacjxvpidrvrwx`, not re-run here) · LIVE
BROWSER / LIVE OPENROUTER (require external hosts this sandbox cannot reach).

---

## Repository
**VERIFIED.** `ihkarise/Wise-evidence-`. Working tree clean.

## Branch
**VERIFIED.** `claude/github-pages-ssr-deploy-7tvxt7` (re-based on merged `main`;
its prior PR #10 is already merged — new commits here are a fresh change).

## Commit
**VERIFIED.** Head `b4a8086` at session start; this gate adds a docs-only commit
on top. Base `main` = `f701207` (PR #10 merge).

## Git Status
**VERIFIED.** Clean before this report; `git diff --check` clean.

## Render
**VERIFIED (config, LOCAL).** `render.yaml` is valid YAML; one `web` service,
`runtime: node`, `plan: free`. Build `corepack enable && pnpm install
--frozen-lockfile && pnpm --filter @wise-evidence/web build`; start `node
apps/web/dist/server/entry.mjs` (matches the built standalone entry; `pnpm
--filter @wise-evidence/web start` runs it). Node 22. Env separation correct:
`PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` and all server-only secrets
(`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`) are declared
`sync: false` — Render prompts for them in its dashboard; **no value is committed**.
No privileged credential appears in any PUBLIC var. `AI_PROVIDER=mock` default.
**Live deploy = PENDING** (owner must connect the repo to Render and set the env
vars); this sandbox cannot connect to Render, and no deployment success is claimed.

## Supabase
**PARTIALLY VERIFIED.** Schema/RLS/auth/ADMIN-bootstrap/demo-guard were verified
against the real project in prior owner work (REAL SUPABASE, reported); RLS and
grants are re-verified here at the PGLITE tier. The live project is not reachable
from this sandbox (egress-restricted, no credentials), so nothing about the live
project is re-verified this session.

## Migration State
**PENDING (real) — discrepancy corrected.** The task prompt states migrations
"0001 through 0014"; the **actual repository contains only 0001–0012** on this
branch and on `main` (verified via `git ls-tree`). **No 0013 or 0014 exist** in
this repo on any readable branch — they were not fabricated. Reported production
state (not re-verifiable here): **0001–0011 applied**, **0012 merged but NOT
applied**. Real production migration state = **PENDING** (no DB access this
session).

## Migration 0012
**VERIFIED (content) / PENDING (apply).** Reviewed `0012_grant_hardening.sql`:
purpose = least-privilege `anon` grant hardening (defence in depth beneath RLS).
Affected objects: table-level privileges only — 3 statements: `REVOKE ALL` from
`anon` on the private staff tables; `REVOKE INSERT/UPDATE/DELETE/TRUNCATE` from
`anon` on all public tables; `REVOKE TRUNCATE` from `authenticated`. **No indexes,
no CREATE/DROP/ALTER, no RLS-policy changes.** `authenticated` keeps its M3 content
writes; `service_role` keeps `grant all`. Rollback: trivially reversible by
re-granting, and RLS already protects the data so a rollback carries no security
regression. Consistent with `grants.test.ts` (8 tests, passing). **Not applied to
production** — owner-gated; this session has no production access to apply it.

## Authentication
**PARTIALLY VERIFIED (LOCAL).** Ran the SSR server: unauthenticated `/admin` →
`302` → `/admin/sign-in?next=%2Fadmin` (middleware guard); `/admin/sign-in` renders
(200). Session/role come from Supabase Auth via `@supabase/ssr` + `app_user`
(code path unchanged, RLS-enforced). Real reviewer/admin login in a browser =
BLOCKED (no live URL/credentials).

## Admin
**PARTIALLY VERIFIED (LOCAL) / PENDING (live).** Unauthenticated admin surface
fails closed (redirect); admin API routes fail closed (see RLS/SSR). The full
create→classify→criticism→submit→review→publish workflow is covered at PGLITE tier
(`workflow.test.ts`, `workflow-security.test.ts`); real-browser admin workflow =
PENDING the live SSR host + real Supabase.

## Public Research
**PARTIALLY VERIFIED.** LOCAL: `/research` returns 200 and renders the explorer
(independent filters) with graceful empty state when no DB is configured — no SQL
error or secret leaked. PGLITE: published-only visibility and draft isolation are
test-covered. Real-data browser rendering = BLOCKED (live gate).

## Explorer
**PARTIALLY VERIFIED (LOCAL).** `/research` renders independent filter controls —
sort, studyType, evidenceLevel, **outcome**, **quality**, condition, intervention,
year. Outcome and quality are separate controls; there is **no efficacy /
balance / combined-score control**. Search/filter/sort/paginate logic is
PGLITE-tested (`search.test.ts`).

## Evidence
**PARTIALLY VERIFIED.** LOCAL: `/evidence` 200. PGLITE: study-based counting,
independent outcome/quality/criticism distributions, UNCLASSIFIED preserved, no
efficacy score (`stats.test.ts`). Real-data rendering = BLOCKED (live gate).

## Statistics
**PARTIALLY VERIFIED.** LOCAL: `/statistics` 200, renders distribution sections.
PGLITE: same aggregation guarantees as Evidence. Real-data rendering = BLOCKED.

## RLS
**VERIFIED (PGLITE).** `rls.test.ts` + `workflow-security.test.ts`: anon reads only
PUBLISHED research; drafts/pending/rejected/archived hidden; private tables
(app_user, review, correction, audit_log, import_job, import_candidate, ai_job,
ai_result) hidden from anon; anon cannot mutate; reviewer cannot self-promote or
publish directly. Same migrations that deploy to Supabase.

## Audit
**VERIFIED (PGLITE).** Append-only audit behaviour and anon-cannot-read are
test-covered. Real-app audit-row generation in production = PENDING (live gate).

## GitHub Pages
**VERIFIED (build + deploy) / BLOCKED (live browser).** The merge to `main`
(`f701207`) ran the `Static Preview` workflow: both the build (with
`SITE_BASE=/Wise-evidence-/`) and the `actions/deploy-pages` deploy jobs succeeded
(run 33257664650) — Pages is enabled and the base-path-corrected assets were
published. Opening `https://ihkarise.github.io/Wise-evidence-/` from this sandbox is
BLOCKED (`EGRESS_BLOCKED`); no live-browser eyeball is claimed.

## SSR
**VERIFIED (LOCAL).** Built the default output and ran the `@astrojs/node`
standalone server (`apps/web/dist/server/entry.mjs`, honours HOST/PORT).
`/` `/methodology` `/research` `/evidence` `/statistics` `/admin/sign-in` → 200;
`/admin` → 302 sign-in; API routes fail closed — `POST /api/session` 403,
`POST /api/admin/research` 403, `GET /api/admin/metadata` 401,
`POST /api/admin/metadata` 403 (`GET /api/session` 404: no GET handler by design).
No stack trace, SQL error, or secret in any HTML or API body; server stderr clean.
Live SSR host = PENDING (Render, not deployed).

## OpenRouter
**BLOCKED.** One connectivity test: `GET https://openrouter.ai/api/v1/models` →
`HTTP 000` (egress denied) at 2026-08-29T16:00:36Z. Not retried; no route-around;
no fabricated catalogue/pricing/usage.

## M6.1
**PENDING LIVE PROVIDER VERIFICATION.** Offline benchmark harness complete and
test-covered; the live OpenRouter run is BLOCKED until executed from an environment
that can legitimately reach OpenRouter with a server-side key.

## Tests
**VERIFIED.** `pnpm -w test` → 295 passed, 1 skipped (the skip = live-provider
benchmark), 27 files.

## Typecheck
**VERIFIED.** `pnpm -w typecheck` clean.

## Lint
**VERIFIED.** `pnpm -w lint` clean.

## Format
**VERIFIED.** `pnpm -w format:check` clean (run in check mode to avoid spurious
rewrites; the tree is already Prettier-clean).

## Build
**VERIFIED.** `pnpm --filter @wise-evidence/web build` succeeds (static + SSR
compile).

## Secret Scan
**VERIFIED.** `.env` gitignored (only `.env.example` placeholders tracked). Value
scans of the source tree, the built client bundle (`apps/web/dist/client`), and the
last 40 commits found no real API key, JWT, service-role key, DB URL with
credentials, or private key. Server-only vars never appear in the client bundle
(prior sentinel-build firewall test, ADR-018).

## Remaining Blockers
1. **Live Pages browser check** — BLOCKED (egress denies `ihkarise.github.io`).
2. **Live SSR host** — PENDING (owner connects Render + sets env vars).
3. **Real-Supabase browser verification** (auth, admin workflow, public data,
   audit, RLS in the running app) — BLOCKED here; needs the live SSR URL +
   credentials.
4. **Real production migration state / applying 0012** — PENDING (no DB access).
5. **M6.1 live OpenRouter benchmark** — BLOCKED (egress + no key).

## Owner Actions
1. Connect the repo to **Render** (uses `render.yaml`); set the Supabase env vars
   (and later AI vars) in the Render dashboard — never in the repo. Obtain the SSR
   HTTPS URL.
2. Open `https://ihkarise.github.io/Wise-evidence-/` and confirm CSS/JS/favicon/
   Copy-DOI render (base-path fix).
3. Decide on and, if approved, **apply migration 0012** to production; then confirm
   the live migration state (expected 0001–0012).
4. From the live SSR URL, run the Phase-6 browser checks against real Supabase.
5. Run the **M6.1** live benchmark from an OpenRouter-reachable environment with a
   server-side key.

## M7 Status
**NOT STARTED / NOT AUTHORIZED.** No scraping, discovery, ingestion, queues, vector
search, voting, efficacy scoring, or other new product features were added. M7
remains gated on: real SSR reachable · real-Supabase browser verification complete ·
production migration state confirmed · M6.1 live benchmark completed or explicitly
accepted as pending · production security checks passed.
