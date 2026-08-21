# WiseEvidence — Final MVP Scope

**Document:** `docs/reports/MVP-SCOPE.md`
**Version:** 0.1.0
**Status:** Milestone 0 output
**Date:** 2026-08-21
**Related:** `02-PRODUCT-REQUIREMENTS.md` §12–13, `22-ROADMAP.md`

---

# 1. Purpose

Define the finalized MVP scope: what the first shippable WiseEvidence must do,
drawn from `02` priority tiers and the master-prompt milestones. This bounds
Milestones 1–4.

# 2. MVP Goal

> An administrator can create and curate structured, human-reviewed research
> records; a public user can discover, understand, filter, and follow those
> records to their original source.

# 3. In Scope (MVP = P0 + essential P1)

## Data & platform (Milestones 1–2)
- Astro app, repo structure, CI, tests, env config, Supabase connection.
- PostgreSQL schema via migrations for: ResearchStudy/Publication, Author,
  Journal, Condition, Intervention, StudyType, EvidenceLevel, Outcome, Quality,
  Criticism, Classification, ResearchSource/Identifier, Review, AuditLog, User/
  Role, Tag. RLS for public vs privileged.
- Seed + fixtures (positive/negative/mixed/neutral/duplicate/missing-DOI),
  clearly labeled demo data.

## Manual Research MVP (Milestone 3)
- Admin authentication (`REVIEWER`/`ADMIN`).
- Add research via DOI/URL; DOI normalization; metadata retrieval.
- Research editor with structured classification controls (study type, evidence
  level, outcome, confidence, quality, conditions, interventions, tags,
  criticism).
- Review queue; quick approve/reject; override reasons.
- Publish workflow (no auto-publish while review required).
- Audit trail; provenance on every record.
- Duplicate detection → duplicate-review (no auto-delete).

## Public Explorer (Milestone 4)
- Homepage with search entry.
- Search (title, abstract, author, journal, DOI, condition, intervention,
  keywords) via PostgreSQL FTS; DOI exact-match priority.
- Filters (study type, evidence level, outcome, year, condition, intervention,
  journal, country, source, quality) and sorting.
- Research result cards; research detail page (with "why this classification?",
  criticism, source links, copy-DOI).
- Conditions and interventions listing pages.
- Responsive UI + baseline accessibility; SEO basics.

## AI (minimal, Milestone-3 assist / fuller in Milestone 6)
- AI provider abstraction with **mock provider** available from the start.
- Basic AI summary + classification *suggestions*, stored separately, human-
  reviewed before publish. (Full enrichment pipeline is Milestone 6.)

# 4. Out of Scope for MVP (deferred)

- Automated scraping / source connectors beyond manual (Milestone 7+).
- Evidence pyramid & outcome-distribution visualizations as polished features
  (Milestone 5) — MVP may show simple structured indicators only.
- Community features: submissions, error reports, corrections UI, bookmarks,
  accounts (Milestone 9).
- Semantic search, citation graph, research assistant, multilingual, comparison,
  public API, Hermes automation (P3 / Milestone 10).
- Balance/weighting efficacy visualization (only later, with disclosed
  methodology).

# 5. MVP Acceptance Criteria

**Administrator can** (`02` §13): create research, enter DOI, retrieve metadata,
edit metadata, classify study type, classify outcome, add confidence/quality,
review AI summary, publish.

**Public user can** (`02` §13): search, filter, open research, read summary, see
classification, see source, copy DOI, open the original publication.

# 6. Non-Functional Targets

Low cost (free/low tiers), fast on mobile/low-bandwidth, provider-independent AI,
secure (RLS + server-side authz + prompt-injection defense), maintainable,
scalable from hundreds to tens of thousands of records (`02` §11).

# 7. Explicit Guardrails Carried Into MVP

Outcome ≠ quality ≠ confidence ≠ criticism ≠ provenance; AI ≠ final authority;
human review before publish; no researcher reputation scoring; no PDF hosting by
default; PostgreSQL authoritative via migrations; manual import before scraping.
