# WiseEvidence
## Roadmap

**Document:** `docs/22-ROADMAP.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `02-PRODUCT-REQUIREMENTS.md`, `docs/reports/MVP-SCOPE.md`

---

# 1. Purpose

Define the staged milestone sequence. Build in order; do not silently jump ahead
(master prompt §34, §77). Each milestone ends with a checkpoint report (§13).

# 2. Phase 0 — Architecture Completion  ✅ complete

Complete architecture specs `05`–`23`, ADRs, cross-check/contradiction report,
final MVP scope, tech-stack decision. **No major features.** (master prompt §78.)

# 3. Phase 1 — Repository Foundation  ✅ complete

Astro app, base styling, folder structure (`apps/web`, `packages/*`), environment
config, Supabase connection strategy, CI, test runner, lint, type checking,
`README`/`CONTRIBUTING`/`SECURITY`/`LICENSE`. No unnecessary features
(master prompt §79, §28). Delivered: pnpm workspace, `apps/web` (Astro + React
island + Tailwind), `packages/domain` (`normalizeDoi` + tests), strict TS,
ESLint, Prettier, Vitest, GitHub Actions CI, and the governance files.

# 4. Phase 2 — Database Foundation  ✅ delivered

Migrations, core entities & relationships, indexes, RLS, seed data, database
tests (master prompt §80, `05`, `20`). Delivered: `supabase/migrations/0001`–
`0009`, reference seed + demo fixtures, `packages/database` (typed mirror,
migration runner, PGlite + Supabase-auth-shim harness, read-only data access),
and schema + RLS test suites (ADR-012).

# 5. Phase 3 — Manual Research MVP  ✅ delivered

Admin authentication, research creation, DOI input, metadata retrieval, research
editor, classification fields, review queue, publish workflow, public detail
page, audit trail (master prompt §81, `11` §2, `12`). Delivered: Supabase Auth +
middleware, `packages/metadata` (Crossref + mock), the research workflow service
(fail-closed publish; ADMIN-only publish/archive), admin editor + API routes,
SSR `/research/[id]`, and 75 tests. Real-Supabase integration is a documented
pending gate (`19` §11); the workflow + RLS are verified deterministically on
PGlite (ADR-012).

# 6. Phase 4 — Public Research Explorer  ✅ delivered

Homepage, search, research list, filters, sorting, research detail, DOI copy,
source links, conditions, interventions, research cards (master prompt §82, `14`,
`15`). Delivered: PostgreSQL explorer query layer (ADR-014, migration 0012),
`/research` SSR explorer (URL-persistent filters, facets, pagination, mobile
drawer, accessible), research cards with separate dimensions (no efficacy score),
and 22 search tests (97 total). No AI/vector/community/pyramid/weighting.

# 7. Phase 5 — Evidence Visualization  ✅ delivered

Evidence pyramid, outcome distribution, quality display, criticism display,
explore pages (master prompt §83, `15` §5). Honesty rules apply (`15` §6). Governed
by `docs/24-EVIDENCE-VISUALIZATION-METHODOLOGY.md` and ADR-015: study-based
counting, distributions-not-conclusions, valence-neutral encoding, no efficacy/
balance/weighting.

# 8. Phase 6 — AI Enrichment  ← current

AI abstraction, provider config, cheap-model strategy, prompt system + versioning,
cache, summaries, classification suggestions, human approval, AI provenance
(master prompt §84, `10`). Governed by `ADR-016`: **suggestion-only**
(`Research data → AI suggestion → Human review → Canonical value`), a
provider-neutral `packages/ai` (`MockAIProvider` default; `OpenAICompatibleProvider`
for OpenRouter/DeepSeek-style aggregators via server-only `AI_*` env), all six
tasks (summary, study-type, evidence-level, outcome, quality, criticism) with
validated structured output, `ai_job`/`ai_result` provenance + cache, and an
editor Accept/Edit/Reject panel. AI never publishes, never writes a canonical
classification, never enters the M5 statistics. No live AI in CI (mock + injected
fake `fetch`); real provider access is a pending gate (`19` §11).

# 9. Phase 7 — Automated Discovery

First structured source connector: discovery, fetch, normalize, deduplicate,
review-queue integration, scheduled job. Not all sources at once (master prompt
§85, `11` §11).

# 10. Phase 8 — Additional Sources

Add connectors incrementally, each with tests, fixtures, normalization, and
provenance (master prompt §86).

# 11. Phase 9 — Community

Submit research, report error, suggest correction, classification disagreement,
bookmarks — only after the research core is stable (master prompt §87, `13`).

# 12. Phase 10 — Advanced Intelligence

Semantic search, citation graph, research relationships, AI research assistant,
trend analysis, evidence maps, multilingual, comparison. Not in MVP; each needs
an ADR + cost justification (master prompt §88, `02` §12 P3).

# 13. Milestone Checkpoints

At the end of each milestone, stop and report (master prompt §36, §77):
**Completed · Files · Tests · Database changes · Architecture decisions · Known
issues · Cost impact · Security considerations · Next.**

# 14. Priority Mapping

MVP priority tiers (P0–P3) are in `02` §12; the finalized MVP scope is in
`docs/reports/MVP-SCOPE.md`.
