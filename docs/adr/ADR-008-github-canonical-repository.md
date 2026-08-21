# ADR-008: GitHub as Canonical Repository

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/18-OPEN-SOURCE-GOVERNANCE.md`, `19-DEPLOYMENT.md` §3, `04-SYSTEM-ARCHITECTURE.md` §42

## Context

The project is open-source and needs one canonical home for code, issues, pull
requests, review, ADRs, and CI/CD, at low cost and with broad contributor
familiarity.

## Decision

**GitHub is the canonical repository** and collaboration platform. CI/CD runs on
**GitHub Actions**. Contribution, review, and architecture-decision workflows are
GitHub-first.

## Consequences

- Familiar contribution workflow (issues → PRs → review → merge), free CI within
  limits (`19` §5, `21`).
- Repository hygiene files (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, LICENSE,
  templates) live here (`18` §4).
- CI must run without paid AI via the mock provider (`10` §14, `20`).
- Some coupling to GitHub-specific features (Actions) — acceptable and
  replaceable if needed.
