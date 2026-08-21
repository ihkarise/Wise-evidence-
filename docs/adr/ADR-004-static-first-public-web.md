# ADR-004: Static-First Public Web (Astro + Islands)

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/04-SYSTEM-ARCHITECTURE.md` §7–9, `15-UI-UX-SPECIFICATION.md` §4

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
