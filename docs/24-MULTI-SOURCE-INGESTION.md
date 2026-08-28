# WiseEvidence
## Multi-Source Ingestion Architecture (Milestone 8 Design Checkpoint)

**Document:** `docs/24-MULTI-SOURCE-INGESTION.md`
**Version:** 0.1.0
**Status:** Design Checkpoint — **design-only, not yet implementable** (see §2)
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `04-SYSTEM-ARCHITECTURE.md`, `05-DATABASE-ARCHITECTURE.md`,
`11-DATA-IMPORT-ARCHITECTURE.md`, `16-SECURITY.md`, `17-DATA-GOVERNANCE.md`,
`20-TESTING.md`, `21-COST-CONTROL.md`, `22-ROADMAP.md`,
`docs/adr/ADR-007-manual-import-before-scraping.md`,
`docs/adr/ADR-012-multi-source-ingestion.md`

---

# 0. What this document is

This is the **Milestone 8 (M8) Design Checkpoint** for *Multi-Source Research
Ingestion & Ingestion Hardening* — Phase 8 ("Additional Sources") in
`22-ROADMAP.md`. It is the blueprint the implementation must follow when M8 is
built. It makes every architectural decision M8 requires **explicit** and records
the significant ones in `ADR-012`.

It is deliberately **documentation only**. No connector code, migration, or
application file is created by this checkpoint (see §2 for why).

---

# 1. Objective

Extend the controlled discovery pipeline from a single connector to a **registry
of multiple approved scholarly sources**, and make repeated ingestion **safe,
bounded, idempotent, observable, and conservative about duplicates** — without
weakening any credibility rule.

The target pipeline is unchanged in shape from `11` §3 and only gains breadth and
hardening:

```text
Source → Connector → Discover → Normalize → Identify → Deduplicate
       → ImportCandidate → Human review → createDraft() → M3/M6 workflow
```

There must be **no** path `Source → Published` and **no** path
`Source → Draft` that skips human review.

---

# 2. Precondition: M8 depends on Phases 1–7, which do not yet exist

**Repository reality at the time of this checkpoint (verified, not assumed):** the
repository is documentation-only. There is no `package.json`, no `apps/web`, no
`packages/*`, no `supabase/migrations`, and no connector/discovery/metadata code.
`git ls-files` returns 43 tracked files, all Markdown. `22-ROADMAP.md` marks
**Phase 0 as current**.

M8 (Phase 8) builds directly on artifacts that Phases 1–7 are responsible for
creating:

| M8 needs | Delivered by | Exists today |
|----------|--------------|--------------|
| `packages/*`, build/test/CI, env config | Phase 1 (Repository Foundation) | No |
| `ImportJob` / `ImportCandidate` / `ResearchSource` / `ResearchIdentifier` tables, RLS, migrations | Phase 2 (Database Foundation) | No |
| `createDraft()`, review queue, publish workflow, audit | Phase 3 (Manual Research MVP) | No |
| `ResearchSourceConnector` interface, first connector, dedup, normalization | Phase 7 (Automated Discovery) | No |
| `MockAIProvider`, AI provenance (used only downstream of review) | Phase 6 (AI Enrichment) | No |

Therefore this checkpoint is a **design artifact**, not a buildable milestone.
Implementing connector code now would require silently inventing Phases 1–7 —
which `CLAUDE.md` §2 and the master prompt forbid, and which the current
authorization ("M8 only") does not cover.

**Consequence:** the code-level acceptance criteria in this document
(`pnpm test`, `pnpm typecheck`, `pnpm build`, live-source verification) are all
marked **PENDING — blocked on Phases 1–7**. They become executable only once the
foundation exists. Nothing here may be reported as "passing" until then.

---

# 3. Principles preserved (non-negotiable)

```text
Discovery      ≠ Research
Candidate      ≠ Draft
Draft          ≠ Published
Discovery      ≠ Classification
AI             ≠ Authority
Duplicate      ≠ Delete
Study          ≠ Publication
Source         ≠ Truth
```

Ingestion only ever produces **ImportCandidates**. It never classifies outcome or
quality, never invokes production AI, never merges or deletes records, and never
publishes.

---

# 4. Decision 1 — Which additional sources to implement now

M8 adds **two** structured scholarly sources on top of the Phase-7 first
connector, plus keeps the existing manual path. Chosen for open APIs, strong
identifier coverage, permissive terms, and direct relevance to homeopathy
research metadata.

