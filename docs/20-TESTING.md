# WiseEvidence
## Testing

**Document:** `docs/20-TESTING.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `10-AI-ARCHITECTURE.md`, `11-DATA-IMPORT-ARCHITECTURE.md`, `19-DEPLOYMENT.md`

---

# 1. Purpose

Define the testing strategy. Tests protect the credibility-critical logic and let
contributors work without paying for AI (`04` §47, `10` §14).

# 2. Test Layers

- **Unit** — pure domain logic (`packages/domain`, `packages/validation`).
- **Integration** — data-access layer, review/publish workflow, search.
- **Database** — migrations, constraints, RLS behavior.
- **Import** — normalization and deduplication with fixtures.
- **AI** — provider abstraction and validation, using deterministic mocks.
- **Security** — authz/RLS boundaries, prompt-injection resistance.
- **Accessibility** — baseline a11y checks (`15` §8).
- **E2E** — key public and admin journeys (later).
- **Performance** — search/detail page budgets (later).

# 3. Critical Deterministic Suites (must exist early)

From `00` §testing and master prompt §22, §34, §74:
- **DOI normalization** — see §5.
- **Deduplication** — priority order and duplicate-candidate routing (`11` §7).
- **Outcome / study-type classification** rules (`06`, `07`) — not keyword-only.
- **Permissions / RLS** — public vs reviewer vs admin (`16`).
- **Publication workflow** — no auto-publish while review required (`12` §9).
- **AI provider abstraction** — deterministic mock behavior, validation,
  bounded retries (`10`).
- **Import normalization** — source record → NormalizedResearchInput (`11` §6).

# 4. Deterministic Mocks

AI and external source connectors are mocked deterministically (`10` §14,
`11` §4). No test hits a paid AI provider or a live external source. Fixtures
back every mock (§6).

# 4a. Database & RLS Tests (PGlite) — ADR-012

Database and RLS tests run against **PGlite** (embedded PostgreSQL, in-process,
no Docker/daemon), executing the **real SQL migrations** from
`supabase/migrations/`. RLS is verified through PostgreSQL's genuine engine —
`SET ROLE` / `SET LOCAL request.jwt.claims` and real policy evaluation — never a
TypeScript re-implementation of RLS.

A **minimal Supabase-compatible auth shim** (test-only) supplies exactly what
Supabase provides in production and nothing more: the roles `anon`,
`authenticated`, `service_role` (the last `BYPASSRLS`), an `auth` schema with
`auth.uid()` reading `request.jwt.claims`, and the JWT-claims GUC. It is applied
before the migrations; migrations therefore deploy to real Supabase unchanged.

**Two environments, one authority:**

- **PGlite** — deterministic, local, CI, fast, free — migration + RLS testing.
- **Supabase PostgreSQL** — the real production environment and the authoritative
  database; the **final integration/compatibility check**. A staging verification
  path against actual Supabase is maintained for later milestones.

If a required PostgreSQL/Supabase feature proves incompatible with PGlite, we
**stop and report the exact incompatibility** rather than silently weakening a
test.

RLS tests must at least prove: (1) anon reads published research; (2) anon cannot
read drafts; (3) anon cannot read AI results; (4) anon cannot read audit data;
(5) a reviewer performs only permitted review operations; (6) a reviewer cannot
perform admin-only operations; (7) service_role performs intended privileged
operations; (8) one user's private data is not readable by another where
applicable.

# 5. DOI Normalization (test contract)

Normalization must handle at least (master prompt §50):

```text
doi:10.xxxx/xxxx
https://doi.org/10.xxxx/xxxx
http://doi.org/10.xxxx/xxxx
10.xxxx/xxxx
```

→ a single canonical DOI representation. Case handling and whitespace trimming
are covered by tests. This is the shared canonicalizer used by import (`11` §6)
and search DOI-priority (`14` §4).

# 6. Fixtures & Seed

Fixtures (master prompt §45) represent: positive, negative, mixed, neutral,
duplicate, missing-DOI, and complex-study cases. Seed data (master prompt §46,
`23` in `02`) demonstrates list, search, filters, evidence pyramid, outcome
visualization, research detail, and admin review — and includes low-confidence AI
and human-override cases. **Demo/fixture data is clearly labeled and never
presented as real research** (`17` §10).

# 7. Test-First for Complex Logic

For DOI normalization, deduplication, outcome classification, taxonomy, and
permissions: define examples → write tests → implement → run → review edge cases
(master prompt §74).

# 8. CI Integration

The critical suites run in CI on every PR (`19` §5) without paid AI.
