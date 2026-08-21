# ADR-003: Supabase Direction

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/04-SYSTEM-ARCHITECTURE.md` §12, `16-SECURITY.md`, `21-COST-CONTROL.md`

## Context

The project needs PostgreSQL, authentication, row-level security, and optional
serverless functions at very low initial cost, without operating this
infrastructure by hand. Supabase provides these on a free/low-cost tier around a
standard PostgreSQL core (avoiding deep proprietary lock-in of the database
itself).

## Decision

Use **Supabase** as the initial managed backend platform: PostgreSQL, Auth,
Row-Level Security, and Edge Functions where appropriate. Use Storage only when
justified.

## Consequences

- Fast start, managed auth and RLS, low cost (`21`).
- Security depends on RLS and server-side logic, never client-side hiding
  (`16` §4).
- Because the core is standard PostgreSQL, migrating off Supabase later is
  feasible; app logic should avoid unnecessary Supabase-specific coupling outside
  `packages/database`. Introducing Supabase Storage or heavy Edge Function use
  requires justification (`21` §2).
