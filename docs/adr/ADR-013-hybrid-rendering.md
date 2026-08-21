# ADR-013: Hybrid Rendering (Static + SSR via @astrojs/node)

**Status:** Accepted
**Date:** 2026-08-21
**Related:** ADR-004, `docs/04-SYSTEM-ARCHITECTURE.md` §9, `docs/12-ADMIN-ARCHITECTURE.md`, `docs/16-SECURITY.md`

## Context

Milestone 3 introduces authentication, an admin/reviewer workspace, server API
operations, and public research detail pages. ADR-004 established a static-first
public site. Two forces must be reconciled:

1. Authentication, admin, and mutations require **server-side rendering** and
   server endpoints — they cannot be pure static output, and authorization must
   not depend on client-side route hiding (`docs/16`).
2. Research records are **added and published continuously**. Requiring a full
   static rebuild every time a record is approved conflicts with WiseEvidence's
   long-term research-database nature.

This left ADR-004 ambiguous about `/research/[id]`. This ADR resolves it.

## Decision

Adopt a **hybrid rendering model** with the free, portable **`@astrojs/node`**
adapter (standalone). Rendering is chosen per route:

- **Prerendered / static** (`export const prerender = true`): stable
  informational pages — `/`, `/methodology`, and future about/evidence-definition
  pages.
- **Server-rendered (SSR)**: dynamic research records `/research/[id]`,
  authenticated administration `/admin/*`, and server/API routes `/api/*`.

This is a deliberate **refinement** of ADR-004's static-first default, not a move
to an all-SSR application. ADR-004 is updated to reference this ADR so the two are
explicitly consistent.

## Consequences

- New records appear immediately via SSR — no site-wide rebuild per publication.
- Public informational pages keep static performance/SEO benefits (ADR-004).
- Admin and API routes run server-side, where session and RLS are authoritative
  (`docs/16`). The frontend still holds no privileged secrets.
- Adds the `@astrojs/node` adapter (free, host-agnostic). A host-specific adapter
  can replace it later without changing the per-route model.
- SSR public reads go only through the approved data-access layer and return
  **PUBLISHED** records only; RLS remains the authoritative protection.
