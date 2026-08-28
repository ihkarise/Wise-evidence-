# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

---

## 1. What this repository currently is

**WiseEvidence** is an open, searchable, structured, AI-assisted and human-curated
**evidence platform for homeopathy research**. Its purpose is to make scattered
homeopathy research discoverable, understandable, comparable, and critically
reviewable — while keeping study outcome, evidence quality, criticism, confidence,
and provenance as _separate_ dimensions.

**Milestone 0 (Architecture) and Milestone 1 (Repository Foundation) are
complete.** The full architecture doc set exists, and so does the project
foundation: a pnpm workspace, an Astro web app with a React island, a
framework-independent `packages/domain` (with `normalizeDoi()`), CI, tooling,
and governance. There is still **no database schema, no research catalogue, no
authentication, and no AI pipeline** — those belong to Milestone 2+.

```text
.
├── CLAUDE.md                     # this file
├── CLAUDE-CODE-MASTER-PROMPT.md  # authoritative lead-architect brief
├── README.md
├── MANIFEST.md                   # index of all docs
├── package.json / pnpm-workspace.yaml / tsconfig.base.json  # M1 tooling
├── apps/web/                     # Astro (static-first) + React island + Tailwind
├── packages/domain/              # portable domain logic — normalizeDoi()
├── supabase/README.md            # DB strategy only; schema deferred to M2
├── .github/workflows/ci.yml      # CI: lint · typecheck · test · build
└── docs/
    ├── 00-ARCHITECTURE-BASELINE.md … 23-AI-AGENT-INSTRUCTIONS.md
    ├── 24-MULTI-SOURCE-INGESTION.md  # M8 design checkpoint (design-only)
    ├── adr/     ADR-001 … ADR-012 (+ index/template)
    └── reports/ ARCHITECTURE-CROSSCHECK · MVP-SCOPE · TECH-STACK-DECISION
```

Do not assume anything beyond M1 exists — inspect first (`git status`, `ls`,
read files) before acting. Do **not** implement Milestone 2+ features without
explicit authorization.

> **History:** the architecture originally shipped as
> `WiseEvidence_Architecture_Package_v0.1.zip`. In Milestone 0 it was unpacked
> into tracked files and the zip retired; specs `05`–`23`, ADRs, and the three
> reports were then written. See `MANIFEST.md`.

### The architecture docs

The tracked `docs/` tree is now the single source of truth. **Read these before
doing anything substantial** — order `00 → 04` for foundation, then the specific
specs your task touches. `CLAUDE-CODE-MASTER-PROMPT.md` is the single most
important document — the lead-architect brief for the whole project. This
CLAUDE.md summarizes it, but the master prompt governs where they differ.
`docs/reports/ARCHITECTURE-CROSSCHECK.md` records how cross-doc discrepancies
were resolved; `docs/23-AI-AGENT-INSTRUCTIONS.md` is the operating contract for
any coding agent.

### Architecture is complete; keep it consistent

Specs `05`–`23` and ADRs `001`–`011` now exist. Do **not** silently invent new
architecture that contradicts them — when a decision changes, update the relevant
doc, add an ADR if significant, and keep the set internally consistent (see §5).
Milestone 1 (Repository Foundation) is complete; the next step is **Milestone 2
— Database Foundation** (`docs/22-ROADMAP.md`), still no premature features.

Forward design may be documented ahead of build order without changing that
order: `docs/24-MULTI-SOURCE-INGESTION.md` and `ADR-012` are the approved
**Milestone 8** ingestion design, but they are **design-only** — M8
implementation is blocked on Phases 1–7 and must not be coded before them.

---

## 2. First rule: architecture before code

**Do not start writing application code.** The master prompt is explicit: the
first milestone is _Architecture Completion + Repository Foundation_, not features.

Before any substantial change:

1. Read the five drafted architecture docs (order: 00 → 01 → 02 → 03 → 04).
2. Inspect the repository (`git status`, directory structure, existing files).
3. Identify any existing technology and any existing user work.
4. Report what you found.
5. Propose the _smallest_ plan that follows the architecture.

