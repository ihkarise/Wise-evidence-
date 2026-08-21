# WiseEvidence
## System Architecture

**Document:** `docs/04-SYSTEM-ARCHITECTURE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`

# 1. Purpose

This document defines the technical architecture of WiseEvidence, including:

- System components
- Component boundaries
- Data flow
- Frontend architecture
- Backend architecture
- AI architecture
- Import architecture
- Authentication
- Administration
- Automation
- Deployment
- Security
- Failure handling

The detailed database schema belongs in `05-DATABASE-ARCHITECTURE.md`.

# 2. Architectural Objective

The architecture must provide:

1. Very low initial cost
2. Simple development
3. Clear component boundaries
4. Growth without premature complexity
5. Easy contribution by humans and AI agents

# 3. High-Level Architecture

```text
External Sources
      ↓
Import Pipeline
      ↓
Research Database
      ↓
┌──────────────┬───────────────┬──────────────┐
AI Pipeline    Admin Review    Search Layer
└──────────────┴───────────────┴──────────────┘
      ↓
Public Web / Admin
```

# 4. Architectural Style

Use a modular monolith with managed services.

Do not start with microservices.

# 5. Logical Modules

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

# 6. Initial Components

1. Public Web Application
2. Admin Area
3. API / Backend Layer
4. PostgreSQL Database
5. AI Service Layer
6. Import Layer
7. Authentication
8. Scheduled Automation
9. CI/CD

# 7. Frontend

Preferred:

- Astro
- React for interactive components
- Tailwind CSS or equivalent

Use a static-first approach with interactive islands where needed.

# 8. Frontend Responsibilities

- Public pages
- Research cards
- Research detail
- Search
- Filters
- Evidence visualizations
- Admin UI
- Accessibility
- SEO
- Navigation

Frontend must not contain privileged secrets or privileged business logic.

# 9. Rendering Strategy

Mostly static:

- About
- Methodology
- Evidence definitions
- Public research pages when appropriate

Dynamic:

- Search
- Admin
- User-specific features

Interactive islands:

- Search controls
- Filters
- Evidence pyramid
- Outcome visualization
- Copy DOI
- Admin controls

# 10. Public vs Admin

Public:

```text
Research
Evidence
Conditions
Interventions
Criticism
Methodology
```

Admin:

```text
Dashboard
Review
Research Editing
Imports
Sources
Taxonomy
AI
Audit
```

Authorization boundaries must remain separate.

# 11. Backend

Conceptual flow:

```text
Browser
→ Application/API
→ Business Logic
→ Database
```

Privileged operations must be server-side.

# 12. Supabase

Initial backend platform:

- PostgreSQL
- Auth
- Edge Functions where appropriate
- Storage only when justified

Do not introduce services that are not needed.

# 13. Database

PostgreSQL is authoritative for:

- Research
- Taxonomy
- Users
- Reviews
- AI runs
- Sources
- Imports
- Audit history
- Community data

# 14. Database Access

Public data should only expose published records.

Administrative operations require authentication and authorization.

# 15. Row-Level Security

Use PostgreSQL/Supabase Row-Level Security where appropriate.

Security must not depend on client-side hiding.

# 16. API Boundary

Prefer domain operations such as:

```text
getResearch()
searchResearch()
createResearch()
updateResearch()
publishResearch()
classifyResearch()
reviewResearch()
submitCorrection()
runAIEnrichment()
startImport()
```

Do not blindly create endpoints around every table.

# 17. Research Module

Responsible for:

- Research lifecycle
- Metadata
- Authors
- Journals
- Conditions
- Interventions
- Relationships
- Publication state

Must not directly contain AI-provider-specific code.

# 18. Taxonomy Module

Responsible for:

- Study types
- Evidence levels
- Conditions
- Interventions
- Criticism categories
- Tags
- Outcome categories
- Quality categories

# 19. Classification Module

Responsible for:

- Outcome
- Evidence level
- Quality
- Confidence
- Classification explanation
- Human overrides

Must preserve AI suggestion and final human result separately.

# 20. Provenance Module

Records:

- Source
- Source URL
- Import method
- Import timestamp
- External identifiers
- Verification timestamp
- Transformation history

# 21. Audit Module

Records:

- Actor
- Action
- Entity
- Field
- Before
- After
- Timestamp
- Reason where required

# 22. AI Service Layer

Conceptual interface:

```text
AIService
├── Extraction
├── Summarization
├── Classification
├── Tagging
├── Duplicate Detection
└── Comparison
```

# 23. AI Provider Abstraction

Do not couple application logic directly to one provider.

Conceptually:

```text
AIService
├── Provider A
├── Provider B
├── Provider C
└── Local Provider
```

The cheapest suitable model should be selected per task.

# 24. AI Processing

```text
Metadata
→ Abstract
→ Classification
→ Confidence
→ Escalate uncertain cases
→ Human review
```

# 25. AI Cache

Cache based on:

```text
research_id
operation
input_hash
model
prompt_version
```

