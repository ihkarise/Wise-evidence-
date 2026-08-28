# @wise-evidence/domain

Portable, framework-independent domain logic for WiseEvidence.

**Rule:** this package imports **no** Astro, React, Supabase, or AI SDK, and
performs no I/O. It holds credibility-critical, deterministically testable logic
that every other layer builds on (see `docs/reports/TECH-STACK-DECISION.md` §4).

## Milestone 1 contents

- `normalizeDoi()` — the shared DOI canonicalizer (`docs/20-TESTING.md` §5).

More domain logic (deduplication, outcome/quality classification, lifecycle)
arrives in later milestones. Nothing here should ever be a place for framework
or vendor code.

## Scripts

```bash
pnpm --filter @wise-evidence/domain typecheck
pnpm -w test        # runs the domain test suite via Vitest
```
