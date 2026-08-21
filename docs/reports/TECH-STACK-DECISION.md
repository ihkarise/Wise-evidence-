# WiseEvidence — Technology Stack Decision

**Document:** `docs/reports/TECH-STACK-DECISION.md`
**Version:** 0.1.0
**Status:** Milestone 0 output
**Date:** 2026-08-21
**Related:** `04-SYSTEM-ARCHITECTURE.md`, ADR-001…011

---

# 1. Purpose

Record the confirmed technology stack for WiseEvidence, with reasoning, so
Milestone 1 can scaffold against a decided foundation.

# 2. Confirmed Stack

| Layer | Choice | Rationale | ADR |
|-------|--------|-----------|-----|
| Web framework | **Astro** (static-first) | Fast, cacheable, SEO-friendly public pages; minimal JS | ADR-004 |
| Interactivity | **React islands** only where needed | Search, filters, visualizations, admin; avoid SPA bloat | ADR-004 |
| Styling | **Tailwind CSS** (or similarly simple system) | Simple, consistent, low overhead | ADR-004 |
| Backend platform | **Supabase** | Managed PostgreSQL + Auth + RLS + Edge Functions, low cost | ADR-003 |
| Database | **PostgreSQL** (authoritative) | Relational integrity, FTS, RLS, migrations | ADR-002 |
| Search | **PostgreSQL FTS** behind an abstraction | No search cluster/vector DB in MVP | ADR-009 |
| AI | **Provider-independent `AIService`** + mock | Cheapest-suitable model per task; no lock-in; free dev/CI | ADR-005 |
| Auth | **Supabase Auth**, roles PUBLIC/REVIEWER/ADMIN | Server-side authz + RLS | ADR-003, `16` |
| Repo / CI | **GitHub + GitHub Actions** | Open-source home, free CI within limits | ADR-008 |
| Architecture | **Modular monolith**, `packages/*` | Boundaries without microservice cost | ADR-001 |
| Hosting | Static-first host + Supabase (free/low tiers) | Cost-first | ADR-010, `19` |
| License | **Apache-2.0** (code) + **CC-BY-4.0** (data) | Broad reuse + attributable data | ADR-011 |

# 3. Repository Structure (target, Milestone 1)

Per master prompt §39 (adjust if inspection shows better):

```text
wise-evidence/
├── apps/web/                 # Astro app (public + admin)
├── packages/
│   ├── domain/               # portable research logic, no framework/SDK imports
│   ├── database/             # data access, migrations glue
│   ├── ai/                   # provider-independent AI service + providers
│   ├── importers/            # source connectors → NormalizedResearchInput
│   ├── search/               # search abstraction (PostgreSQL FTS impl)
│   ├── validation/           # DOI, schema, enum validation
│   └── ui/                   # shared UI components
├── supabase/                 # migrations, seed, functions
├── docs/ (+ adr/, reports/)
├── prompts/<task>/vN.md      # versioned AI prompts
├── scripts/  tests/  fixtures/
├── .github/workflows/
├── README.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  LICENSE  .env.example
```

Do not create unnecessary packages (`23` §6).

# 4. Portability Rules

- `packages/domain` imports no Astro, React, Supabase SDK, AI SDK, or scraper
  library (master prompt §40).
- Supabase-specific code stays in `packages/database`; the standard-PostgreSQL
  core keeps migration off Supabase feasible (ADR-003).
- AI provider SDKs stay below the `AIService` interface (`10` §3).

# 5. Deviation Policy

If the repository later contains a technically sound stack that differs from the
above, do **not** rewrite it just to match — explain the deviation and, if
significant, record an ADR (`00` §deviation, master prompt §9). Any new paid
dependency requires justification before adoption (`21` §2).

# 6. Status

This stack is confirmed for Milestones 1–6. Post-MVP additions (semantic search,
vector DB, etc.) are out of scope and require their own ADR + cost justification.
