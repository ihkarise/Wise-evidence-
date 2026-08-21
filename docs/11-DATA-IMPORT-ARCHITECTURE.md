# WiseEvidence
## Data Import Architecture

**Document:** `docs/11-DATA-IMPORT-ARCHITECTURE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `04-SYSTEM-ARCHITECTURE.md`, `05-DATABASE-ARCHITECTURE.md`, `16-SECURITY.md`, `17-DATA-GOVERNANCE.md`

---

# 1. Purpose

Define how research enters WiseEvidence: the import pipeline, connector
interface, deduplication, failure handling, and the **manual-first** rule.

# 2. Manual Before Automated (hard rule)

Do **not** begin with a large scraper (`00` §19, master prompt §11, §13). The
first working ingestion path is manual:

```text
Admin → DOI / URL → Metadata lookup → Research candidate
      → AI enrichment → Human review → Publish
```

Only after this works reliably are structured source connectors added
(Milestone 7+).

# 3. Import Pipeline

```text
Discovery → Fetch → Parse → Normalize → Validate → Deduplicate
          → Persist → Enrich → Review → Publish
```

Discovery creates **candidates**, never automatic publication (`04` §28).

# 4. Connector Interface

Every source uses a common interface so no connector invents its own data model
(master prompt §62):

```text
interface ResearchSourceConnector {
  discover(): Candidate[]      // find candidate records
  fetch(id): RawRecord         // retrieve one record's raw payload
  normalize(RawRecord): NormalizedResearchInput
}
```

`NormalizedResearchInput` is the single shape the research domain accepts. The
domain decides how normalized input becomes a canonical record — connectors do
not write canonical records directly (`04` §43).

Planned connectors (implemented incrementally, not all at once):
`ManualConnector` (first) · `CrossrefConnector` · `PubMedConnector` ·
`EuropePMCConnector` · `JournalConnector`.

# 5. Candidate Sources

Candidate sources (from `00` §12, master prompt §14) include PubMed/NCBI,
Crossref, Europe PMC, and homeopathy-specific organizations and repositories.
Named planning sources:

```text
researchinhomeopathy.org · ijrh.org · hri-research.org ·
facultyofhomeopathy.org · homeopathy.delhi.gov.in ·
homeopathyusa.org · ccrhindia.ayush.gov.in · aurumproject.org.au
```

These are **candidate** sources, not automatically trusted or scrapeable. Before
building any connector, verify: API availability, terms of use, robots rules,
rate limits, licensing, metadata quality, and stability (`04` §29, master prompt
§14). **Prefer official APIs / structured feeds over HTML scraping.** Source
inclusion is not endorsement of a source's claims (`00` §12).

# 6. Normalization

Convert source-specific data into the common model. Normalize DOI (`20` rules),
dates, author names, journal names, and external identifiers (`04` §30).

# 7. Deduplication

Priority order (`04` §31, `05` §11):

```text
DOI → PMID / persistent id → normalized title → author + year → similarity
```

Exact-identifier matches are caught by the unique constraint on
`ResearchIdentifier`. Weaker matches produce a `DUPLICATE_CANDIDATE` routed to
review. **Never auto-delete** a potentially distinct paper on fuzzy match alone.
Distinguish `ResearchStudy` from `Publication` to avoid double-counting multiple
publications of one trial (`05` §4, master prompt §60–61).

# 8. Import States

```text
DISCOVERED → FETCHING → FETCHED → NORMALIZED → DUPLICATE_CANDIDATE
          → IMPORTED → (FAILED | REVIEW_REQUIRED)
```

Failures must be **visible and diagnosable** (`04` §32, master prompt §65) — never
silently swallowed. Import failure must not affect existing published research
(`04` §46).

# 9. Copyright & Full Text

Do not automatically download or host research PDFs (`00` §13, master prompt §15,
§321). Store DOI, PMID, external identifiers, publisher/PubMed/open-access URLs,
permitted metadata/abstract, and license info. The original source stays
discoverable (`17`).

# 10. Untrusted Input

Fetched abstracts, article content, and scraped pages are untrusted input. They
are treated as data and defended against prompt injection in the AI pipeline
(`10` §12, `16`, master prompt §66).

# 11. Automated Import (later)

```text
Scheduler → Source Connector → Import Pipeline
```

The core system must work **without** scheduled imports (`04` §34). Automation
(GitHub Actions / Supabase scheduling / future Hermes) is additive; its failure
must not break the website, database, admin, or manual import (`04` §35–36,
master prompt §63–64).
