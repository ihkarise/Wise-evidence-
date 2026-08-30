# Production Database Inspection — How to Run and Read It

**Companion to:** [`PRODUCTION-DATABASE-INSPECTION.sql`](./PRODUCTION-DATABASE-INSPECTION.sql)
**Status:** tooling **VERIFIED** offline · live production result **PENDING** (owner
runs it against Supabase)
**Applies to:** migrations `0001`–`0012` (there is no `0013`/`0014`)

---

## What this is

A single **read-only** SQL script the owner runs against the **live** Supabase /
PostgreSQL database to confirm it matches the repository's documented intent
before (and after) go-live. It changes nothing: only `SELECT`s against the
catalog / `information_schema` and non-sensitive row **counts**. It reads **no**
secrets.

This file explains how to run it and how to read each numbered section. The script
never decides pass/fail for you and **never** promotes a PENDING gate to VERIFIED —
it surfaces the true state so a human can compare it to expectations.

## Safety contract (do not weaken)

- **Read-only.** No `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`, no DDL
  (`CREATE`/`ALTER`/`DROP`), no `GRANT`/`REVOKE`, no `SET ROLE` / `SET SESSION
  AUTHORIZATION`, no transaction-privilege changes.
- **No secrets.** It never reads keys, passwords, JWT secrets, or connection
  strings, and never prints private-table row contents — only shape, posture, and
  counts.
- **Idempotent.** Running it twice gives the same answer and leaves the database
  untouched.

A test (`packages/database/test/production-inspection.test.ts`) enforces this
contract in CI: it statically rejects any write/DDL/privilege statement and
executes the whole script against a migrated PGlite database, so the script cannot
silently drift into a write.

## How to run it

1. Open the Supabase dashboard → **SQL Editor** (or connect with `psql` using a
   privileged role).
2. Paste the entire contents of `PRODUCTION-DATABASE-INSPECTION.sql` and run it.
3. Read each numbered result block against the **Expect** notes below.
4. Bring back the section results (screenshots or copied tables are fine — they
   contain no secrets).

## Reading each section

| # | Section | Expect |
|---|---------|--------|
| 0 | Context | Server version + current database/user. No secrets. |
| 1 | Migration ledger presence | `ledger_present` boolean. If `true`, run the follow-up query below to list versions. |
| 2 | Table inventory | `present = true` for all **27** tables (19 public + 8 private). Any `false` ⇒ a migration did not apply. |
| 3 | Enum inventory | `present = true` for all **23** domain enum types. |
| 4 | RLS enabled | `rls_enabled = true` for **every** table. Any `false` is a security gap. |
| 5 | Policy inventory | Public tables have SELECT policies; private tables restrict to staff; `research_study`/`publication`/`classification`/`criticism` carry the M3 reviewer/admin write policies (migration 0010). |
| 6 | anon grants | `anon_select = true` on **public** tables only; **all** of `anon_insert/update/delete = false` everywhere; and **no** privilege (`anon_select` included) on the **private** tables. Any `true` on a private row ⇒ migration 0012 not applied (see STEP 3 in the runbook). |
| 7 | Role posture | `authenticated` keeps SELECT on private tables + its content-write grant, and cannot `TRUNCATE`; `service_role` retains full access. |
| 8 | Guard functions | `present = true` for all **8** functions, including `enforce_publication_transition` (the demo-protected publish state machine). |
| 9 | Publication trigger | At least one row — the `BEFORE UPDATE` publication-transition trigger on `research_study`. |
| 10 | Research footprint | Counts by `publication_state` × `is_demo`. Confirms production isn't only DEMO fixtures and nothing was auto-published. Every `is_demo = true` row is unpublishable by design. |
| 11 | AI footprint | Counts of `ai_job`/`ai_result`/`audit_log` rows. Visibility only — never a target. |

### Section 1 follow-up (only if `ledger_present = true`)

The script keeps section 1 as a safe catalog check so it never errors on a
database without the Supabase CLI ledger. If it reports the ledger is present, list
the recorded versions with this one read-only query:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

**Expect:** versions for `0001` … `0012` and **nothing beyond `0012`** (there is no
`0013`/`0014` in the repository). If the ledger is absent (migrations applied by
other means), infer the applied state from sections 2–4 (the actual schema shape)
instead.

## What to conclude

- **All of sections 2–5, 8, 9 as expected** ⇒ the schema, RLS, policies, guard
  functions, and publish trigger match migrations `0001`–`0012`. This confirms the
  **structure** is live; it does **not** by itself certify the running app — see the
  owner runbook for the auth/reviewer/public walkthrough.
- **Section 6 shows any `true` on a private table for `anon`** ⇒ migration `0012`
  (grant hardening) has not been applied, or a Supabase default grant re-added a
  stray privilege. RLS still protects the data, but the grant state contradicts the
  documented least-privilege intent. Decide per the runbook's **STEP 3** whether to
  apply `0012`.

## Boundaries this does not cross

- It does **not** connect to production from CI or from this repository. Applying it
  is an explicit **owner** action in the Supabase console.
- It does **not** apply, generate, or modify any migration.
- Production migration state and production grant state remain **PENDING** until the
  owner runs this and reports the results.
