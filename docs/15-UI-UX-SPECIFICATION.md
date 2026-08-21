# WiseEvidence
## UI / UX Specification

**Document:** `docs/15-UI-UX-SPECIFICATION.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `03-INFORMATION-ARCHITECTURE.md`, `04-SYSTEM-ARCHITECTURE.md`, `07-OUTCOME-CLASSIFICATION.md`

---

# 1. Purpose

Define the UI/UX direction: look and feel, key components, rendering strategy,
and the honesty rules that keep visuals from implying certainty the data does not
support.

# 2. Design Feel

Scientific, modern, clean, trustworthy, visual, and data-rich **without being
confusing** (master prompt §29). The database may be complex; the UI must not
feel complex (`03` §28).

# 3. Progressive Disclosure

```text
Simple overview → Structured details → Advanced filters → Methodology → Source
```

Reveal complexity gradually (`03` §28). No dead ends — pages link to related
entities (`03` §23).

# 4. Rendering Strategy

Static-first with interactive islands (`04` §7, §9):
- **Mostly static:** about, methodology, evidence definitions, published research
  pages where appropriate.
- **Dynamic:** search, admin, user-specific features.
- **Interactive islands (React only where needed):** search controls, filters,
  evidence pyramid, outcome visualization, copy-DOI, admin controls.

Avoid shipping large JS bundles unnecessarily (`54`, master prompt §54).

# 5. Key Components

- **Evidence Pyramid** — navigation/visualization of evidence levels; explicitly
  *not* a truth claim (`04` §19, `06`).
- **Outcome distribution** — shows reported outcomes across indexed research; must
  disclose methodology and never present as proof of efficacy (`13` §5, master
  prompt §59).
- **Research cards** — fields per `03` §6.
- **Evidence / quality / confidence indicators** — separate, distinctly labeled
  (`07`, `08`).
- **Criticism panels** — origin-labeled (author / reviewer / AI / external),
  separate from outcome (`09`).
- **Research timeline** — publication history, not a measure of truth (`03` §15).
- **Filters, search, comparison** interfaces.

# 6. Honesty Rules (mandatory)

- Never use visual elements that imply scientific certainty the data does not
  support (master prompt §29).
- Outcome, quality, confidence, and criticism are shown as **separate** signals,
  never merged into a single efficacy score (`00` §4).
- AI-assisted, unreviewed content is labeled as such (`10` §11).
- Any weighting/balance visualization discloses its methodology (`13` §5).

# 7. Research Detail Page

Structure per `03` §7: title, authors, publication metadata, DOI, source links,
research snapshot, outcome, confidence/quality, what the study investigated, key
findings, AI summary (labeled), limitations, criticism, "why this
classification?", related research, source/provenance. DOI and original source
are always clearly shown (`04` §18-public).

# 8. Accessibility

Strong baseline (master prompt §55, `20` a11y tests): semantic HTML, keyboard
navigation, visible focus, accessible labels, sufficient contrast,
screen-reader-friendly controls, reduced-motion support. Visualizations need
mobile/non-visual alternatives (`03` §24).

# 9. Mobile

Prioritize search, research, explore, evidence, and menu (`03` §24). Responsive
layouts; visualizations degrade gracefully.

# 10. SEO

Public entities carry canonical URL, title, description, Open Graph, structured
data where appropriate, and sitemap inclusion (`03` §25, master prompt §56). Do
not mass-generate thin pages purely for SEO (master prompt §56).

# 10a. Public Explorer (M4)

The `/research` explorer (`apps/web/src/pages/research/index.astro`) is
server-rendered with a URL-persistent GET form: search box, filter controls
populated from DB facets (study type, evidence level, reported outcome, quality,
condition, intervention, year range), sort, result count, `ResearchCard`s, and
pagination. Filters live in the URL (bookmarkable/shareable) and work without
JavaScript. Mobile filters use a native `<details>` drawer (no hover
dependency). Cards keep outcome, evidence quality, and evidence level as separate
labeled chips — **no combined score, no efficacy meter, no evidence pyramid**
(those are later, methodology-gated). Demo records are badged `DEMO`. Canonical
URL is `/research` (filter permutations are not indexed).

# 10b. Evidence Visualization (M5)

`/evidence` (evidence pyramid — studies by evidence level, plus a separate
study-type facet) and `/statistics` (reported-outcome, evidence-quality, and
criticism distributions) are server-rendered from study-based aggregates
(`getEvidenceLandscape`, anon RLS, PUBLISHED-only). They are governed by
`docs/24-EVIDENCE-VISUALIZATION-METHODOLOGY.md` and ADR-015: study is the unit
(`count(distinct study_id)`; publications counted separately and labelled),
distributions not conclusions, **valence-neutral** encoding (single neutral hue;
meaning in labels), explicit "Unclassified" buckets, and **no** efficacy score,
balance, or weighting. Every chart (`DistributionChart.astro`) carries the value
and label as text with a `<table>` equivalent — no information lives only in
geometry or colour. Evidence-level segments link into the M4 explorer
(`/research?evidenceLevel=…`).

# 11. Copy DOI & Source

Copy-DOI is a first-class island action (`02` §MVP, `03` §6). Every published
record links to its original publication.
