# WiseEvidence — Production Connection Verification

**Document:** `docs/reports/PRODUCTION-CONNECTION-VERIFICATION.md`
**Status:** Living record — updated 2026-08-29 (Production Readiness phase)
**Related:** `docs/19-DEPLOYMENT.md`, `ADR-018`, `docs/reports/M6.1-OPERATIONAL-VERIFICATION.md`

## Purpose

Record, with honest provenance, what has been verified about the production
deployment path and where the boundaries of this session's execution environment
are. Every row is labelled with a **verification tier** so nothing is presented as
tested that was not:

- **VERIFIED LOCAL** — reproduced in this session on the local build/toolchain.
- **VERIFIED PGLITE** — proven by the deterministic PGlite test harness (the same
  ordered migrations that deploy to Supabase).
- **VERIFIED REAL SUPABASE (reported)** — verified against the live Supabase
  project `zqvcwywacjxvpidrvrwx` in prior work by the repo owner; **not** re-run in
  this session (this environment has no DB credentials and DB egress is sandboxed).
- **VERIFIED LIVE BROWSER** — the deployed URL was opened in a browser.
- **VERIFIED LIVE OPENROUTER** — a real OpenRouter API call was made.
- **PENDING** — not yet done; no blocker other than sequencing/authorization.
- **BLOCKED** — attempted and prevented by this environment (egress policy / no
  credentials); not fabricated.

## Environment boundary (this session)

The build/CI sandbox permits egress only to a fixed allowlist (Anthropic APIs,
npm, PyPI, etc.). General internet — including `ihkarise.github.io`,
`openrouter.ai`, and the Supabase project host — is **denied at the egress proxy**
(observed `HTTP 000` / `connect_rejected`). Therefore anything requiring a live
external host cannot be executed here and is marked **BLOCKED**, never guessed.

## Verification matrix

| # | Item | Tier | Evidence |
|---|------|------|----------|
| 1 | GitHub Pages base-path fix (`SITE_BASE`/`withBase()`) | VERIFIED LOCAL | Built with `SITE_BASE=/Wise-evidence-/`; all asset/link/favicon/island URLs prefixed `/Wise-evidence-/`; served under the subpath in headless Chromium — `/` and `/methodology` 200, CSS/JS/favicon 200, Copy DOI hydrates + normalises `10.1234/abcd` + "Copied ✓", base-aware nav works, **0 console errors**. |
| 2 | Production SSR build unaffected by base change | VERIFIED LOCAL | Default build (no env) emits root-absolute URLs unchanged; SSR pages compile to `dist/server`. |
| 3 | Client-bundle secret firewall | VERIFIED LOCAL | Built with sentinel `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_DB_URL`/`AI_API_KEY` values; **none** appear in `dist/client`. Server-only vars never reach the browser bundle. |
| 4 | RLS boundary (anon/authenticated/service_role) | VERIFIED PGLITE | `rls.test.ts`, `workflow-security.test.ts` — anon reads only published; private tables hidden; anon cannot mutate. |
| 5 | `anon` grant hardening (migration 0012) | VERIFIED PGLITE | `grants.test.ts` (8 tests) — asserts least-privilege posture and proves 0012 strips a simulated Supabase default grant. **Not applied to production** (awaits owner approval). |
| 6 | Study-based statistics / M5 separation | VERIFIED PGLITE | `stats.test.ts` — distinct-study counts; independent outcome/quality/criticism; no efficacy score. |
| 7 | M5/canonical/publication firewalls (AI never authoritative) | VERIFIED PGLITE | `ai.test.ts`, `ai-security.test.ts`, `workflow.test.ts`. |
| 8 | Full offline regression | VERIFIED LOCAL | `test` 295 passed / 1 skipped; `typecheck` clean; `lint` clean; `format:check` clean; web build (default + preview) OK; secret scan of source + built assets clean. |
| 9 | Real Supabase schema/RLS/auth (27 tables, 64 policies, 20 triggers, 8 fns, ADMIN bootstrap, demo guard, anon writes blocked) | VERIFIED REAL SUPABASE (reported) | Prior owner verification against `zqvcwywacjxvpidrvrwx`; recorded here as reported, **not** re-run this session. |
| 10 | Live browser of deployed **GitHub Pages** URL | BLOCKED | `ihkarise.github.io` denied by egress proxy; cannot open the live URL. Redeploy also gated on owner enabling Pages + a `main` deploy. |
| 11 | Live **SSR host** (production runtime) | PENDING | No SSR host provisioned; documented target only (`docs/19` §12). Requires owner to choose/provision a Node-capable host. |
| 12 | Live browser of SSR routes against real Supabase (`/research`, `/research/[id]`, `/evidence`, `/statistics`, `/admin`) | BLOCKED | Needs a running SSR host + DB egress + credentials; none available here. |
| 13 | Live OpenRouter benchmark (M6.1) | BLOCKED | `GET openrouter.ai/api/v1/models` → `HTTP 000` (egress denied); no server-side key. No results/pricing fabricated. |

## What is safe to state today

- The **root cause** of the Pages 404s (missing base path) is confirmed from
  source and **fixed**; the fix is verified locally with a faithful subpath
  emulation. Production SSR is untouched.
- The **grant finding** is real (Supabase default privileges can grant `anon`
  more than the migration comments claim). A hardening migration + tests are
  prepared; applying it to production is a deliberate, owner-authorized step.
- No credential, secret, or fabricated live result appears anywhere in the repo,
  the built client bundle, or this report.

## Not done (and why)

- **Live-browser confirmation** of both the Pages preview URL and any SSR host is
  **BLOCKED/PENDING** on infrastructure this environment cannot reach. It must be
  performed by the owner (or from a network without the egress restriction) before
  any "live" claim is made.
- **M6.1 live benchmark** remains **BLOCKED** (see the M6.1 report).
