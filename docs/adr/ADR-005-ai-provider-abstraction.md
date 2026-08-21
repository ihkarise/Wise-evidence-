# ADR-005: AI Provider Abstraction

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/10-AI-ARCHITECTURE.md`, `04-SYSTEM-ARCHITECTURE.md` §22–26, `21-COST-CONTROL.md`

## Context

AI provider pricing, availability, and quality change frequently. Coupling
application logic to one provider's SDK creates lock-in and blocks cheap-model
selection, local models, and deterministic testing.

## Decision

All AI use goes through a **provider-independent `AIService`** exposing
domain operations (summarize, classify, extract, detect duplicates). Concrete
`AIProvider` implementations (mock, hosted, local) are selected by configuration
**per task**, choosing the cheapest suitable model. Domain packages contain no
provider-specific code.

## Consequences

- Providers are swappable; the cheapest suitable model is chosen per task (`21`).
- A deterministic **mock provider** enables development and CI without spend
  (`10` §14, `20`).
- Every result records provider/model/prompt-version/input-hash provenance and is
  validated before storage (`10` §6, §10).
- Adds one abstraction layer to maintain — accepted for portability and cost
  control.
