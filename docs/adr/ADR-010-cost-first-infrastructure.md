# ADR-010: Cost-First Infrastructure

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/21-COST-CONTROL.md`, `00-ARCHITECTURE-BASELINE.md` §14, `CLAUDE-CODE-MASTER-PROMPT.md` §7

## Context

WiseEvidence is a low-budget, open-source, public-good project. Infrastructure and
AI costs can grow silently and are the most likely thing to make the project
unsustainable.

## Decision

Adopt **Free first. Cheap second. Paid only when justified.** Do not introduce
Kubernetes, microservices, Elasticsearch, a dedicated vector database, expensive
observability, or expensive AI-on-every-paper without a measured requirement.
Every paid dependency requires a documented reason before adoption; proposing one
is a stop condition (`23` §11).

## Consequences

- Defaults to static-first hosting, Supabase free/low tiers, PostgreSQL FTS,
  cheap-model-first AI with caching and mocks (`21`).
- Some features are deferred until a measured need justifies their cost.
- Upgrades off free tiers are deliberate, justified, and (if architectural)
  recorded as ADRs (`21` §9).
