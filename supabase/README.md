# Supabase

This directory will hold the WiseEvidence database configuration: **migrations**,
**seed** data, and **Edge Functions** where justified. It follows the direction
in `docs/03-... `→ see `docs/04-SYSTEM-ARCHITECTURE.md` §12, `docs/05-DATABASE-ARCHITECTURE.md`,
`docs/16-SECURITY.md`, and ADR-002 / ADR-003.

## Status: connection strategy only (Milestone 1)

There is **no database schema, migration, RLS policy, or seed data yet** — that
is Milestone 2 (Database Foundation, see `docs/22-ROADMAP.md`). Milestone 1
establishes only the *connection strategy*:

- The frontend reads **only** the public variables `PUBLIC_SUPABASE_URL` and
  `PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`).
- The public client factory lives at `apps/web/src/lib/supabase.ts`.
- The **service-role key and any privileged secret are never** read in
  client-side code (`docs/16-SECURITY.md` §5). Server-only access will be added
  in a separate server module in a later milestone.

## Principles carried into Milestone 2

- **PostgreSQL is authoritative**; all schema changes go through
  version-controlled migrations here — never manual dashboard edits
  (ADR-002, `docs/17-DATA-GOVERNANCE.md` §2).
- **Row-Level Security** is the enforcement boundary: the public role reads only
  `PUBLISHED` records; drafts, review queue, AI results, and audit are restricted
  (`docs/05` §13, `docs/16` §4).

## Planned layout (Milestone 2)

```text
supabase/
├── migrations/   # version-controlled schema changes
├── seed/         # clearly-labeled demo/fixture data (never real research)
└── functions/    # Edge Functions, only when justified
```
