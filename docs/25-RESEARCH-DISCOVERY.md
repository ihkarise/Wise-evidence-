# WiseEvidence
## Automated Research Discovery

**Document:** `docs/25-RESEARCH-DISCOVERY.md`
**Version:** 0.1.0
**Status:** Delivered (Milestone 7)
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `11-DATA-IMPORT-ARCHITECTURE.md`, `05-DATABASE-ARCHITECTURE.md`, `12-ADMIN-ARCHITECTURE.md`, `16-SECURITY.md`, `ADR-017`

---

# 1. Purpose

Define the first controlled **automated research discovery** pipeline: how a
source connector proposes candidate research, how candidates are normalized,
deduplicated, reviewed by a human, and (on approval) turned into a draft via the
existing M3 workflow. Discovery is a **candidate-generation** mechanism only.

# 2. Core principle

```text
Discovery ≠ Classification
Discovery ≠ Publication
Discovery ≠ Scientific evaluation
```

A discovered paper is **candidate research** until a human reviews it. Discovery
never publishes, never sets a classification, never auto-invokes AI, and never
deletes or merges existing research.

# 3. Pipeline

```text
Source
  ↓  ResearchDiscoveryConnector.discover(criteria)   (bounded; network here)
Discovery result (raw records)
  ↓  normalize()  (reuses domain normalizeDoi; sanitizes; no fabrication)
Normalized record
  ↓  identifier strategy: DOI → source id (never manufacture a DOI)
  ↓  deduplicate by DOI (flag only; never delete/merge)
Import candidate  (import_candidate; REVIEW_REQUIRED | DUPLICATE_CANDIDATE)
  ↓  HUMAN REVIEW
  ├── Reject      → REJECTED   (auditable)
  ├── Duplicate   → DUPLICATE_CANDIDATE (auditable; links existing study)
  └── Approve     → createDraft()  →  research_study (IMPORTED) + publication (DRAFT)
                       ↓
                    M3 review workflow  →  (ADMIN) publish
                       ↓
                    optional, later: M6 AI suggestion → human review

                    ***  NO AUTO-PUBLISH  ***
```

# 4. Connector abstraction (`packages/discovery`)

Portable, framework-free, no DB access. `ResearchDiscoveryConnector`:

- `discover(criteria)` — "what research exists for this query?" (bounded results;
  network happens here). Returns raw records + an honest `malformed` count, or a
  typed error.
- `normalize(record)` — pure; sanitizes + canonicalizes into a candidate.

Two implementations ship: `MockDiscoveryConnector` (deterministic fixtures; the
CI/dev default) and `CrossrefDiscoveryConnector`. Discovery ("what exists we
haven't considered") is kept separate from the M3 metadata provider ("metadata
for this DOI"); they share only the domain DOI normalizer.

# 5. Source policy (first connector: Crossref)

Crossref was chosen for the first connector: a free, structured scholarly API
with stable DOIs, no key, a polite pool, and predictable JSON — already a trusted
host in M3. It is queried via the structured `works?query=…&rows=N` endpoint
(**not** HTML scraping). Retrieval is documented, respects rate limits, and does
not bypass authentication, paywalls, CAPTCHAs, or robots restrictions.

Selection is by server-only env `DISCOVERY_CONNECTOR` (`mock` default | `crossref`).

# 6. Normalization

DOIs **must** reuse `packages/domain` `normalizeDoi()` (never a second algorithm).
Strings are control-stripped/whitespace-collapsed/length-capped; URLs validated to
http(s); dates normalized to `YYYY` / `YYYY-MM` / `YYYY-MM-DD`. Missing values stay
null — nothing is fabricated. (When a candidate is approved, only a full
`YYYY-MM-DD` is written to the `date` column; a partial date is stored as null in
the draft but preserved in the candidate's raw payload.)

# 7. Deduplication (safety feature)

Order: DOI → source identifier → (human) review. A normalized DOI matching an
existing `research_identifier` flags the candidate `DUPLICATE_CANDIDATE` and links
the existing study; a within-batch repeated DOI is also flagged. **Never**
auto-delete, **never** auto-merge, **never** treat title similarity as identity.
The existing study is untouched. `Study ≠ Publication` is preserved — related
publications are not merged into one study automatically.

# 8. Data model (reuses M2)

- `import_job` — one discovery run: source, trigger (`CONNECTOR`), state, and
  honest counts (discovered / normalized / duplicate / candidate / imported /
  error), start/end (migration `0016` added the extra counts).
- `import_candidate` — raw + normalized payloads, dedup state, `source_record_id`,
  review fields (`reviewed_by`, `reviewed_at`, `review_reason`), and
  `imported_study_id` (the draft an approval produced) — migration `0016`.
- `import_state` gains `REJECTED` (migration `0015`).
- Approval creates provenance via `research_source` + `research_identifier` through
  the existing `createDraft`.

# 9. Human review

Reviewers (REVIEWER or ADMIN) see title, DOI, authors, journal, date, source id,
and any duplicate warning + link to the existing record. Actions: **Approve**
(→ draft), **Reject** (reason), **Mark duplicate** (optional existing-study link).
Nothing disappears silently; every decision is audited.

# 10. AI boundary

M7 does **not** call the AI provider. An approved candidate becomes a draft; a
human may later run M6 enrichment on that draft. `Discovery ≠ AI suggestion`, and
AI remains suggestion-only (ADR-016).

# 11. Security

External source data is untrusted (docs/16): sanitized, length-capped, never
rendered as HTML (no `set:html`; Astro escapes). The connector is **host-pinned**
to `api.crossref.org`, https-only, with a timeout, response-size cap, bounded
`rows`, and `redirect: 'error'` (no cross-host redirects). It never fetches
arbitrary URLs found in results — no SSRF surface, no localhost/private-IP/metadata
access. Endpoints are SSR + staff-gated by middleware; RLS is authoritative.

# 12. RLS

`import_job` / `import_candidate` are readable and writable only by reviewer/admin
(migration `0016`); anon has no grant at all. Approved drafts follow the existing
publication RLS — publication stays ADMIN-only and fail-closed. Authorization is
never solved by UI hiding.

# 13. Rate / volume control

One discovery request is bounded: `maxResults` is clamped to the connector cap and
a hard limit of 50. No unbounded pagination, no recursion, no crawling. There is
**no scheduler** in M7 — discovery is staff-triggered on demand (a scheduler is a
later, separately-authorized milestone).

# 14. Failure handling

Connector failure marks the job `FAILED` with the error preserved for staff; the
job reports honest partial counts (e.g. "discovered 63, normalized 60, duplicates
12, candidates 48, errors 3") — never "100 imported". Malformed source records are
counted, not hidden.

# 15. Testing

Deterministic, offline: connector normalization/limits/malformed/error paths
(`packages/discovery`), and integration + RLS on PGlite (`packages/database`) —
including the critical proofs that a discovered candidate cannot become PUBLISHED
without human approval → draft → workflow, that an existing DOI is identified
without deleting the study, and that anon cannot read jobs/candidates. Real
Crossref network verification is a documented pending gate (`docs/19` §11); the
mock connector is the CI default.

# 16. Future work (NOT in M7)

Scheduler/cron/recurring ingestion, additional source connectors, automatic AI
enrichment of discovered candidates, and batch/bulk historical ingestion are
out of scope and require their own authorization.