| # | Source | Retrieval mechanism | Why appropriate now |
|---|--------|--------------------|---------------------|
| C0 | **Manual** (`ManualConnector`) | Admin DOI/URL entry (existing) | Baseline; always available; no network. |
| C1 | **Crossref** (`CrossrefConnector`) | REST JSON API (`api.crossref.org`) | Free, open, no key; DOI is the primary dedup key; broad journal coverage; polite-pool via `mailto`. Assumed first connector from Phase 7; hardened here. |
| C2 | **Europe PMC** (`EuropePMCConnector`) | REST JSON API (`www.ebi.ac.uk/europepmc`) | Free, open, no key; supplies PMID/PMCID/DOI + abstracts under clear terms; strong life-sciences and CAM coverage. |
| C3 | **PubMed / NCBI E-utilities** (`PubMedConnector`) | E-utilities REST (`eutils.ncbi.nlm.nih.gov`) | Free; authoritative PMID space; MeSH terms aid later (not M8) classification. Rate limits are stricter (§10), so it is the lowest-priority of the three and may ship behind C1/C2 if time-boxed. |

**Not added in M8:** the homeopathy-org candidate list in `11` §5
(`researchinhomeopathy.org`, `ijrh.org`, `hri-research.org`, etc.). Those have no
confirmed structured API and would require HTML scraping — explicitly out of
scope (§18). They remain *candidate* sources pending an API/terms review in a
later milestone.

Priority order for implementation: **C1 Crossref → C2 Europe PMC → C3 PubMed**.
Each is independently shippable; a source that cannot be finished cleanly is
deferred rather than half-built.

---

# 5. Decision 2 — Why each source is appropriate

- **Crossref** — canonical DOI registry; DOI is dedup priority #1 (`05` §11).
  Open API, no auth, generous polite pool. Metadata is bibliographic (title,
  authors, journal, dates, type, license), not full text — aligns with the
  no-PDF rule (`11` §9).
- **Europe PMC** — cross-links DOI↔PMID↔PMCID, which strengthens conservative
  dedup; abstracts are provided under stated terms and treated as untrusted data
  (`16` §8). Good coverage of complementary-medicine journals.
- **PubMed/NCBI** — authoritative PMID assignment and MeSH indexing; useful as a
  corroborating identifier source. Lower priority only because its rate limits and
  two-step esearch→efetch flow add operational cost.

All three expose **metadata**, satisfying "prefer structured APIs; do not host
PDFs; source inclusion ≠ endorsement" (`11` §5, §9; `00` §12).

---

# 6. Decision 3 — API / feed / mechanism per source

| Source | Mechanism | Format | Auth | Host(s) (allowlist) |
|--------|-----------|--------|------|---------------------|
| Manual | direct admin entry | n/a | session | none (no outbound) |
| Crossref | REST API | JSON | none (polite `mailto`) | `api.crossref.org` |
| Europe PMC | REST API | JSON | none | `www.ebi.ac.uk` |
| PubMed | E-utilities REST | JSON (retmode=json) / XML efetch | optional NCBI key (not required; not committed) | `eutils.ncbi.nlm.nih.gov` |

No RSS/Atom feeds and no HTML scraping are used. Every mechanism is a documented,
structured API over **HTTPS only**.

---

# 7. Decision 4 — Source terms, rate limits, politeness

Each connector carries these as declared config (§8), enforced by the shared
runtime, never hard-coded ad hoc:

| Source | Rate posture | Politeness | Notes |
|--------|-------------|-----------|-------|
| Crossref | ≤ ~1 req/s sustained; use polite pool | send `User-Agent` + `mailto` (from env, not committed) | Respect `X-Rate-Limit-*` headers; back off on 429. |
| Europe PMC | modest; page size ≤ 100 | descriptive `User-Agent` | Cursor-based paging (`cursorMark`). |
| PubMed | 3 req/s without key, higher with key | descriptive `User-Agent`; `tool` + `mailto` params | Two-step esearch→efetch; batch efetch. |

Global caps regardless of source (§13): per-run request budget, per-run candidate
cap, wall-clock timeout. The polite `mailto`/contact string is an **environment
value**, never committed (`16` §5).

---

# 8. Decision 5 — Source registry design

A **source registry** replaces the implicit single-connector assumption. Two
layers:

**8.1 Static connector descriptor (code).** Each connector ships an immutable
descriptor validated at startup:

