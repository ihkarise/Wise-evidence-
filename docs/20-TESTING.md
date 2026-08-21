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
