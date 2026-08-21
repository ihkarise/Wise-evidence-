# WiseEvidence
## Architecture Baseline

**Document:** `docs/00-ARCHITECTURE-BASELINE.md`
**Version:** 0.1.0
**Status:** Draft Architecture Baseline
**Project:** WiseEvidence
**Repository:** `wise-evidence`

---

# 1. Purpose

This document establishes the foundational architecture for WiseEvidence, an open, searchable, structured, AI-assisted and human-curated evidence platform for homeopathy research.

It is the project's architectural source of truth until superseded by a formally approved version.

Future implementation agents and contributors must read this document before making architectural changes.

# 2. Product Vision

WiseEvidence aims to make homeopathy research easier to discover, understand, compare, and critically evaluate.

The platform will bring research scattered across journals, repositories, institutions, government resources, research organizations, and scholarly databases into a unified research discovery system.

# 3. Core Architectural Principle

> WiseEvidence is an AI-assisted research indexing and evidence exploration platform. AI may extract, summarize, classify, and recommend, but important public research classifications must remain human-reviewable, traceable, reversible, and linked to the original source.

AI is an assistant, not the final authority.

# 4. Second Core Principle

The system must distinguish between:

1. Study outcome
2. Evidence quality
3. Methodological criticism
4. Confidence
5. Source provenance

These are separate dimensions.

# 5. Evidence Philosophy

WiseEvidence must avoid reducing scientific literature to a simple positive-vs-negative binary.

The platform therefore uses several independent dimensions:

- Evidence level
- Study outcome
- Evidence quality
- Confidence
- Criticism
- Provenance

# 6. Initial Evidence Levels

Initial categories include:

1. Meta-analysis
2. Systematic Review
3. Randomized Controlled Trial
4. Controlled Clinical Trial
5. Cohort Study
6. Case-Control Study
7. Cross-Sectional Study
8. Case Series
9. Case Report
10. Expert Opinion
11. Animal Research
12. In Vitro Research
13. Other / Unclassified

The final taxonomy belongs in `06-EVIDENCE-TAXONOMY.md`.

# 7. Outcome Classification

The platform supports:

- Strong Positive
- Positive
- Mixed / Leaning Positive
- Neutral / Inconclusive
- Mixed / Leaning Negative
- Negative
- Strong Negative

An internal score may be used for visualization, but it must not be presented as a universally validated scientific measurement unless separately validated.

# 8. Outcome Does Not Equal Scientific Certainty

A study may have:

- Positive outcome + low confidence
- Negative outcome + high confidence
- Mixed outcome + moderate confidence

Outcome and confidence must remain separate.

# 9. AI Principle

AI may assist with:

- Metadata extraction
- Abstract summarization
- Keyword extraction
- Condition identification
- Intervention identification
- Study-type suggestion
- Outcome suggestion
- Duplicate detection
- Related research

AI output is a proposed interpretation unless approved.

# 10. Human Review

Important classifications follow:

AI suggestion → Human review → Final classification

The system must preserve the AI suggestion and the final human-reviewed result separately.

# 11. Research Lifecycle

```text
Discovered
→ Imported
→ Normalized
→ Deduplicated
→ AI Enriched
→ Pending Review
→ Reviewed
→ Published
→ Updated / Re-reviewed
```

# 12. Source Philosophy

Potential sources include:

- PubMed / NCBI
- Crossref
- Europe PMC
- Research in Homeopathy
- International Journal of High Dilution Research
- HRI
- CCRH
- Government and institutional repositories
- Manual DOI/URL submissions

Source inclusion does not mean endorsement of every claim from that source.

# 13. Full-Text Policy

Do not store research PDFs by default.

Prefer:

- DOI
- Publisher URL
- PubMed URL
- Open-access URL
- Metadata
- Permitted abstract/content
- License information

Respect copyright, licenses, terms, and source policies.

# 14. Cost Philosophy

> Free first. Cheap second. Paid only when justified.

Initial infrastructure should be deliberately low-cost.

# 15. Technology Direction

Preferred initial stack:

- Astro
- React where interaction requires it
- Tailwind CSS or equivalent
- Supabase / PostgreSQL
- GitHub
- GitHub Actions
- Low-cost AI provider abstraction

# 16. Architecture Style

Use a modular monolith with managed services.

Do not start with microservices, Kubernetes, dedicated search infrastructure, or a vector database.

# 17. Core Modules

Conceptual modules:

- Research
- Taxonomy
- Search
- Classification
- AI
- Import
- Review
- Authentication
- Administration
- Community
- Analytics
- Provenance
- Audit

# 18. Core Boundaries

```text
AI ≠ Final Authority
Outcome ≠ Evidence Quality
Criticism ≠ Negative Outcome
Source ≠ Truth
Study Count ≠ Scientific Certainty
Hermes ≠ Core Database
Frontend ≠ Privileged Backend
```

# 19. Development Sequence

1. Architecture
2. Governance
3. UX
4. Technical foundation
5. Manual MVP
6. Admin review
7. Public explorer
8. AI enrichment
9. Automated imports
10. Hermes automation

# 20. Architecture Freeze

Before production implementation, the following must be defined:

- Core entities
- Relationships
- Evidence taxonomy
- Outcome classification
- Review workflow
- AI boundaries
- Security
- MVP scope
- Deployment

Significant changes require an Architecture Decision Record.

# 21. Document Set

The architecture package is intended to contain:

```text
00-ARCHITECTURE-BASELINE.md
01-VISION.md
02-PRODUCT-REQUIREMENTS.md
03-INFORMATION-ARCHITECTURE.md
04-SYSTEM-ARCHITECTURE.md
05-DATABASE-ARCHITECTURE.md
06-EVIDENCE-TAXONOMY.md
07-OUTCOME-CLASSIFICATION.md
08-EVIDENCE-QUALITY.md
09-CRITICISM-FRAMEWORK.md
10-AI-ARCHITECTURE.md
11-DATA-IMPORT-ARCHITECTURE.md
12-ADMIN-ARCHITECTURE.md
13-COMMUNITY-ARCHITECTURE.md
14-SEARCH-ARCHITECTURE.md
15-UI-UX-SPECIFICATION.md
16-SECURITY.md
17-DATA-GOVERNANCE.md
18-OPEN-SOURCE-GOVERNANCE.md
19-DEPLOYMENT.md
20-TESTING.md
21-COST-CONTROL.md
22-ROADMAP.md
23-AI-AGENT-INSTRUCTIONS.md
```

Only documents that have actually been approved/drafted should be treated as authoritative.
