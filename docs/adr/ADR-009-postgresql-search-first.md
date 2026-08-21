# ADR-009: PostgreSQL Search First

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/14-SEARCH-ARCHITECTURE.md`, `04-SYSTEM-ARCHITECTURE.md` §37, `21-COST-CONTROL.md` §7

## Context

Search over title, abstract, authors, journal, conditions, interventions,
keywords, and DOI is a core feature. A dedicated search engine (Elasticsearch) or
a vector database adds infrastructure, cost, and operational burden that the MVP's
scale (hundreds → tens of thousands of records) does not justify.

## Decision

Use **PostgreSQL full-text search** for the MVP, behind a **search service
abstraction** so the implementation can evolve without rewriting callers. DOI-like
queries use exact canonical-DOI matching with priority. No Elasticsearch and no
vector database during MVP.

## Consequences

- No extra search infrastructure or cost (`21`).
- The abstraction allows a later upgrade (improved FTS, then optionally semantic
  search) under its own ADR + cost justification (`14` §9).
- Search failure must not make canonical research pages disappear (`04` §46) —
  the DB remains the source of truth.
