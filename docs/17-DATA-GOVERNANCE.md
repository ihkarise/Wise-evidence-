# WiseEvidence
## Data Governance

**Document:** `docs/17-DATA-GOVERNANCE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `05-DATABASE-ARCHITECTURE.md`, `11-DATA-IMPORT-ARCHITECTURE.md`, `16-SECURITY.md`, `18-OPEN-SOURCE-GOVERNANCE.md`

---

# 1. Purpose

Define how research data is owned, attributed, versioned, corrected, retained,
and licensed, and how AI-generated content is distinguished from human-reviewed
content.

# 2. Authoritative Store

PostgreSQL is authoritative for application state (`00` §data, `04` §13). JSON,
Markdown, scraper output, and AI output are never the canonical database. All
schema changes go through version-controlled migrations (`04` §45, `19`).

# 3. Provenance

Every canonical record is traceable (`05` §8): source, source URL, external id,
DOI, imported_at, updated_at, import method, review status, and transformation
history. Provenance is preserved even as records are corrected or re-reviewed.

# 4. Source Attribution

The original publication and its identifiers remain discoverable on every
published record (`15` §7, `11` §9). Source inclusion is not endorsement of the
source's claims (`00` §12).

# 5. Copyright & Full Text

Do not download or host research PDFs by default (`00` §13, `11` §9, master
prompt §15). Store DOI/PMID/URLs, permitted metadata/abstract, and license
information. Respect source terms, robots rules, rate limits, and licensing.

# 6. AI-Generated vs Human-Reviewed Content

- AI outputs are stored separately and labeled (`05` §9, `10` §11).
- Public records show human-reviewed final values; AI-only content is labeled
  "AI-assisted, pending review."
- AI summaries are labeled AI-assisted until reviewed (master prompt §47).
- Never fabricate abstracts, outcomes, or facts not supported by the source
  (master prompt §47).

# 7. Corrections & Versioning

Corrections preserve history: original value → correction → actor → reason →
timestamp (`05` §10, master prompt §52). Nothing canonical is silently
overwritten. Model/prompt version changes create new AI results, never overwrite
old ones (`10` §4).

# 8. Publication State & Visibility

Only `PUBLISHED` records are public (`05` §7). Drafts and pending records are not
publicly queryable (enforced by RLS, `16` §4).

# 9. Retention

Historical values, audit entries, and superseded AI results are retained for
traceability. Deletion of canonical research is an administrative, audited action
— never automatic, and never on fuzzy duplicate match (`11` §7).

# 10. Demo vs Real Data

Seed/fixture/demo studies are clearly labeled as demo data and never presented as
real research (master prompt §46, `20`, `22`). Real records preserve DOI, source,
identifiers, and publication metadata (master prompt §47).

# 11. Licensing (data)

Curated research data and metadata are published under **CC-BY-4.0** (attribution
required). Code is licensed separately under **Apache-2.0**. See
`18-OPEN-SOURCE-GOVERNANCE.md` and ADR-011. Third-party source metadata is used
only within the terms and licenses of that source.

# 12. Privacy

Collect the minimum necessary personal data (`57`, `16`). Analytics are
privacy-conscious and event-focused (`02`, master prompt §57).
