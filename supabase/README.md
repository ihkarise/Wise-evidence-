# Supabase / Database

This directory will hold the WiseEvidence database migrations, seed data, and
(where justified) Edge Functions.

## Milestone 1: no schema yet

**There is deliberately no database schema in this repository at Milestone 1.**
No migrations, no tables, no Row-Level Security policies. Milestone 1 establishes
only the _connection strategy_ (see `apps/web/src/lib/supabase.ts`) so the public
(anon) client can be constructed consistently once the schema lands.

## Migrations-first architecture

When the database is introduced (**Milestone 2 — Database Foundation**), it
follows a strict migrations-first rule (`docs/19-DEPLOYMENT.md` §6,
`docs/17-DATA-GOVERNANCE.md` §2, `docs/adr/ADR-002`):

- **PostgreSQL is the authoritative source of application state.**
- **All schema changes are version-controlled migrations.** Never edit the
  production schema by hand in a dashboard.
- Core entities, relationships, indexes, RLS policies, and clearly-labeled seed
  data all arrive together in M2, with database tests.

Expected layout once M2 begins:

```text
supabase/
├── migrations/   # timestamped, version-controlled SQL migrations
├── seed/         # clearly-labeled demo/fixture data (never presented as real research)
└── functions/    # Edge Functions, only where justified
```

## Secrets

Production secrets are **never** committed. Only `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_ANON_KEY` are exposed to the browser; the **service-role key
bypasses RLS and must stay server-side only** (`docs/16-SECURITY.md` §5). See
`.env.example` and `SECURITY.md`.
