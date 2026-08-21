# ADR-002: PostgreSQL First

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/04-SYSTEM-ARCHITECTURE.md` §13, `05-DATABASE-ARCHITECTURE.md`, `17-DATA-GOVERNANCE.md` §2

## Context

The platform needs one authoritative, relational, auditable source of truth for
research, taxonomy, classifications, reviews, AI runs, provenance, and audit
history. Scraper output, JSON, Markdown, and AI output are all derived,
non-canonical data.

## Decision

**PostgreSQL is the authoritative source of application state.** All schema
changes go through version-controlled migrations. No file, scraper output, or AI
output is ever the canonical database, and no production schema change is made by
hand in a dashboard.

## Consequences

- Strong relational integrity, constraints, indexes, full-text search, and RLS in
  one system.
- Migrations are mandatory and reviewed (`19` §6); this adds process but protects
  data integrity.
- Derived stores (search projections, caches) must never be treated as canonical.