Complete or advance the remaining architecture specs (§1, "documents that do not
yet exist") **before** substantial implementation. Do not invent a large
architecture without documenting the decisions behind it.

---

## 3. Non-negotiable domain rules

These are the credibility core of the project. Violating them corrupts the data
model, which is worse than shipping slowly.

**Keep these concepts separate — never collapse them into one field or one score:**

- Study **outcome** (what the study reported)
- Evidence **quality** (methodological rigor)
- **Confidence**
- Methodological **criticism**
- Source **provenance**

Corollaries the platform must be able to represent:

```text
AI            ≠ Final Authority
Outcome       ≠ Evidence Quality
Criticism     ≠ Negative Outcome
Source        ≠ Truth
Study Count   ≠ Scientific Certainty
Frontend      ≠ Privileged Backend
```

A positive study is not automatically high quality; a negative study is not
automatically low quality; criticism is not the same as a negative outcome. The
model must represent supportive, mixed, neutral, inconclusive, and critical
findings — never a positive-vs-negative binary.

**Outcome categories** (public): Strong Positive · Positive · Mixed/Leaning
Positive · Neutral/Inconclusive · Mixed/Leaning Negative · Negative · Strong
Negative. An internal score may drive visualization but must **not** be presented
as a validated scientific measurement.

### AI rules

AI is an **assistant, not the final authority**. It may extract metadata,
summarize, suggest study type / outcome / evidence level / tags, detect
duplicates, and identify related research. It must **not** silently become the
final authority for public classifications.

Store AI suggestions **separately** from human-reviewed final values, and always
preserve AI provenance: provider, model, prompt version, input hash, output,
timestamp, status, and confidence (and cost where available).

### Human review workflow

```text
Import → AI enrichment → Review queue → Human review → Publish
```

Do not publish automatically when human review is required. The admin review UI
must let a reviewer work with dropdowns, buttons, `+ Add` / Remove, checkboxes,
quick approve/reject — **never** by editing raw database rows.

### Research lifecycle

```text
DISCOVERED → IMPORTED → PROCESSING → PENDING_REVIEW → PUBLISHED
```

(plus appropriate failure / rejection / archive states). The fuller pipeline:
`Discovered → Imported → Normalized → Deduplicated → AI Enriched → Pending
Review → Reviewed → Published → Updated/Re-reviewed`.

### Deduplication order

```text
DOI → PMID/persistent identifier → normalized title → author + year → similarity
```

Never auto-delete a possibly-distinct paper on fuzzy match alone; route to a
duplicate-review workflow.

### Data, copyright & provenance

- **PostgreSQL is the authoritative source of application state.** JSON, Markdown,
  scraper output, and AI output are never the canonical database.
- All schema changes go through **version-controlled migrations** — never
  manual production dashboard edits.
- **Do not download or host research PDFs by default.** Prefer DOI, publisher
  URL, PubMed URL, open-access URL, and permitted metadata/abstract. Respect
  source terms, robots rules, rate limits, and licensing. Prefer structured APIs
  over HTML scraping.
- **Do not build scraping first.** The first working data flow is manual:
  `Admin → DOI/URL → Metadata → Research Record → AI enrichment → Review →
Publish`. Source connectors come only after that works reliably.
- Do **not** build researcher upvote/downvote reputation scoring. Focus community
  feedback on research objects (summary/metadata accuracy, classification
  disagreement, usefulness), not personal reputation.

---

## 4. Technology direction (preferred, not yet installed)

When implementation begins, the master prompt and system architecture point to:

- **Astro** for the site, **React** only where interactivity requires it
  (static-first with interactive islands).
- **Tailwind CSS** or a similarly simple design system.
- **Supabase / PostgreSQL** (Auth, Edge Functions where appropriate, Storage only
  when justified). Use Row-Level Security; security must not depend on
  client-side hiding.
- **GitHub + GitHub Actions** for CI/CD.
- A **provider-independent AI service** abstraction — do not couple app logic to
  one AI provider; select the cheapest suitable model per task; cache on
  `research_id + operation + input_hash + model + prompt_version`.

**Architecture style:** a **modular monolith** with managed services. Keep logical
boundaries between Research, Taxonomy, Search, Classification, AI, Import, Review,
Authentication, Administration, Community, Analytics, Provenance, and Audit — but
do **not** turn them into microservices.

**Cost philosophy: _Free first. Cheap second. Paid only when justified._** Do not
introduce Kubernetes, microservices, Elasticsearch, a dedicated vector database,
expensive observability, or expensive AI-on-every-paper without a measured
requirement. If a paid service seems necessary, explain why _before_ adding it.

**Do not overbuild:** no mobile app, social network, recommendation engine, vector
DB, complex analytics, autonomous research agent, or search cluster unless it is
part of the current approved milestone.

If the repository ever already contains a technically sound stack that differs
from the above, do **not** rewrite it just to match the preference — explain any
deviation instead.

**Roles:** initially `PUBLIC`, `REVIEWER`, `ADMIN`. Public browsing needs no
login. Never expose service-role keys, AI provider secrets, or DB admin
credentials to the frontend.

---

## 5. Development workflow & conventions

### Git discipline

- **Work on the feature branch assigned for your current task** (create it from
  the latest default branch if it does not exist). Never push to another branch
  without explicit permission.
- Run `git status` and inspect existing changes **before** modifying files.
- **Never** delete or overwrite existing work without explicit justification.
- Use small, understandable commits with clear messages.
- Push with `git push -u origin <branch-name>`; retry network failures up to 4
  times with exponential backoff (2s, 4s, 8s, 16s).
- **Do not** open a pull request unless the user explicitly asks.
- If the branch's PR was already merged, restart the branch from the latest
  default branch for follow-up work rather than stacking onto merged history.

### Documentation discipline

When an architectural decision changes: (1) update the relevant document, (2)
write an ADR if the decision is significant, (3) update affected implementation
notes, (4) explain the reason. Never let code and architecture docs silently
diverge.

The architecture docs are now tracked under `docs/` (the v0.1 zip has been
unpacked and retired). Keep them versioned and extended in place; never let code
and architecture docs silently diverge.

### Testing (when code exists)

Write tests for the critical logic: DOI normalization, deduplication,
classification, research lifecycle, permissions, publication, import
normalization, search, and the AI provider abstraction. Use **deterministic
mocks** for AI and external source connectors.

### Local development (target state)

Developers must be able to run the project **without paying for AI**. Provide a
mock AI provider, mock import source, fixture imports, seed data, and test users.
Seed data should include representative records: positive, negative, mixed,
neutral, missing-DOI, duplicate, low-confidence AI classification, and
human-override cases.

### Working method for each milestone

`Inspect → Plan → Implement → Test → Review → Document → Report.` Do not silently
jump between milestones.

At the end of a major task, report under: **Completed** · **Files** · **Tests** ·
**Architecture** (decisions) · **Risks** · **Next** (smallest sensible step).

---

## 6. Milestone sequence

Build in this order (from the master prompt). Do not skip ahead.

1. **Architecture Completion + Repository Foundation** — finish the architecture
   docs; establish clean project structure, dev instructions, a basic Astro app,
   Supabase connection strategy, environment config, CI foundation, test
   foundation. No unnecessary features.
2. **Research Data Foundation** — migrations, research entities, taxonomy
   foundation, provenance, lifecycle, seed data, data-access layer, tests.
3. **Manual Research MVP** — admin login, add research, DOI metadata retrieval,
   research editor, review queue, publish workflow, public detail page.
4. **Public Research Explorer** — search, filters, sorting, evidence browsing,
   conditions, interventions, research cards.
5. **AI Enrichment** — AI abstraction, provider config, cheap-model strategy,
   prompt versioning, AI cache, summaries, classification suggestions, human
   review.
6. **Automated Research Discovery** — only after the earlier pipeline is stable.

Priority tiers for MVP scope live in `docs/02-PRODUCT-REQUIREMENTS.md` (P0 → P3).

---

## 7. Planned URL / information architecture

From `docs/03-INFORMATION-ARCHITECTURE.md` — the public and admin route maps the
implementation should target (not yet built):

**Public:** `/` · `/research` · `/research/:id` · `/evidence` · `/evidence/:slug`
· `/conditions` · `/conditions/:slug` · `/interventions` · `/interventions/:slug`
· `/criticism` · `/criticism/:slug` · `/authors` · `/journals` · `/explore` ·
`/timeline` · `/statistics` · `/methodology` · `/about` · `/contribute`

**Admin:** `/admin` · `/admin/review` · `/admin/research` · `/admin/imports` ·
`/admin/sources` · `/admin/taxonomy` · `/admin/ai` · `/admin/corrections` ·
`/admin/users` · `/admin/audit`

Guiding principle: the database may be complex; the UI must not feel complex.
Reveal complexity progressively (overview → details → advanced filters →
methodology → source). No dead ends — pages link to related entities.

---

## 8. When you find a problem

Do not hide it. Classify it (bug / architecture / data / security / scope /
documentation / external dependency issue), then explain the safest correction.
Before any significant change, ask: Does this follow the architecture? Is it
needed for the current phase? Can it be simpler? Does it increase recurring cost?
Does it create vendor lock-in? Does it need an ADR?

Optimize for correct architecture, reliable research data, transparent
provenance, human-reviewable AI, low cost, maintainability, testability, and
open-source contribution — **not** for the amount of code written. The platform's
credibility depends on its data model and transparency as much as its UI.