```text
SourceDescriptor {
  key            // stable slug, e.g. "crossref"  (PRIMARY source identity)
  displayName
  retrievalMethod// api | feed | manual   (feed/scrape are rejected in M8 except manual)
  hostAllowlist  // exact hosts permitted for outbound fetch
  requiresHttps  // always true for networked sources
  timeoutMs      // per-request
  maxResponseBytes
  maxCandidatesPerRun
  maxRequestsPerRun
  rateLimitPerSec
  identifierTypes// which ResearchIdentifier types it can emit (DOI/PMID/PMCID/…)
  termsUrl       // human reference to source terms
}
```

**8.2 Operational source row (database).** A `source` (or reuse/extend
`ResearchSource` per `05` §5) registry row holds mutable operational state:
`key`, `enabled`, `health_status`, `last_run_at`, `last_success_at`,
`consecutive_failures`, `checkpoint` (§10), `created_at`, `updated_at`. This is
the admin-controllable record (§16) and the health/status surface.

Registry rules:
- A connector is invoked **only** if its descriptor validates *and* its registry
  row is `enabled`.
- Outbound fetch is refused if the target host is not in `hostAllowlist` or the
  scheme is not HTTPS (SSRF control, `16` §10).
- The registry is the single lookup point; no connector is reachable except
  through it.

---

# 9. Decision 6 — Incremental ingestion design

Ingestion is **incremental by default**: each run fetches only what is new/changed
since the last successful run for that source, bounded by a window.

- Each source keeps a **checkpoint/cursor** (§10) describing "how far we got."
- A run reads the checkpoint, requests the next bounded window (e.g. by
  `from-index-date`/`until` for Crossref, `cursorMark` for Europe PMC,
  `mindate/maxdate` + history for PubMed), and advances the checkpoint **only on
  successful, fully-processed pages**.
- A run is always **bounded** (§13): it stops at the candidate cap, request
  budget, or timeout, whichever comes first, and persists a resumable checkpoint
  so the next run continues rather than restarting.
- A full "backfill" is just an incremental run with a wider window and the same
  caps, executed over multiple runs.

---

# 10. Decision 7 — Idempotency & checkpoint/cursor strategy

**Goal:** running the same source ingestion twice must not create uncontrolled
duplicate candidates and must not lose or silently overwrite prior discovery
information (repeatability requirement).

**Checkpoint model.** Per source registry row:

```text
checkpoint {
  cursor          // opaque, source-specific (date watermark | cursorMark | history token)
  last_item_key   // last stable source id processed
  updated_at
}
```

Checkpoints advance transactionally with candidate persistence, so a crash
mid-run leaves a consistent, resumable position.

**Idempotency keys.** Every discovered item yields a deterministic
`ingest_key = (source_key, stable_source_id)` where `stable_source_id` is the
source's own stable identifier (Crossref DOI, PMID, PMCID, Europe PMC id). An
`ImportCandidate` is written under a **unique constraint on
`(source_key, stable_source_id)`**:

- First sighting → new `ImportCandidate` (state `DISCOVERED`).
- Re-sighting of an unchanged item → **no-op** (upsert that changes nothing;
  optionally bump `last_seen_at`), never a second candidate.
- Re-sighting with changed upstream metadata → recorded as a **new source
  observation / provenance event** on the existing candidate; prior discovery
  data is preserved, not overwritten (`05` §10, `17`).

This makes re-runs safe at the candidate layer *independently* of the research-
record dedup layer (§11), which is the second line of defense.

---

# 11. Decision 8 — Deduplication strategy (conservative, hardened)

Two layers, both conservative; **neither ever deletes or auto-merges**.

**11.1 Candidate-level (idempotency).** The `(source_key, stable_source_id)`
unique constraint (§10) prevents a source from re-emitting the same item as a new
candidate.

**11.2 Research-level (cross-source).** Before a candidate is promoted via review,
dedup runs in the fixed priority order (`05` §11, `11` §7):

```text
1. DOI (canonical)
2. stable source id / PMID / PMCID / other validated persistent id
3. normalized title           ── weak signal → review only
4. author + year              ── weak signal → review only
5. similarity (title/abstract)── weak signal → review only
```

- **Exact-identifier match** (steps 1–2) is caught by the unique constraint on
  `ResearchIdentifier(type, value_canonical)` and links the candidate to the
  existing study as a **new observation/publication**, not a new study
  (`Study ≠ Publication`).
- **Weak matches** (steps 3–5) produce a `DUPLICATE_CANDIDATE` state routed to
  **human review** with the match reason attached. They are **never** auto-merged
  and **never** deleted (`Duplicate ≠ Delete`).
- Similarity is a *signal that requests review*, not a merge trigger. Title
  similarity alone never merges studies.
- Multi-publication / multi-study separation is explicit: a preprint + journal
  version of one trial link to one `ResearchStudy` as two `Publication`s, not two
  studies.

