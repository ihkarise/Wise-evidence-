# ADR-012: PGlite for Deterministic Database and RLS Tests

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/05-DATABASE-ARCHITECTURE.md`, `docs/16-SECURITY.md`, `docs/20-TESTING.md`, ADR-002, ADR-003

## Context

Milestone 2 introduces the canonical database: version-controlled PostgreSQL
migrations, Row-Level Security, seed data, and fixtures. These must be tested
deterministically in CI. The production platform is **Supabase PostgreSQL**
(ADR-002, ADR-003), but the current development/CI environment has **no Supabase
CLI and no usable Docker daemon**. PostgreSQL 16 and PGlite (embedded PostgreSQL
compiled to WASM, runnable in-process under Node) are available.

Testing RLS meaningfully requires exercising PostgreSQL's *actual* RLS engine —
role switching and policy evaluation — not a re-implementation of RLS logic in
TypeScript, which would prove nothing.

## Decision

Use **PGlite** to execute the **real SQL migration files** and run the database
and RLS test suites locally and in CI. RLS is tested through PostgreSQL's genuine
behavior: `SET ROLE` / `SET LOCAL request.jwt.claims` and policy evaluation — not
a faked TypeScript RLS layer.

Provide the **smallest Supabase-compatible auth shim** required, and only that:

- roles `anon`, `authenticated`, `service_role` (the last `BYPASSRLS`, as on
  Supabase),
- an `auth` schema with `auth.uid()` reading `request.jwt.claims`,
- the `request.jwt.claims` GUC set per-transaction in tests.

The shim is applied **before** the real migrations in the test harness (on
Supabase these objects already exist), so migration files remain deployable to
real Supabase unchanged. Roles and `auth.uid()` are **not** created inside the
migrations.

**Boundary:**

| | Role |
|---|---|
| **Production** | Supabase PostgreSQL — authoritative database; final integration verification. |
| **Local / CI** | PGlite — deterministic, fast, free execution of the real migrations + RLS tests. |

PGlite is **only** a local/CI test database. It is **not** the production
database and does not change the production deployment architecture.

## Consequences

- Migration DDL is exercised as real PostgreSQL, not mocked or structurally
  parsed; RLS policies are validated by the real engine.
- CI needs no Docker, no Supabase CLI, no secrets, and no paid services.
- The auth shim is minimal and documented; it is not a reproduction of the
  Supabase Auth platform.
- **Limitation:** PGlite is not a substitute for final real-Supabase
  compatibility testing. A staging verification path against actual Supabase
  PostgreSQL/RLS is maintained for later milestones and documented in
  `docs/20-TESTING.md`.
- If a required PostgreSQL/Supabase feature proves incompatible with PGlite, we
  **stop and report the exact incompatibility** rather than silently weakening a
  test.
