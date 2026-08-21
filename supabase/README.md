# Supabase

This directory will hold the WiseEvidence database configuration: **migrations**,
**seed** data, and **Edge Functions** where justified. It follows the direction
in `docs/03-... `→ see `docs/04-SYSTEM-ARCHITECTURE.md` §12, `docs/05-DATABASE-ARCHITECTURE.md`,
`docs/16-SECURITY.md`, and ADR-002 / ADR-003.

## Status: schema delivered (Milestone 2)

The canonical schema now lives in `migrations/` and reference/demo data in
`seed/`. Connection strategy (Milestone 1) remains:

- The frontend reads **only** the public variables `PUBLIC_SUPABASE_URL` and
  `PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`).
- The public client factory lives at `apps/web/src/lib/supabase.ts`.
- The **service-role key and any privileged secret are never** read in
  client-side code (`docs/16-SECURITY.md` §5). Server-only access will be added
  in a separate server module in a later milestone.

## Layout

```text
supabase/
├── migrations/   # 0001_enums … 0009_rls — the canonical, version-controlled schema
├── seed/         # 0001_taxonomy (reference) + 0002_demo_fixtures (clearly-labeled demo)
└── functions/    # Edge Functions — only when justified (not yet present)
```

## Principles (enforced by the migrations)

- **PostgreSQL is authoritative**; all schema changes go through the
  version-controlled migrations here — never manual dashboard edits
  (ADR-002, `docs/17-DATA-GOVERNANCE.md` §2).
- **Row-Level Security** is the enforcement boundary: the public/anon role reads
  only `PUBLISHED` records; drafts, review queue, AI results, imports, and audit
  are restricted to reviewer/admin (`docs/05` §13, `docs/16` §4, `0009_rls.sql`).
- **Study ≠ Publication**, **AI suggestion ≠ human final**, **outcome ≠ quality ≠
  confidence ≠ criticism** are structural, not conventions.

## Running migrations & tests

Production is **Supabase PostgreSQL**. Locally and in CI the same SQL migrations
run against **PGlite** with a minimal Supabase-compatible auth shim (ADR-012,
`docs/20` §4a). See `packages/database` for the migration runner and PGlite test
harness. A staging verification path against real Supabase is maintained for
later milestones. The Supabase CLI (`supabase db push`) will apply these same
files to a real project once wired.