Hardening over Phase 7: dedup now runs **across sources** (a DOI seen via Crossref
and via Europe PMC resolves to the same study), and the match reason + matched
identifier are persisted on the candidate for reviewer transparency.

---

# 12. Decision 9 — Required database migrations (design; authored in implementation)

All schema changes are version-controlled migrations (`05` §1, ADR-002); none are
created by this checkpoint. The migrations M8 will need:

1. **`source` registry / extend `ResearchSource`** — operational columns:
   `key` (unique), `enabled`, `health_status`, `last_run_at`, `last_success_at`,
   `consecutive_failures`, `checkpoint` (jsonb), timestamps.
2. **`import_candidate` hardening** — add `source_key`, `stable_source_id`,
   `ingest_key`, `last_seen_at`, `dedup_reason`, `duplicate_of` (nullable);
   **unique `(source_key, stable_source_id)`**.
3. **`import_job` operational columns** — `source_key`, `trigger`
   (`manual|scheduled`; M8 uses manual/on-demand only), `state`, counts
   (`discovered`, `new_candidates`, `duplicates`, `errors`), `started_at`,
   `ended_at`, `error_summary`, `request_count`.
4. **`import_source_observation`** (provenance) — append-only record of each time
   a candidate was seen from a source, with fetched-at, raw-payload hash, and
   transformation notes (`05` §10, `17`).
5. **Indexes** — `import_candidate(source_key, stable_source_id)` unique;
   `import_job(source_key, started_at)`; `source(key)` unique;
   `ResearchIdentifier(type, value_canonical)` unique (already required by `05`).
6. **RLS policies** (§13).

Each migration ships with a rollback and is tested (`20`).

---

# 13. Decision 10 — RLS & security changes

RLS extends the `05` §13 / `16` §4 posture to the new tables:

| Table | PUBLIC | REVIEWER / ADMIN |
|-------|--------|------------------|
| `source` registry | **no access** | read; write ADMIN-only |
| `import_job` | **no access** | read (REVIEWER); control ADMIN-only |
| `import_candidate` | **no access** | read/act (REVIEWER+) |
| `import_source_observation` | **no access** | read |
| published research | read `PUBLISHED` only (unchanged) | full |

- Candidates, jobs, sources, and observations are **never** publicly queryable —
  public users still see only `PUBLISHED` research. RLS is the enforcement
  boundary, not client hiding (`04` §15).
- Reviewers may act on candidates but receive **no database-admin privileges**;
  enabling/disabling sources and triggering runs is ADMIN-only (`16` §3).
- **SSRF controls (`16` §10):** outbound fetch restricted to `hostAllowlist`,
  HTTPS-only, internal ranges blocked, unexpected schemes rejected.
- **Untrusted content (`16` §8):** fetched abstracts/titles are data, never
  instructions; they carry no authority and are not passed to any production AI in
  M8. Instruction-like strings inside abstracts are inert.
- **Secrets:** the polite `mailto`/`tool` contact and any optional NCBI key are
  environment values, never committed, never exposed to client code.

---

# 14. Decision 11 — Failure, retry, backoff, timeout, bounded ingestion

Per-request controls (from the descriptor, §8):
- **Timeout** per request (`timeoutMs`); abort on exceed.
- **Response-size cap** (`maxResponseBytes`); abort oversize responses.
- **Retry with exponential backoff + jitter** on transient errors (network,
  5xx, 429) — bounded attempts (e.g. 3), honoring `Retry-After`.
- **No retry** on 4xx (except 429) — treat as a recorded, non-fatal item error.

Per-run controls (bounded ingestion, §9):
- `maxRequestsPerRun`, `maxCandidatesPerRun`, and a wall-clock budget. The run
  stops at the first cap hit and checkpoints for resume.

Error handling posture (`11` §8, `16` §12): failures are **visible and
diagnosable**, recorded on `import_job.error_summary` and per-item error detail;
**never silently swallowed**. An import failure never affects existing published
research (`04` §46). One malformed item fails that item, not the whole run.

---

# 15. Decision 12 — Testing strategy (deterministic, offline)

All tests are deterministic and run in CI with **no live network** — network
clients are **injected** and backed by **fixtures** (`20` §4). Live source calls
are never required to pass CI.

