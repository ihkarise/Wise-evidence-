# ADR-006: Human Review Requirement

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/10-AI-ARCHITECTURE.md` §11, `07-OUTCOME-CLASSIFICATION.md` §8, `12-ADMIN-ARCHITECTURE.md` §9, `05-DATABASE-ARCHITECTURE.md` §9

## Context

WiseEvidence's credibility depends on important public classifications being
traceable, reversible, and human-accountable. AI can misread endpoints,
misclassify study types, or over-read abstracts. If AI silently published
classifications, the platform would present machine guesses as curated evidence.

## Decision

`AI ≠ Final Authority`. Important public classifications follow **AI suggestion →
Human review → Final value**. AI suggestions are stored separately from
human-reviewed finals; nothing publishes automatically while review is required.
Human overrides preserve both the AI suggestion and the human decision + reason.

## Consequences

- Public records reflect human-reviewed values; AI-only values are labeled
  "AI-assisted, pending review."
- Requires a first-class review queue and admin workflow (`12`).
- Full provenance and audit are retained (`05` §9–10, `17` §6).
- Throughput is gated by reviewer capacity — an accepted trade-off for
  credibility.
