# WiseEvidence

**An open, searchable, structured, AI-assisted and human-curated evidence
platform for homeopathy research.**

WiseEvidence aims to make scattered homeopathy research discoverable,
understandable, comparable, and critically reviewable — while keeping study
**outcome**, evidence **quality**, **confidence**, **criticism**, and
**provenance** as _separate_ dimensions. A classification here describes the
state of the research; it is **not** a claim that a treatment works.

---

## Project status

**Milestone 1 — Repository Foundation.** This repository is an early-stage
scaffold. It contains:

- the complete architecture documentation (`docs/`), and
- the project foundation: a pnpm workspace, an Astro web app with a React
  island, a framework-independent domain package with the DOI normalizer, and
  the CI, tooling, and governance to build on.

It does **not** yet contain a research catalogue, search, database schema,
authentication, admin tools, or an AI pipeline. Those arrive in later milestones
(`docs/22-ROADMAP.md`). Nothing on the site should be read as a complete research
database.

## Repository layout

```text
.
├── apps/
│   └── web/                # Astro app (static-first) with React islands + Tailwind
├── packages/
│   └── domain/             # portable domain logic (no framework/SDK imports) — normalizeDoi()
├── supabase/               # DB strategy only in M1; migrations arrive in M2
├── docs/                   # architecture specs 00–23, ADRs, and reports
├── .github/workflows/      # CI (lint · typecheck · test · build; no secrets)
└── CLAUDE.md               # guidance for AI assistants working in this repo
```

## Architecture documentation

The `docs/` tree is the single source of truth for the design.

- Start with `docs/00-ARCHITECTURE-BASELINE.md` → `01` → `02` → `03` → `04`.
- `CLAUDE-CODE-MASTER-PROMPT.md` is the authoritative lead-architect brief.
- Decisions are recorded as ADRs in `docs/adr/`; Milestone 0 analysis lives in
  `docs/reports/`.
- `MANIFEST.md` indexes every document.

## Getting started

Requires **Node 22** (see `.nvmrc`) and **pnpm 10+**.

```bash
pnpm install          # install workspace dependencies
pnpm dev              # run the web app at http://localhost:4321
```

### Development commands

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `pnpm dev`          | Run the Astro web app locally                        |
| `pnpm build`        | Build the web app                                    |
| `pnpm -w lint`      | Lint the workspace (ESLint flat config)              |
| `pnpm -w typecheck` | Type-check (`tsc` for domain, `astro check` for web) |
| `pnpm -w test`      | Run the Vitest suite                                 |
| `pnpm format`       | Format with Prettier (`format:check` to verify)      |

## Testing

Credibility-critical logic is covered by **deterministic** unit tests with no
network and no paid AI (`docs/20-TESTING.md`). Milestone 1 ships the DOI
normalization suite (`packages/domain`). Run it with:

```bash
pnpm -w test
```

## Environment & secrets

Copy `.env.example` to `.env` (gitignored) for local development. Only
`PUBLIC_*` variables reach the browser; privileged keys (e.g. a Supabase
service-role key) are **server-side only** and are never committed. See
`SECURITY.md`.

## Contributing

Contributions are welcome — please read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
and the non-negotiable domain rules in `CLAUDE.md` §3 first. Report security
issues privately via [`SECURITY.md`](./SECURITY.md). Participation is governed by
our [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

- **Code:** Apache-2.0 — see [`LICENSE`](./LICENSE).
- **Curated research data & metadata (when it exists):** CC-BY-4.0.

See `docs/adr/ADR-011-licensing.md`. Third-party source metadata remains bound
by its own source terms.
