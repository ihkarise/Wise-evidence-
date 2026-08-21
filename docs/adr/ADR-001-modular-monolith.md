# ADR-001: Modular Monolith

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/04-SYSTEM-ARCHITECTURE.md` §4–5, `00-ARCHITECTURE-BASELINE.md` §16–17

## Context

WiseEvidence needs clear internal boundaries (Research, Taxonomy, Search,
Classification, AI, Import, Review, Auth, Admin, Community, Provenance, Audit) but
is an early-stage, low-budget, small-contributor project. Microservices would add
deployment, networking, and operational cost with no measured benefit at this
scale.

## Decision

Build a **modular monolith** with managed services. Keep strong logical module
boundaries in code (`packages/*`) without splitting them into independently
deployed services.

## Consequences

- Simple local development and deployment; one build/test pipeline.
- Boundaries are enforced by package structure and discipline, not the network.
- Services are extracted **only** when a measured trigger appears — independent
  scaling, deployment independence, failure isolation, or a real bottleneck
  (`04` §48). Premature microservices are explicitly rejected.
