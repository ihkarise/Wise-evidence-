# ADR-004: Static-First Public Web (Astro + Islands)

**Status:** Accepted — refined by ADR-013 (per-route rendering)
**Date:** 2026-08-21
**Related:** `docs/04-SYSTEM-ARCHITECTURE.md` §7–9, `15-UI-UX-SPECIFICATION.md` §4, ADR-013

## Context

Most public pages (research detail, methodology, about, evidence definitions) are
read-heavy and benefit from fast, cacheable, SEO-friendly static rendering. Only
some surfaces (search, filters, visualizations, admin) need client interactivity.
Shipping a large SPA bundle everywhere would hurt performance on mobile and low
bandwidth.

## Decision

Use **Astro** for the site with a **static-first** approach and **React
interactive islands** only where interactivity is required (search, filters,
evidence pyramid, outcome visualization, copy-DOI, admin controls). Tailwind CSS
(or a similarly simple system) for styling.

## Consequences

- Fast, cacheable, SEO-friendly public pages (`15` §10, `54`).
- Minimal JavaScript shipped; interactivity is opt-in per island.
- The frontend holds no privileged secrets or business logic (`04` §8).
- Admin/dynamic surfaces are rendered dynamically within the same app.

## Refinement (ADR-013)

"Static-first" is **not** "all-static." Per-route rendering is decided by whether
a page's content is stable or continuously changing:

- **Prerendered/static:** stable informational pages — `/`, `/methodology`,
  about, evidence definitions.
- **SSR (server-rendered):** dynamic research records (`/research/[id]`),
  authenticated administration (`/admin/*`), and server/API operations (`/api/*`).

Research records are added and published continuously; requiring a full static
rebuild on every publication conflicts with WiseEvidence's research-database
nature. ADR-013 records the hybrid rendering model and the `@astrojs/node`
adapter that enables it. ADR-004 and ADR-013 are therefore consistent, not
contradictory: ADR-004 sets the static-first default; ADR-013 defines exactly
which routes opt into SSR.
