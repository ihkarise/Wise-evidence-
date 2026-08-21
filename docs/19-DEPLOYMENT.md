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

# 11. M3 Supabase Go-Live Gate (PENDING)

M3 is built production-compatibly but **no real Supabase project has been tested
yet** (ADR-012 keeps PGlite as the deterministic CI DB). Real-Supabase auth/RLS
verification is an explicit **pending gate** — it is not claimed complete until
performed. When a controlled Supabase project exists, verify in order:

1. Create the Supabase project (controlled access).
2. Configure environment variables (`.env` from `.env.example`;
   `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, server-only
   `SUPABASE_DB_URL`/`SUPABASE_SERVICE_ROLE_KEY`).
3. Apply the existing migrations (`supabase db push` — same `supabase/migrations`).
4. Verify authentication (Supabase Auth sign-in).
5. Verify `auth user → app_user → app role` mapping.
6. Verify anon / reviewer / admin RLS behavior.
7. Verify published-only public reads.
8. Verify draft/private (AI, audit, review, import) data isolation.
9. Verify the first-admin bootstrap (privileged SQL/seed — never self-service).
10. Verify the public research page (`/research/[id]`) against real Supabase.

Runtime rendering: hybrid via `@astrojs/node` (ADR-013). Server env holds
privileged secrets only; the frontend reads only `PUBLIC_*` (`16` §5).
