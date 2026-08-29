# WiseEvidence
## Deployment

**Document:** `docs/19-DEPLOYMENT.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `04-SYSTEM-ARCHITECTURE.md`, `20-TESTING.md`, `21-COST-CONTROL.md`

---

# 1. Purpose

Define environments, CI/CD, migrations, rollback, backups, and monitoring — at a
low initial cost (`00` §14, `21`).

# 2. Environments

`Development · Staging · Production` (`04` §43). MVP may begin with
**Development + Production**, but configuration must allow Staging later. Each
environment has isolated config and secrets (`16` §5).

# 3. Deployment Model

```text
GitHub → GitHub Actions → Build/Test → Public Web (static-first) + Supabase/PostgreSQL
```

(`04` §42, master prompt §7.) Prefer free/low-cost hosting for the static-first
Astro site and Supabase's free/low tiers for the backend (`21`).

# 4. Configuration

- All configuration via environment variables; nothing secret committed.
- `.env.example` documents required variables (added Milestone 1).
- Frontend receives only public config; privileged keys stay server-side
  (`16` §5).
- **AI (Milestone 6) is server-only.** `AI_PROVIDER` (default `mock`), and — for a
  real provider only — `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, plus optional
  timeouts and pricing, are read only in the server process. They are **never**
  `PUBLIC_*` and never reach the browser bundle; the default mock provider needs no
  key. See `docs/29-AI-ENRICHMENT.md` §4.

# 5. CI (GitHub Actions)

Pull requests eventually run (`04` §44):

```text
Install → Lint → Type Check → Unit Tests → Integration Tests → Build
```

A `SessionStart`/setup path should let contributors and web sessions run tests
and linters. CI must run without paid AI (mock provider, `10` §14, `20`).

# 6. Database Migrations

All production schema changes are version-controlled migrations (`04` §45,
`17` §2). No manual production dashboard schema edits (master prompt §14). The
MVP schema is created in Milestone 2.

# 7. Rollback

- Application: redeploy a previous build.
- Database: forward-fixing migrations preferred; destructive migrations require
  a backup and an ADR-level decision (master prompt §89).

# 8. Backups

Regular database backups (Supabase-managed where available), with a documented
restore procedure before production launch.

# 9. Monitoring

Low-cost, privacy-conscious monitoring and error logging (`21`, master prompt
§35). Avoid expensive observability stacks without a measured need (`00` §16,
master prompt §7). Errors are surfaced, not swallowed (`16` §12).

# 10. Failure Isolation

Deployments must preserve the guarantees in `04` §46 / `11` §11: AI, import, and
automation failures do not break research browsing or the core application.

# 11. Static Preview (GitHub Pages) — PREVIEW ONLY, not production

The workflow `.github/workflows/preview.yml` publishes a **static visual preview**
of the public marketing pages so the UI can be inspected in a browser. It is **not
the production deployment** and does not host the application.

**Why it is preview-only.** WiseEvidence is a **hybrid SSR** app (ADR-004,
ADR-014): `output: "static"` + the Astro **Node adapter**. Only `/` and
`/methodology` are prerendered; `/research`, `/research/[id]`, `/evidence`,
`/statistics`, `/admin/*`, and `/api/*` are on-demand server-rendered
(`prerender = false`). **GitHub Pages is static hosting and cannot run those SSR
routes.** We do **not** convert the app back to static or remove SSR to fit Pages
(that would break auth, RLS-guarded reads, admin, and the API). Instead the
workflow deploys **only** the prerendered client output (`apps/web/dist/client`),
and ships a `404.html` that states the SSR routes are unavailable in the preview —
no dead ends, no false "production" claim.

**Safety.** The preview build runs with **no secrets**: no AI/OpenRouter key, no
Supabase URL or service-role key, no production credentials. The two prerendered
pages are pure static (no database, no `import.meta.env`). The SSR **server** bundle
(`apps/web/dist/server`) is **never** published; admin routes do not exist as static
files, so they cannot be exposed. Any live catalogue/data is DEMO/mock only.

**Enablement.** The workflow deploys only after the repo owner sets **Settings →
Pages → Source = "GitHub Actions"**; then it runs on `workflow_dispatch` or a push
to `main`. Until enabled it is inert. The resulting URL is a **STATIC VISUAL
PREVIEW ONLY** and must be documented as such — never as the production host.

