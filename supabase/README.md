# Supabase / Database

This directory will hold the WiseEvidence database migrations, seed data, and
(where justified) Edge Functions.

## Milestone 2: schema, RLS, and seed have landed

The Database Foundation (Milestone 2) is implemented. See
`docs/25-DATABASE-FOUNDATION.md` for the full design checkpoint and
`docs/adr/ADR-013` for the enum/table and testing decisions.

```text
supabase/
├── migrations/   # 0001..0009 — ordered, version-controlled SQL (canonical schema,
│                 #   enums, indexes, RLS, and taxonomy-v1 reference data)
└── seed/
    └── demo_fixtures.sql   # clearly-labelled DEMO data (is_demo=true, [DEMO] titles,
                            #   reserved 10.0000/ DOIs) — never real research, never a migration
```

- **Reference taxonomy** (study types, evidence levels, starter conditions/
  interventions/tags) is canonical and ships in migration `0009`.
- **Demo research fixtures** are development/test only and live in `seed/`.
- **Row-Level Security** is the authoritative boundary: anon reads only
  `PUBLISHED` research; drafts, AI, review, correction, import, and audit rows
  are private; all mutation goes through the server-side `service_role`.
- The migrations use only roles/functions Supabase provides in production
  (`anon`/`authenticated`/`service_role`, `auth.uid()`); they invent nothing.
- **Deterministic tests** run against in-process PostgreSQL (PGlite) with a
  clearly-labelled Supabase compatibility shim — no live project, no Docker, no
  paid service. Real-Supabase verification (`supabase db push`) is PENDING a
  provisioned project.

The M1 _connection strategy_ (see `apps/web/src/lib/supabase.ts`) remains the
client boundary; the schema it will query now exists.

## Migrations-first architecture

The database follows a strict migrations-first rule (`docs/19-DEPLOYMENT.md` §6,
`docs/17-DATA-GOVERNANCE.md` §2, `docs/adr/ADR-002`):

- **PostgreSQL is the authoritative source of application state.**
- **All schema changes are version-controlled migrations.** Never edit the
  production schema by hand in a dashboard. Migrations are forward-only by
  convention (`docs/19` §6–7); a destructive change needs a backup and an
  ADR-level decision.
- Add new schema by adding the next-numbered `migrations/NNNN_*.sql`; never edit
  or reorder an already-applied migration.
- Edge Functions (`functions/`) are added only where justified (`docs/21`).

## Secrets

Production secrets are **never** committed. Only `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_ANON_KEY` are exposed to the browser; the **service-role key
bypasses RLS and must stay server-side only** (`docs/16-SECURITY.md` §5). See
`.env.example` and `SECURITY.md`.
