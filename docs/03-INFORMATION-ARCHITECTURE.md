# WiseEvidence
## Information Architecture

**Document:** `docs/03-INFORMATION-ARCHITECTURE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`

# 1. Core Information Model

```text
WiseEvidence
├── Research
├── Evidence
├── Conditions
├── Interventions
├── Authors
├── Journals
├── Criticism
├── Sources
├── Statistics
└── Methodology
```

# 2. Public Navigation

Initial navigation:

```text
Home
Research
Evidence
Conditions
Interventions
Criticism
Explore
About
```

Search should remain easily accessible.

# 3. Homepage

```text
HOME
├── Hero / Search
├── Evidence Overview
├── Evidence Pyramid
├── Outcome Distribution
├── Recent Research
├── Explore by Condition
├── Explore by Research Type
├── Criticism
├── Methodology
└── About
```

# 4. Research Explorer

Route:

`/research`

Contains:

- Search
- Filters
- Sort
- Results
- Pagination or infinite loading

# 5. Research Filters

- Study Type
- Evidence Level
- Outcome
- Year
- Condition
- Intervention
- Journal
- Country
- Source
- Quality

# 6. Research Result Card

Should show:

- Title
- Authors
- Year
- Journal
- Study Type
- Condition
- Outcome
- Evidence Level
- Short Summary
- DOI

Actions:

- View Research
- Copy DOI
- Open Source

# 7. Research Detail

Route:

`/research/:id`

Structure:

```text
Research Detail
├── Title
├── Authors
├── Publication Metadata
├── DOI
├── Source Links
├── Research Snapshot
├── Outcome
├── Confidence / Quality
├── What Did the Study Investigate?
├── Key Findings
├── AI Summary
├── Limitations
├── Criticism
├── Why This Classification?
├── Related Research
└── Source / Provenance
```

# 8. Evidence

Route:

`/evidence`

The Evidence Pyramid is a navigation system.

Possible levels:

- Meta-analysis
- Systematic Review
- RCT
- Controlled Trial
- Observational
- Case Series
- Case Report
- Other

# 9. Conditions

Route:

`/conditions`

Individual condition:

`/conditions/:slug`

May contain:

- Condition information
- Research count
- Study types
- Outcome distribution
- Evidence levels
- Research
- Related interventions
- Criticism

# 10. Interventions

Route:

`/interventions`

Individual intervention:

`/interventions/:slug`

May contain:

- Research count
- Conditions
- Study types
- Outcomes
- Evidence levels
- Research

# 11. Authors

Route:

`/authors`

Future individual pages:

`/authors/:slug`

May contain publications, study types, conditions and journals.

Do not create researcher reputation rankings by default.

# 12. Journals

Route:

`/journals`

Future:

`/journals/:slug`

# 13. Criticism

Route:

`/criticism`

Possible categories:

- Methodology
- Randomization
- Blinding
- Sample Size
- Statistics
- Publication Bias
- Replication
- Reporting
- Interpretation
- Generalizability
- Other

# 14. Explore

Route:

`/explore`

Directory:

```text
Evidence Level
Outcome
Condition
Intervention
Author
Journal
Country
Year
Source
```

# 15. Timeline

Future:

`/timeline`

A publication-history visualization, not a measure of scientific truth.

# 16. Statistics

Future:

`/statistics`

Possible statistics:

- Research records
- Publications by year
- Study types
- Conditions
- Countries
- Outcomes
- Evidence levels
- Quality

Definitions must be visible.

# 17. Methodology

Route:

`/methodology`

Explain:

- Data sources
- Classification
- AI
- Human review
- Outcome labels
- Quality
- Criticism
- Updates
- Corrections

# 18. About

Route:

`/about`

Explain:

- What WiseEvidence is
- Why it exists
- Open-source philosophy
- Contributors

# 19. Contribution

Future:

`/contribute`

Potential actions:

- Submit Research
- Report Error
- Suggest Correction
- Contribute Code
- Improve Documentation

# 20. Search

Global search should support:

- Disease
- Condition
- Medicine
- Title
- Author
- DOI
- Journal
- Keyword

If the query resembles a DOI, exact DOI matching should take priority.

# 21. URL Architecture

Initial public routes:

```text
/
 /research
 /research/:id
 /evidence
 /evidence/:slug
 /conditions
 /conditions/:slug
 /interventions
 /interventions/:slug
 /criticism
 /criticism/:slug
 /authors
 /authors/:slug
 /journals
 /journals/:slug
 /explore
 /timeline
 /statistics
 /methodology
 /about
 /contribute
```

Admin:

```text
/admin
/admin/review
/admin/research
/admin/imports
/admin/sources
/admin/taxonomy
/admin/ai
/admin/corrections
/admin/users
/admin/audit
```

# 22. Cross-Linking

Research should connect to:

- Condition
- Intervention
- Authors
- Journal
- Evidence Level
- Outcome
- Related research
- Original source

# 23. No Dead Ends

Important pages should provide useful next steps and related entities.

# 24. Mobile

Mobile navigation should prioritize:

- Search
- Research
- Explore
- Evidence
- Menu

Visualizations need mobile alternatives.

# 25. SEO

Public entities should have:

- Canonical URL
- Metadata
- Open Graph metadata
- Structured data where appropriate
- Sitemap inclusion

# 26. Information Hierarchy

```text
WiseEvidence
├── Research
│   └── Individual Research
├── Evidence
│   └── Evidence Level
├── Conditions
│   └── Condition
├── Interventions
│   └── Intervention
├── Criticism
│   └── Criticism Category
├── People
│   └── Author
├── Publications
│   └── Journal
└── System
    ├── Methodology
    ├── About
    └── Contribution
```

# 27. Primary Discovery Paths

Research-first:

`Home → Search → Research → Source`

Evidence-first:

`Home → Evidence → Study Type → Research`

Condition-first:

`Home → Conditions → Condition → Research`

Intervention-first:

`Home → Interventions → Intervention → Research`

Criticism-first:

`Home → Criticism → Category → Research`

# 28. Information Architecture Principle

The database may be complex.

The user interface should not feel complex.

Reveal complexity progressively:

```text
Simple overview
→ Structured details
→ Advanced filters
→ Methodology
→ Original source
```
