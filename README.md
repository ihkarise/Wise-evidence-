# WiseEvidence

An open, searchable, structured, **AI-assisted and human-curated evidence
platform for homeopathy research**. WiseEvidence makes scattered research
discoverable, understandable, comparable, and critically reviewable — while
keeping study **outcome**, evidence **quality**, **confidence**, methodological
**criticism**, and source **provenance** as *separate* dimensions.

> Find it. Understand it. Compare it. Question it. Follow the source. Explore the
> evidence.

## Project status

Early, staged development. **Milestone 0 (Architecture Completion)** and
**Milestone 1 (Repository Foundation)** are complete: the architecture is fully
documented and a runnable foundation exists (Astro app, workspace, tests, CI). No
research records are published yet — the data model and manual research MVP arrive
in Milestones 2–3 (see [`docs/22-ROADMAP.md`](docs/22-ROADMAP.md)).

## What it is (and isn't)

WiseEvidence represents supportive, mixed, neutral, inconclusive, and critical
findings — never a positive-vs-negative binary — and never presents a validated
"efficacy score." AI is an **assistant, not the final authority**: important
public classifications are human-reviewed, traceable, and reversible, and always
link back to the original source. See [`docs/01-VISION.md`](docs/01-VISION.md).

## Repository layout

```text
apps/web           Astro app (static-first + React islands)
packages/domain    portable, framework-free domain logic (e.g. DOI normalization)
docs/              architecture specs (00–23), ADRs, and reports — the source of truth
supabase/          database config (migrations/seed) — schema arrives in Milestone 2
prompts/           versioned AI prompts (Milestone 6)
```

Start with [`CLAUDE.md`](CLAUDE.md) and [`docs/00-ARCHITECTURE-BASELINE.md`](docs/00-ARCHITECTURE-BASELINE.md);
[`MANIFEST.md`](MANIFEST.md) indexes every document.

## Development

Prerequisites: **Node ≥ 22** and **pnpm 10**.

```bash
pnpm install              # install workspace dependencies
pnpm --filter web dev     # run the web app locally (http://localhost:4321)
pnpm --filter web build   # build the static site
pnpm -w test              # run the test suite (Vitest)
pnpm -w typecheck         # type-check all packages
pnpm -w lint              # lint
pnpm -w format            # format with Prettier
```

Copy [`.env.example`](.env.example) to `.env` for local config. **Never commit
real credentials** — only `.env.example` is tracked. The frontend reads only the
public `PUBLIC_SUPABASE_*` variables; privileged secrets are server-side only
(see [`docs/16-SECURITY.md`](docs/16-SECURITY.md)).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md),
and [`SECURITY.md`](SECURITY.md). Significant architectural decisions are recorded
as ADRs in [`docs/adr/`](docs/adr/).

## License

- **Code:** Apache-2.0 — see [`LICENSE`](LICENSE).
- **Curated research data & metadata:** CC-BY-4.0 (attribution required).

See [`docs/adr/ADR-011-licensing.md`](docs/adr/ADR-011-licensing.md).
