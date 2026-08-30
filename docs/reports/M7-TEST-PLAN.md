# M7 Test Plan — Automated Research Discovery (Design)

**Status:** plan only. **M7 IMPLEMENTATION = NOT STARTED. AUTHORIZATION = NOT
GRANTED.**
**Design:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`, `docs/adr/ADR-020-…md`,
`docs/20-TESTING.md`

Defines the tests a *future, authorized* M7 must ship. All tests are **deterministic
and offline**: network clients are **injected** and backed by **fixtures**; live-
source calls are **opt-in** and never required for CI green (matching the existing
`packages/metadata` / `packages/ai` test posture). No test is written in this design
session.

## Principles

- **Injected fetch + fixtures** for every connector; CI runs with no network, no key,
  no cost.
- **PGlite** for DB/RLS tests (existing harness), migrations `0001`–`0012` plus any
  authorized M7 additive migration.
- **No test weakens an existing guarantee** to go green (no skipped/disabled security
  tests).
- Extend, don't replace, the architecture-boundary guards.

## Test categories

### 1. Connector contract (unit)
- `DiscoveryProvider` conformance: `discover`/`fetch`/`normalize` shapes.
- Mock connector determinism: same input → identical output.
- Descriptor validation: invalid descriptor (missing host allowlist / non-HTTPS) is
  rejected at startup.

### 2. Connector fixtures (per source, offline)
Fixtures for the first connector (Crossref) covering:
- happy path → correct `NormalizedResearchInput`;
- **malformed** response (bad JSON / missing fields) → item error, run survives;
- **empty** response → zero candidates, clean run;
- **source failure** (5xx) → retry/backoff then recorded failure;
- **timeout** → aborted request, recorded;
- **rate limit** (429 + `Retry-After`) → honored backoff;
- **oversize** body → aborted, recorded;
- **pagination bounds** → stops at per-run caps.

### 3. Normalization
- DOI/title/date/author/journal normalization snapshots (deterministic).
- Markup/control-char sanitization of untrusted abstract/title.
- Malformed/missing fields handled without loss.

### 4. Identifier resolution
- `DOI→PMID→PMCID→source id→URL` resolution; canonical vs alternate.
- Canonical DOI equals `normalizeDoi()` output.
- Malformed/missing identifier → recorded on candidate, **never deleted**.

### 5. Deduplication (grades)
- exact DOI / persistent id → **link** to existing study (study ≠ publication), not a
  new study;
- normalized title + year → **probable** → `DUPLICATE_REVIEW`;
- similarity → **possible** → `DUPLICATE_REVIEW` (never auto-merge);
- unrelated → fresh candidate;
- **idempotency**: re-run of same item → no second candidate;
- **multi-publication / multi-study** separation.

### 6. Candidate lifecycle
- `DISCOVERED → FETCHED → NORMALIZED → (DUPLICATE_REVIEW) → READY_FOR_REVIEW →
  ACCEPTED/REJECTED`, plus `FAILED`/`SUPERSEDED`.
- Candidate state is independent of publication state.
- Rejected/failed candidates retained (not deleted).

### 7. Provenance & audit
- Provenance written on discovery; **append-only** (re-sighting adds an observation,
  never overwrites).
- Raw payload retained by hash; no full-text hosting.
- Audit entry on every state change.

### 8. Rate limiting / retry / backoff
- per-source rate limit respected; concurrency bounded;
- exponential backoff + jitter on transient errors; `Retry-After` honored;
- no retry on 4xx except 429;
- circuit breaker after consecutive failures → `health_status` reflects it.

### 9. Fetch security / SSRF
- non-allowlisted host refused;
- non-HTTPS scheme refused;
- loopback/private/link-local host refused;
- cross-host redirect refused;
- unexpected content-type rejected.

### 10. Malformed / hostile source data
- injection-like strings in abstract are inert data (never instructions, never
  reaching AI in discovery);
- spoofed/mismatched DOI rejected;
- partial records routed to review, not dropped silently.

### 11. AI isolation
- **no AI call occurs in the discovery path** (assert orchestrator has no AI import /
  no provider invocation);
- enrichment runs only on an accepted **draft**, as a suggestion; firewalls intact.

### 12. Human review / authorization
- reviewer can act on candidates but **cannot** enable/disable sources, trigger runs,
  or publish;
- accept → `createDraft()` (not a direct study/publish);
- ADMIN-only source/run controls and publish guard hold.

### 13. RLS
- anon and authenticated-non-staff **cannot** read `import_candidate`/`import_job`/
  `research_source`/observations (hard-denied);
- public still sees only `PUBLISHED` research;
- `service_role` (server) path works.

### 14. Architecture-boundary guards (extend existing suite)
- discovery package imports no vendor SDK and no UI framework;
- discovery orchestrator depends only on the `DiscoveryProvider` interface (no
  concrete connector import);
- discovery never imports the canonical-write / publish ops;
- no `Source → Draft`/`Source → Published` code path;
- no efficacy/popularity/combined-score field introduced by discovery.

### 15. Live opt-in (never in CI)
- A gated, env-flagged live smoke test per source (e.g. one real Crossref query),
  skipped by default like the existing `benchmark.live.test.ts`. Never required for
  green; used only for manual verification in a secure environment.

## CI posture

- Offline, deterministic, keyless — same as today.
- New tests colocate with their package (`packages/…/test` or `src/*.test.ts`) under
  the existing root Vitest config.
- Coverage target: every stage above has at least happy-path + one failure-mode test;
  every security/RLS/firewall invariant has an explicit test.

## Exit criteria (when authorized)

All categories green offline; architecture-boundary guards extended and passing;
live tests present but skipped by default. No existing test weakened.

**M7 IMPLEMENTATION = NOT STARTED. AUTHORIZATION = NOT GRANTED.**