Avoid repeated processing when nothing relevant changed.

# 26. AI Provenance

Record:

- Provider
- Model
- Prompt version
- Input hash
- Output
- Timestamp
- Status
- Confidence
- Cost information when available

# 27. Import Pipeline

```text
Discovery
→ Fetch
→ Normalize
→ Validate
→ Deduplicate
→ Persist
→ AI Enrichment
→ Review
```

# 28. Discovery

Potential mechanisms:

- PubMed
- Crossref
- Europe PMC
- Journal feeds
- Source APIs
- Structured pages
- Manual DOI/URL submission

Discovery creates candidates, not automatic publication.

# 29. Fetch

Respect:

- Rate limits
- Source policies
- Robots rules where applicable
- Licensing
- Terms of use
- Error handling

# 30. Normalize

Convert source-specific data into a common internal model.

Normalize:

- DOI
- Dates
- Author names
- Journal names
- Identifiers

# 31. Deduplicate

Priority:

```text
DOI
→ PMID / persistent identifier
→ Normalized title
→ Author + year
→ Similarity
```

Potential duplicates require review.

# 32. Import Failure

Track states such as:

```text
DISCOVERED
FETCHING
FETCHED
NORMALIZED
DUPLICATE_CANDIDATE
IMPORTED
FAILED
REVIEW_REQUIRED
```

Failures must be visible and diagnosable.

# 33. Manual Import

First ingestion workflow:

```text
DOI / URL
→ Metadata lookup
→ Research candidate
→ AI enrichment
→ Review
→ Publish
```

# 34. Automated Import

Later:

```text
Scheduler
→ Source Connector
→ Import Pipeline
```

The core system must work without scheduled imports.

# 35. Hermes

Hermes is a future external automation layer.

It may:

- Monitor sources
- Trigger discovery
- Trigger imports
- Trigger enrichment
- Notify administrators

Hermes must not own the canonical database.

# 36. Jobs

Future jobs may include:

- IMPORT
- AI_SUMMARY
- AI_CLASSIFICATION
- DUPLICATE_CHECK
- REINDEX
- SOURCE_SYNC

Long-running work should eventually use asynchronous processing.

# 37. Search

Initial search uses PostgreSQL.

Search:

- Title
- Abstract
- Authors
- Journal
- Conditions
- Interventions
- Keywords
- DOI

The application should call a search service abstraction.

# 38. Caching

Cache selectively:

- Public research pages
- Taxonomy
- Popular search results
- AI outputs

Do not over-engineer caching before measuring need.

# 39. Authentication

Authentication required for:

- Reviewers
- Administrators
- Future privileged contributors

Public browsing requires no login.

# 40. Authorization

Authentication asks:

> Who are you?

Authorization asks:

> What can you do?

Initial roles:

- PUBLIC
- REVIEWER
- ADMIN

Future roles may include:

- SENIOR_REVIEWER
- DATA_CURATOR
- SOURCE_MANAGER

# 41. Secrets

Never expose:

- Service-role keys
- AI provider secrets
- Database admin credentials
- Private source credentials

# 42. Deployment

Initial model:

```text
GitHub
→ GitHub Actions
→ Build/Test
→ Public Web
→ Supabase
→ PostgreSQL
```

# 43. Environments

Preferred:

- Development
- Staging
- Production

MVP may begin with Development + Production, but configuration should allow staging later.

# 44. CI

Pull requests should eventually run:

```text
Install
→ Lint
→ Type Check
→ Unit Tests
→ Integration Tests
→ Build
```

# 45. Database Migrations

All production schema changes must be version-controlled.

Do not rely solely on manual dashboard edits.

# 46. Failure Isolation

AI failure must not break research browsing.

Import failure must not break existing research.

Hermes failure must not break the core application.

Search problems should not make canonical research pages disappear.

# 47. Local Development

Provide:

- Mock AI provider
- Mock import source
- Seed database
- Test users
- Deterministic fixtures

Developers should be able to work without spending money on external AI.

# 48. Future Scaling

Only extract services when:

- Independent scaling is required
- Deployment independence is required
- Failure isolation is necessary
- A measurable bottleneck exists
- Team boundaries require it

Do not create microservices prematurely.

# 49. Core Architecture

```text
Users
 ↓
Astro Web
 ↓
Application Services
 ↓
Research / Search / Classification / Review / Provenance
 ↓
AI / Import / Auth
 ↓
Supabase
 ↓
PostgreSQL
```

External:

```text
PubMed
Crossref
Europe PMC
Journals
Research repositories
AI providers
GitHub
Hermes
```

# 50. Final System Principle

```text
DISCOVER
→ NORMALIZE
→ STRUCTURE
→ ENRICH
→ REVIEW
→ PUBLISH
→ EXPLORE
→ TRACE TO SOURCE
```

No component should bypass this integrity chain.

# 51. Status

This is the system-level technical direction.

It intentionally leaves the exact database schema, RLS policies, API contracts, prompts, connector implementations, UI component architecture, and deployment configuration to subsequent specifications.
