# Contributing to WiseEvidence

Thank you for your interest. WiseEvidence is an open, human-curated evidence
platform for homeopathy research. Its credibility depends as much on its data
model and transparency as on its code — please read this guide before opening a
pull request.

## Ground rules (non-negotiable)

These come from `CLAUDE.md` §3 and the architecture docs. Contributions that
violate them will not be merged:

- **Keep the evidence dimensions separate.** Study **outcome**, evidence
  **quality**, **confidence**, methodological **criticism**, and source
  **provenance** are distinct — never collapse them into one field or one score.
- **AI is an assistant, not the final authority.** AI suggestions are stored
  separately from human-reviewed values, with provenance preserved.
- **Outcome is a spectrum**, not a positive-vs-negative binary.
- **PostgreSQL is the authoritative store.** Schema changes go through
  version-controlled migrations, never manual dashboard edits.
- **Do not host research PDFs by default.** Prefer DOI / publisher / open-access
  links and permitted metadata; respect source terms, rate limits, and robots
  rules.

## Project status

The repository is at **Milestone 1 — Repository Foundation**. There is no
research catalogue, database schema, authentication, or AI pipeline yet. Please
do not implement later-milestone features ahead of the roadmap
(`docs/22-ROADMAP.md`); open an issue to discuss first.

## Workflow

```text
Issue → Discussion → Branch → Pull Request → Review → Merge
```

1. Open or find an issue describing the change.
2. Create a feature branch.
3. Make focused, well-described commits.
4. Ensure the checks below pass locally.
5. Open a pull request using the template. Maintainer review is required before
   merge; significant architectural changes require an ADR (`docs/adr/`).

## Development setup

Requires **Node 22** (see `.nvmrc`) and **pnpm 10+**.

```bash
pnpm install          # install workspace dependencies
pnpm dev              # run the Astro web app locally
```

## Checks that must pass

CI runs these on every pull request, with no AI key and no external network:

```bash
pnpm -w lint          # ESLint (flat config)
pnpm -w typecheck     # tsc (domain) + astro check (web)
pnpm -w test          # Vitest
pnpm --filter @wise-evidence/web build   # Astro build
pnpm format:check     # Prettier
```

## Testing expectations

Credibility-critical logic must be tested with **deterministic** unit tests and
no network — DOI normalization, deduplication, classification, permissions,
publication workflow, and the AI provider abstraction (`docs/20-TESTING.md`).
Mock AI and external sources; never hit a paid provider or a live source in a
test.

## Portability boundaries

- `packages/domain` must not import Astro, React, Supabase, or any AI SDK.
- Supabase-specific code stays in the data layer.
- AI provider SDKs stay below the `AIService` abstraction (later milestones).

## Licensing of contributions

By contributing, you agree that your code is licensed under **Apache-2.0** and
that curated research data/metadata is under **CC-BY-4.0** (`docs/adr/ADR-011`).
Contributions must preserve DOI, source, and identifiers, and must not include
fabricated abstracts or outcomes.

## Security

Do not file public issues for unpatched vulnerabilities — see
[`SECURITY.md`](./SECURITY.md) for private disclosure.

## Conduct

Participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).
Feedback focuses on research objects and code, not on individuals.