**Base path (ADR-018).** GitHub Pages serves this repo from the project subpath
`https://ihkarise.github.io/Wise-evidence-/`, so the preview build **must** carry
that base or every asset (CSS/JS/favicon) and in-app link resolves against the
domain root and 404s. `astro.config.mjs` reads `base`/`site` from the `SITE_BASE` /
`SITE_URL` env vars; the preview workflow sets `SITE_BASE=/Wise-evidence-/` (and
`SITE_URL=https://ihkarise.github.io`) on the build step. **Production SSR sets
neither**, so `base` stays `/` and the SSR output is unchanged — the same source
serves both deployments without divergence. Author-written links use the
`withBase()` helper (`apps/web/src/lib/base.ts`), since Astro auto-prefixes only
the asset URLs it generates itself, not hand-written `href`/`src`/`action` values.
Verified locally (build with `SITE_BASE`, serve under `/Wise-evidence-/`, headless
Chromium): CSS/JS/favicon 200, Copy DOI island hydrates + normalises, nav works,
zero console errors. The **live** Pages URL cannot be opened from the build/CI
egress sandbox, so live-browser confirmation of the deployed URL stays PENDING the
owner enabling Pages + a `main` deploy.

# 12. Production Hosting Architecture (documented target — NOT provisioned)

The hybrid-SSR app needs a server runtime; the source repository stays independent
of the host. The documented target (not built in this milestone):

```text
Source + CI/CD  →  GitHub (or GitLab CI) — code, review, pipelines
Application     →  a free/low-cost SSR-capable host running the Astro Node
                   standalone server (or, if later chosen, a Cloudflare-Workers-
                   compatible Astro adapter). Static-only hosts (GitHub Pages,
                   GitLab Pages) can serve docs / the static preview, but CANNOT
                   be the application runtime while SSR remains.
Database        →  Supabase / PostgreSQL (RLS; migrations only)
AI              →  OpenRouter (OpenAI-compatible), server-only credentials, opt-in
Domain          →  a custom domain in front of the SSR host
```

Cost posture is unchanged (ADR-010, `21`): free-first, no paid AI-on-every-paper,
no premature infrastructure. **Not provisioned now**: no production domain,
database, AI calls, or public admin; Supabase and production AI verification remain
PENDING (`29` §25). The production migration is a separate, explicitly-authorized
step — do not overbuild it here.

## 12.1 Chosen smallest default SSR host — Render (blueprint only, not deployed)

The app is built with the `@astrojs/node` adapter in **`standalone`** mode, which
produces a plain Node HTTP server (`apps/web/dist/server/entry.mjs`, honouring
`HOST`/`PORT`; `pnpm --filter @wise-evidence/web start` runs it). The smallest host
consistent with that — Node runtime, HTTPS, env vars, custom domain later, a free
tier, **no Docker, no adapter or framework change** — is a **Render free web
service**. A repo-root `render.yaml` blueprint captures the build/start commands
and declares every secret as `sync: false` (Render prompts for the value in its
dashboard; nothing secret is committed). `PORT` is injected by Render.

This is a **documented default, not a lock-in**: any Node-capable host (Railway,
Fly.io with a Dockerfile, a small VPS) runs the same `start` command with the same
env vars. Switching to a serverless host later would mean swapping the Astro
adapter (e.g. `@astrojs/vercel`) — a deliberate, separate decision, out of scope
here.

**Status.** The Node standalone server is **VERIFIED LOCAL**: built and run
locally, every route responds — `/` `/methodology` `/research` `/evidence`
`/statistics` return 200, `/admin` 302-redirects an unauthenticated request to
`/admin/sign-in?next=/admin` (the middleware auth guard), and with no Supabase env
the data routes degrade gracefully (empty catalogue / "not configured") with **no
SQL error, stack trace, or secret in the HTML**. The **live Render deployment is
PENDING** the owner connecting the repo to Render and setting the Supabase env vars
in the dashboard; **live-browser verification against real Supabase stays BLOCKED**
in this build/CI sandbox (egress-restricted, no credentials). Never mark the host
live without opening its real URL.
