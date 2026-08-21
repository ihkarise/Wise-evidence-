# ADR-007: Manual Import Before Automated Scraping

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/11-DATA-IMPORT-ARCHITECTURE.md` §2, `04-SYSTEM-ARCHITECTURE.md` §33–34, `CLAUDE-CODE-MASTER-PROMPT.md` §11, §13

## Context

The tempting failure mode is "scrape everything → throw AI at it → figure out the
database later." That produces low-quality, duplicated, possibly
copyright-infringing data on top of an unproven model, and it hides the
review/provenance workflow that gives the platform its value.

## Decision

The **first** ingestion path is manual:
`Admin → DOI/URL → Metadata → Research candidate → AI enrichment → Human review →
Publish`. Automated source connectors are added only after this pipeline works
reliably (Milestone 7+), each behind the common connector interface and a
source-terms/robots/licensing review.

## Consequences

- The core system works without any scraper; automation is additive and
  failure-isolated (`11` §11).
- Data quality, dedup, provenance, and review are validated on real records early.
- Slower initial volume — accepted in exchange for correctness and legal safety
  (`17` §5).