Coverage required (per connector unless noted):
- happy-path discover + normalize → correct `NormalizedResearchInput`
- **malformed** response (bad JSON, missing fields) → item error, run survives
- **empty** response → zero candidates, clean job
- **source failure** (5xx) → retry/backoff then recorded failure
- **timeout** → aborted request, recorded, run bounded
- **rate limit** (429 + `Retry-After`) → honored backoff
- **retry** behavior (transient then success)
- **pagination bounds** → stops at `maxCandidatesPerRun`/`maxRequestsPerRun`
- **incremental** run → checkpoint advances correctly
- **repeated** run (idempotency) → no duplicate candidates on re-run
- **DOI dedup** and **source-id dedup** → link, not duplicate
- **duplicate candidate** (weak match) → routed to review, not merged/deleted
- **multi-publication / multi-study** separation
- **provenance** written; **audit** entries created
- **RLS / authorization** → public cannot read candidates/jobs/sources;
  reviewer cannot admin-control sources
- **no-auto-publish / no-auto-draft** → ingestion never yields Draft/Published
- **SSRF** → non-allowlisted host / non-HTTPS refused
- **security boundary** → untrusted abstract text never treated as instruction

Existing tests are preserved; nothing is weakened or deleted to obtain green.

---

# 16. Decision 13 — Admin UI changes

Under `/admin/imports` and `/admin/sources` (`03` route map), additive only:
- **Sources list**: each registered source with `enabled` toggle (ADMIN),
  `health_status`, `last_run_at`, `last_success_at`, `consecutive_failures`.
- **Run source** (ADMIN): trigger a single bounded, on-demand incremental run.
  No scheduling UI in M8 (§17).
- **Import jobs list**: per-run state, counts (discovered / new / duplicates /
  errors), duration, error summary — operational visibility.
- **Candidate review**: existing review surface gains dedup reason + matched
  identifier + source provenance, with the existing dropdown/approve/reject
  controls. Reviewers act via controls, never by editing raw rows (`12`).

All admin surfaces are behind auth + RLS; nothing here is public.

---

# 17. Decision 16 — Scheduler / worker boundary (deferred) & what stays outside M8

**M8 makes ingestion *safe to run repeatedly on demand*; it does NOT build a
production scheduler/worker system.** Runs are triggered manually by an ADMIN (UI
button or an admin-invoked task). The checkpoint/idempotency design (§9–§10) is
precisely what makes a future scheduler safe, but the scheduler itself —
recurring triggers, queues, workers, concurrency control — is **deferred to a
later milestone** and must be additive and failure-isolated (`04` §34–36,
`11` §11, ADR-007). This boundary is recorded in `ADR-012`.

---

# 18. Decision 14–15 — Security & cost implications (summary)

**Security (Decision 14):** HTTPS-only + host allowlist + SSRF blocks; RLS keeps
candidates/jobs/sources private; untrusted abstracts are inert data; no secrets
committed; no client exposure of any key; append-only audit + provenance. No new
attack surface is public.

**Cost (Decision 15):** all three sources are **free, keyless** public APIs;
PostgreSQL/Supabase only, no new infrastructure. No vector DB, embeddings,
Elasticsearch, Redis, paid scraping, or browser automation. No production AI
calls (MockAIProvider remains sufficient; `21` §4). CI stays offline via
fixtures — zero external spend to develop or test. Free-first / cheap-second is
preserved (`21` §1).

---

# 19. Hard boundaries — explicitly NOT in M8

Not built, not designed-in, not stubbed:
automatic publication · automatic scientific classification · automatic AI
enrichment · community voting · vector database · embeddings · Elasticsearch ·
Redis · paid scraping services · CAPTCHA bypass · paywall bypass · arbitrary
website crawling · unrestricted scraping · browser automation · production
OpenRouter calls · a production scheduler/worker · HTML scraping of the
homeopathy-org candidate list · any `Source → Draft` or `Source → Published`
path · M9 functionality.

---

# 20. Acceptance criteria & status

| Criterion | Status |
|-----------|--------|
| Design decisions (1–16) documented | **DONE** (this doc) |
| Significant decisions recorded as ADR | **DONE** (`ADR-012`) |
| Roadmap / manifest / ADR index updated | **DONE** |
| Connector code, migrations, tests | **PENDING — blocked on Phases 1–7** (§2) |
| `pnpm test` / `typecheck` / `lint` / `build` | **PENDING — no app to build yet** |
| Live-source verification | **PENDING — deferred; fixtures first** |

M8 **implementation** cannot start until Phases 1–7 exist. This checkpoint is the
authorization-ready design for that implementation.

---

# 21. Change log

- **0.1.0** — Initial M8 Design Checkpoint. Documentation-only; records the
  Phases 1–7 dependency and the full multi-source ingestion design.
