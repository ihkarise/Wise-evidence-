# Contributing to WiseEvidence

Thanks for helping build WiseEvidence — an open, human-curated, AI-assisted
evidence platform for homeopathy research. Please read this alongside
[`CLAUDE.md`](CLAUDE.md), [`docs/18-OPEN-SOURCE-GOVERNANCE.md`](docs/18-OPEN-SOURCE-GOVERNANCE.md),
and [`docs/23-AI-AGENT-INSTRUCTIONS.md`](docs/23-AI-AGENT-INSTRUCTIONS.md).

## Non-negotiable domain rules

These protect the platform's credibility. Keep these dimensions **separate** —
never collapse them into one field or score:

- **Outcome** ≠ **Evidence Quality** ≠ **Confidence** ≠ **Criticism** ≠ **Provenance**

Also: AI is an assistant, not the final authority; important classifications are
human-reviewed before publish; PostgreSQL is authoritative (migrations only);
manual import before scraping; no researcher reputation scoring; treat research
and scraped text as untrusted input. There is **no efficacy score**.

## Getting started

Prerequisites: Node `>=22` and `pnpm` (this repo pins `pnpm@10`). Then:

```bash
pnpm install
pnpm -w test        # run the test suite
pnpm -w typecheck   # type-check all packages
pnpm -w lint        # lint
pnpm --filter web dev    # run the web app locally
pnpm --filter web build  # build the static site
```

Copy `.env.example` to `.env` for local config. **Never commit real
credentials** — only `.env.example` is tracked.

## Workspace layout

```text
apps/web           Astro app (static-first + React islands)
packages/domain    portable, framework-free domain logic (e.g. DOI normalization)
docs/              architecture specs, ADRs, and reports (source of truth)
supabase/          database config (migrations/seed) — schema arrives in Milestone 2
```

`packages/domain` must not import Astro, React, the Supabase SDK, an AI SDK, or a
scraper library — keep domain logic portable.

## Workflow

1. Open (or find) an issue. Use the templates in `.github/ISSUE_TEMPLATE/`.
2. Branch from the default branch.
3. Make small, understandable commits with clear messages.
4. Ensure `pnpm -w lint`, `pnpm -w typecheck`, and `pnpm -w test` pass.
5. Open a pull request using the template; link related issues/ADRs/specs.

Significant architectural decisions must be recorded as an ADR in `docs/adr/`
(see the template there). Do not let code and architecture docs silently diverge.

## Tests

Write tests for critical logic (DOI normalization, deduplication, classification,
permissions, publication, import normalization, the AI provider abstraction). Use
deterministic mocks for AI and external sources — no test may call a paid AI
provider or a live external source.

## Data contributions

Preserve DOI, source, identifiers, and publication metadata. Do not fabricate
abstracts or outcomes. AI-generated summaries are labeled until human-reviewed.
Contributions flow through the import → review → publish pipeline; community input
never directly overwrites canonical records.

## License

By contributing, you agree that your code contributions are licensed under
**Apache-2.0** and that curated research data/metadata is licensed under
**CC-BY-4.0** (see [`docs/adr/ADR-011-licensing.md`](docs/adr/ADR-011-licensing.md)).

## Security

Report vulnerabilities privately — see [`SECURITY.md`](SECURITY.md). Do not open a
public issue for an unpatched vulnerability.
