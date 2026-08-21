# WiseEvidence
## Product Requirements Document

**Document:** `docs/02-PRODUCT-REQUIREMENTS.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Vision:** `01-VISION.md`

# 1. Product Goal

The MVP must allow:

> An administrator to create and curate structured research records and a public user to discover, understand, filter, and access those records.

# 2. Primary User Journeys

## Discover Research

```text
User
→ Homepage
→ Search
→ Filters
→ Research Results
→ Research Detail
→ Original Source
```

## Browse by Evidence Type

```text
Homepage
→ Evidence Pyramid
→ Study Type
→ Research
→ Study
```

## Browse by Condition

```text
Conditions
→ Condition
→ Research
→ Study Type / Outcome
→ Study
```

## Review New Research

```text
Admin
→ Review Queue
→ AI Suggestions
→ Edit
→ Approve
→ Publish
```

## Add Research

```text
Admin
→ Add Research
→ DOI / URL
→ Metadata
→ AI Enrichment
→ Review
→ Publish
```

# 3. Mandatory MVP Requirements

The MVP must support:

- Research record creation
- DOI normalization
- External source links
- Structured metadata
- Study classification
- Evidence level
- Outcome classification
- Outcome explanation
- Confidence
- Evidence quality
- Criticism
- AI summary
- Human-reviewed summary
- AI classification suggestions
- AI run history
- Search
- Filters
- Sorting
- Evidence Pyramid
- Research detail pages
- Copy DOI
- Manual research addition
- Duplicate detection
- Review queue
- Quick review
- Audit trail
- Role-based access
- Provenance
- Responsive UI
- Accessibility basics
- Public methodology

# 4. Outcome Categories

Minimum public categories:

- Strong Positive
- Positive
- Mixed / Leaning Positive
- Neutral / Inconclusive
- Mixed / Leaning Negative
- Negative
- Strong Negative

# 5. AI Requirements

AI may suggest:

- Study type
- Condition
- Intervention
- Outcome
- Keywords
- Summary
- Potential criticism

AI suggestions must be stored separately from final human-reviewed values.

# 6. Search Requirements

Search fields:

- Title
- Abstract
- Author
- Journal
- DOI
- Condition
- Intervention
- Keywords

Filters:

- Study type
- Evidence level
- Outcome
- Year
- Condition
- Intervention
- Journal
- Country
- Source
- Quality

# 7. Review Queue

The review queue must support:

- New imports
- Low AI confidence
- Missing data
- Possible duplicates
- User corrections
- Classification disagreements

# 8. Quick Review

Prefer:

- Dropdowns
- Buttons
- Checkboxes
- `+ Add`
- Remove
- Save
- Approve
- Reject

# 9. Public Research Detail

Each published research record should expose:

- Title
- Authors
- Journal
- Date
- DOI
- Study type
- Evidence level
- Condition
- Intervention
- Outcome
- Confidence
- Quality
- Abstract where permitted
- Summary
- Limitations
- Criticism
- Source links
- Classification explanation

# 10. Community

Future users may:

- Bookmark
- Report errors
- Suggest corrections
- Submit DOI/URL
- Flag classification disagreements

Users must not directly overwrite canonical records.

# 11. Non-Functional Requirements

The system should be:

- Low cost
- Fast
- Reliable
- Provider-independent
- Maintainable
- Secure
- Observable
- Scalable from hundreds to tens of thousands of records
- Open-source friendly

# 12. Priority

## P0

- Research database
- Manual addition
- DOI
- Research detail
- Search
- Basic filters
- Study classification
- Outcome
- Admin review
- Provenance
- Basic AI summary
- GitHub
- Deployment
- Documentation

## P1

- Evidence Pyramid
- Criticism
- Evidence quality
- AI classification
- Duplicate detection
- Review queue
- Audit log
- Bulk import

## P2

- Community corrections
- Accounts
- Bookmarks
- Analytics
- Timeline
- Disease explorer
- Intervention explorer
- Research maps

## P3

- Semantic search
- AI research assistant
- Citation graph
- Hermes automation
- Public API
- Multilingual intelligence
- Advanced evidence synthesis

# 13. MVP Acceptance Criteria

Administrator can:

1. Create research.
2. Enter DOI.
3. Retrieve metadata.
4. Edit metadata.
5. Classify study type.
6. Classify outcome.
7. Add confidence/quality.
8. Review AI summary.
9. Publish.

Public user can:

1. Search.
2. Filter.
3. Open research.
4. Read summary.
5. See classification.
6. See source.
7. Copy DOI.
8. Open original publication.

# 14. Success Metrics

Track:

- Research records
- DOI completeness
- Metadata completeness
- Duplicate rate
- AI success rate
- Human override rate
- AI cost
- Review time
- Pending review count
- Search usage
- Research page views
- Source clicks
- DOI copies

Metrics must not be treated as evidence of scientific validity.
