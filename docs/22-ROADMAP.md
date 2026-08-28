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

# 2. Phase 0 — Architecture Completion  ← current

Complete architecture specs `05`–`23`, ADRs, cross-check/contradiction report,
final MVP scope, tech-stack decision. **No major features.** (master prompt §78.)

# 3. Phase 1 — Repository Foundation

Astro app, base styling, folder structure (`apps/web`, `packages/*`), environment
config, Supabase connection strategy, CI, test runner, lint, type checking,
`README`/`CONTRIBUTING`/`SECURITY`/`LICENSE`. No unnecessary features
(master prompt §79, §28).

# 4. Phase 2 — Database Foundation

Migrations, core entities & relationships, indexes, RLS, seed data, database
tests (master prompt §80, `05`, `20`).

# 5. Phase 3 — Manual Research MVP

Admin authentication, research creation, DOI input, metadata retrieval, research
editor, classification fields, review queue, publish workflow, public detail
page, audit trail (master prompt §81, `11` §2, `12`).

# 6. Phase 4 — Public Research Explorer

Homepage, search, research list, filters, sorting, research detail, DOI copy,
source links, conditions, interventions, research cards (master prompt §82, `14`,
`15`).

# 7. Phase 5 — Evidence Visualization

Evidence pyramid, outcome distribution, quality display, criticism display,
explore pages (master prompt §83, `15` §5). Honesty rules apply (`15` §6).

# 8. Phase 6 — AI Enrichment

AI abstraction, provider config, cheap-model strategy, prompt system + versioning,
cache, summaries, classification suggestions, human approval, AI provenance
(master prompt §84, `10`).

# 9. Phase 7 — Automated Discovery

First structured source connector: discovery, fetch, normalize, deduplicate,
review-queue integration, scheduled job. Not all sources at once (master prompt
§85, `11` §11).

# 10. Phase 8 — Additional Sources

Add connectors incrementally, each with tests, fixtures, normalization, and
provenance (master prompt §86).

**Design checkpoint:** `docs/24-MULTI-SOURCE-INGESTION.md` (+ `ADR-012`) is the
approved M8 design — source registry, incremental/idempotent checkpointing,
conservative cross-source dedup, source health, admin controls, RLS, cost/security
posture, and the deferred-scheduler boundary. It is **design-only**:
implementation is blocked on Phases 1–7 (repo foundation, database, manual MVP,
first connector), which do not yet exist. Build in order; do not jump ahead.

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
