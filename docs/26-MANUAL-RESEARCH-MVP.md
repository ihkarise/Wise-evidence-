# WiseEvidence

## Manual Research MVP — Milestone 3 Design Checkpoint

**Document:** `docs/26-MANUAL-RESEARCH-MVP.md`
**Version:** 0.1.0
**Status:** Implemented (M3)
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `05-DATABASE-ARCHITECTURE.md`, `07-OUTCOME-CLASSIFICATION.md`,
`08-EVIDENCE-QUALITY.md`, `09-CRITICISM-FRAMEWORK.md`, `11-DATA-IMPORT-ARCHITECTURE.md`,
`12-ADMIN-ARCHITECTURE.md`, `16-SECURITY.md`, `19-DEPLOYMENT.md`, `20-TESTING.md`,
`25-DATABASE-FOUNDATION.md`, `ADR-003`, `ADR-004`, `ADR-006`, `ADR-013`, `ADR-014`

---

# 0. Purpose and scope

This is the design checkpoint for **Milestone 3 — Manual Research MVP**, the
first complete, entirely human-controlled research lifecycle:

```text
Authentication → DOI/URL input → DOI normalization → metadata retrieval →
duplicate detection → create DRAFT → human editing → structured classification →
criticism → submit for review → reviewer/admin workflow → ADMIN approval →
PUBLISHED → public research detail page
```

**Nothing auto-publishes.** M3 introduces **no AI**, **no scraping**, **no
search**, **no evidence visualization**, and **no automated discovery** — those
belong to later milestones (`22`). M3 builds strictly on the M2 schema
(`25`); it adds no second research model and no second classification model.

The M2 database intentionally made all mutation `service_role`-only and deferred
reviewer write flows to M3 (`25` §11). M3 supplies the missing pieces:
authentication, a server-side service layer, the reviewer/admin RLS write
policies, a Crossref/mock metadata provider, the admin editor + review/publish
workflow, and the public research detail page.

---

# 1. Authentication architecture

- **Provider:** Supabase Auth (`ADR-003`, `16` §2). M3 adds **no** custom
  password storage, identity system, or second auth provider.
- **Session transport:** `@supabase/ssr` cookie-based server sessions. Astro
  runs with the `@astrojs/node` adapter in `standalone` mode so protected pages
  and API routes execute server-side (`ADR-014`).
- **Cookies:** `httpOnly`, `secure` (in production), `sameSite=lax`. The browser
  never receives the service-role key, privileged DB credentials, or any
  server-only secret.
- **Two Supabase clients, never mixed:**
  - a **request-scoped SSR client** built from the anon key + the request's auth
    cookies — used for the authenticated user's own reads/writes, always subject
    to RLS;
  - a **service-role client** constructed only in server code from
    `SUPABASE_SERVICE_ROLE_KEY` — used **only** by the publication path and
    other privileged server operations that must bypass RLS deliberately (see
    §13). It is never importable from client/island code.

# 2. Role resolution

The role is **never** taken from a client claim (master prompt §6). Resolution
is: Supabase Auth user (`auth.uid()`) → `app_user` row → `app_user.role`
(`PUBLIC | REVIEWER | ADMIN`).

- In the database, the M2 `SECURITY DEFINER` helpers `app.is_reviewer_or_admin()`
  and `app.is_admin()` read `app_user` by `auth.uid()` and are the authoritative
  role source for RLS (`0008`).
- In the server layer, a `resolveActor()` helper looks up the `app_user` row for
  the session user via the SSR client. A signed-in Supabase user with **no**
  `app_user` row is treated as non-staff (effective `PUBLIC`) — fail-closed.
- An `app_user` row is created/kept in sync by an admin-only provisioning step,
  **not** self-service. A user cannot self-promote: `app_user.role` is not
  writable by `authenticated` (no write policy grants it; see §10).

# 3. Middleware

A single Astro middleware (`apps/web/src/middleware.ts`) runs on every request:

1. Constructs the request-scoped SSR Supabase client and attaches it to
   `context.locals.supabase`.
2. Resolves the session user and their `app_user` role once, attaching
   `context.locals.user` and `context.locals.role`.
3. Enforces route protection (§8) as a **UX layer only** — it is not the
   security boundary.

Middleware never trusts a header or query param for identity; it derives
everything from the verified Supabase session cookie.

# 4. Authorization layers (defense in depth)

Authorization exists at **three** independent layers; the database is
authoritative (`16` §3–4):

1. **Database / RLS** — the real boundary. Reviewer/admin write policies and the
   publication guard live in SQL (`0010`). Even a compromised server cannot let
   `anon` mutate or a reviewer publish.
2. **Server service layer** — `packages/database` service functions re-check the
   actor's role and the lifecycle/publication invariants before every mutation,
   and route privileged publication through the service-role client with an
   explicit fail-closed guard (§13, §19).
3. **Route / middleware UX layer** — redirects/`401`/`403` so unauthorized users
   never see admin surfaces. Convenience, not enforcement.

# 5. Metadata-provider architecture

A new framework-independent package `packages/metadata` (`ADR-014`):

```ts
interface MetadataProvider {
  readonly name: string;
  fetchByDoi(doi: string): Promise<MetadataLookupResult>;
}
```

- `MetadataLookupResult` is a discriminated union
  (`{ ok: true; metadata } | { ok: false; reason }`) — never throws for the
  expected failure cases (`not-found`, `timeout`, `too-large`, `invalid`,
  `network`, `provider-error`).
- `NormalizedMetadata` is the single sanitized shape the editor consumes
  (title, authors, journal, publication date, abstract, canonical DOI, source
  URL). It mirrors, but is intentionally narrower than, the `11` §4
  `NormalizedResearchInput` — M3 only needs the manual DOI path.
- Providers:
  - `CrossrefMetadataProvider` — real logic against `api.crossref.org` (§11–12).
  - `MockMetadataProvider` — deterministic fixtures so the whole flow (and CI)
    runs with **no** network and **no** cost (`local dev` rule, `21`).
- The package imports **nothing** from Astro/React/Supabase/AI. DOI
  canonicalization is reused from `@wise-evidence/domain` (never duplicated).

# 6. DOI / URL handling

- Input accepted: a DOI in any form (`doi:…`, a `doi.org`/`dx.doi.org` URL, or a
  bare `10.xxxx/…`). This is exactly what `normalizeDoi()` already accepts.
- The server **normalizes first** via `@wise-evidence/domain`, then works only
  with the canonical DOI. Invalid input is rejected before any fetch.
- A "documented DOI URL" means a `doi.org` resolver URL — it is reduced to its
  DOI and treated as a DOI. M3 does **not** accept an arbitrary publisher URL
  and fetch it: the metadata endpoint is a **DOI lookup**, never a general URL
  fetcher (§12, SSRF defense `16` §7, §10).

# 7. Duplicate detection

Conservative, exact-first (`05` §11, `11` §7); nothing is auto-deleted or
auto-merged (master prompt §14):

1. **Exact canonical DOI** — look up `research_identifier` by
   `(type='DOI', value_canonical)`. The unique constraint already guarantees a
   DOI maps to at most one target. A hit → surface the existing study to the
   staff user; **do not** create a new record.
2. **Other stable identifiers** (PMID/PMCID) — same exact lookup when present.
3. **Normalized-title match** — informational only in M3: if the normalized
   title matches an existing study, the staff user is warned and may proceed
   (creating a distinct draft) or open the existing record. No silent merge.

Fuzzy similarity beyond normalized-title equality is **not** implemented in M3
(it belongs with the import pipeline, `11`/`24`).

# 8. Route protection map

```text
/admin/*        unauthenticated → 302 /admin/sign-in
                authenticated non-staff → 403
/api/admin/*    unauthenticated → 401 JSON
                authenticated non-staff → 403 JSON
/research/:id   public; SSR via the anon path so RLS is exercised
/admin/sign-in  public (the sign-in form itself)
```

# 9. Role model (M3 capabilities)

- **REVIEWER:** create drafts, edit drafts, set classifications, add/withdraw
  criticism, submit for review, and perform documented review actions
  (reject / request changes). A reviewer **cannot** publish and **cannot**
  change any `app_user.role`.
- **ADMIN:** all reviewer capabilities plus approve + publish, reject, and
  archive; and role/user administration.
- **PUBLIC:** read published research only; no mutation.

Forbidden, enforced in RLS and re-checked in the service layer:
reviewer → direct publication; reviewer → self-promotion to admin;
public/authenticated-non-staff → any mutation.

# 10. RLS strategy (migration 0010)

M2 shipped read-only RLS for `anon`/`authenticated` (`0008`). M3 adds the
**minimum** write policies for the reviewer workflow, without weakening public
isolation:

- **Grants:** `INSERT/UPDATE` (and `DELETE` only where withdrawal is modelled as
  status change, so generally not) granted to `authenticated` on the tables the
  reviewer workflow touches: `research_study`, `publication`,
  `publication_author`, `research_identifier`, `study_condition`,
  `study_intervention`, `study_tag`, `classification`,
  `evidence_quality_assessment`, `criticism`, plus supporting `author` /
  `journal` / `research_source` inserts.
- **`USING` / `WITH CHECK`:** every write policy requires
  `app.is_reviewer_or_admin()`. So a signed-in non-staff user still cannot
  mutate anything.
- **Publication is separately protected.** A new
  `app.can_transition_publication(old_state, new_state)` guard trigger on
  `research_study` enforces the allowed state machine and **forbids any
  transition into `PUBLISHED` unless the acting role is `ADMIN`** and the record
  is not demo. Reviewers may move `DRAFT → PENDING_REVIEW`,
  `PENDING_REVIEW → DRAFT` (request changes), and `→ REJECTED`; only `ADMIN` may
  set `PUBLISHED` or `ARCHIVED`. This holds even though `authenticated` has an
  `UPDATE` grant — the trigger is the gate, so the reviewer→publish path is
  closed in the database itself.
- **`app_user` stays locked.** No write policy is granted on `app_user` to
  `authenticated`; role changes remain a `service_role` (admin server) operation
  — a reviewer cannot self-promote.
- **`audit_log` / `ai_result` remain append-only** (M2 triggers unchanged);
  audit inserts happen via the privileged server path.
- **Demo protection preserved:** the publish guard rejects `is_demo = true`
  records (§20), so demo fixtures can never become published production
  research.

Tested: anon cannot mutate; authenticated non-staff cannot mutate; reviewer can
perform permitted operations; reviewer cannot publish; admin can publish; demo
cannot publish (§17, §25 of the master prompt / `20`).

# 11. Metadata provider — Crossref

- Endpoint: `GET https://api.crossref.org/works/{doi}` (no API key).
- Server-side only; called from the service layer / API route, never the browser.
- A descriptive `User-Agent` with a contact mailto is sent (Crossref etiquette).

# 12. Crossref security

The Crossref fetch is deliberately **not** a general fetcher:

- **HTTPS only**, **host-pinned** to exactly `api.crossref.org` (the URL is
  built from the normalized DOI; the DOI is never used to choose a host).
- **Timeout-bounded** via `AbortController` (default ~8s).
- **Response-size bounded** — the body is read through a cap (default ~1 MB);
  oversized responses are rejected as `too-large` rather than buffered without
  limit.
- **Redirects constrained** (`redirect: "error"` / manual) so a crafted response
  cannot bounce the fetch to an internal host (SSRF, `16` §10).
- Crossref output is treated as **UNTRUSTED** (`16` §8): every field is
  validated and sanitized before use — strings length-capped, control
  characters stripped, arrays bounded, the returned DOI re-normalized and
  required to match the requested DOI, any URL required to be `http(s)`. Provider
  HTML is never rendered; text is inserted as text only.
- External metadata is **never** authoritative for classification — it prefills
  bibliographic identity fields only; human editing is authoritative
  (`10` §11, master prompt §16).

# 13. Research creation flow

```text
staff enters DOI/URL
  → normalizeDoi() (domain)           reject invalid before any I/O
  → dedup lookup (exact DOI/id)       hit → show existing; stop
  → metadata provider fetchByDoi()    sanitized NormalizedMetadata (or a clear failure)
  → prefilled editor (DRAFT)          human reviews/edits everything
  → persist research_study (+ publication, identifier, authors)
                                      lifecycle=IMPORTED/PROCESSING, publication_state=DRAFT
```

Metadata failure never blocks creation — the staff user can create a draft and
fill fields by hand. No step publishes.

# 14. Editor architecture

A server-rendered admin editor (`/admin/research/:id`) mapping **directly** onto
the M2 schema, with structured controls only (never raw rows, `12` §2). Sections:

- **Identity** → `research_study` / `publication` / `research_identifier` /
  `publication_author` / `journal` / `research_source`.
- **Study** → `research_study.study_type_id`, subject, `study_condition`,
  `study_intervention`, and the `EVIDENCE_LEVEL` classification.
- **Outcome** → `classification (dimension=OUTCOME)` + its `confidence`.
- **Quality** → `evidence_quality_assessment` rows and/or the `QUALITY`
  classification summary.
- **Criticism** → `criticism` rows (category, origin, text).
- **Summary** → a human-authored summary (see §17 of this doc).
- **Provenance** → `research_source`, DOI/URL identifiers.
- **Status** → `lifecycle_state`, `publication_state` (read-mostly; changed via
  workflow buttons, not a free dropdown into `PUBLISHED`).

Writes go through API routes → service functions → `packages/database`; the
Astro pages contain no SQL.

# 15. Classification workflow (the credibility core)

`OUTCOME`, `QUALITY`, `CONFIDENCE`, and `CRITICISM` are **independent** and are
never collapsed (`00` §4, `07`, `08`, `09`). M3 stores each in its own
row/table exactly as M2 defined:

- **Outcome** = the reported result (`classification.dimension='OUTCOME'`,
  `final_value ∈ outcome_value`). Stored enum; public label is presentation.
- **Quality** = methodological rigor (`evidence_quality_assessment` per-dimension
  and/or a coarse `QUALITY` summary classification).
- **Confidence** = confidence in the classification (`classification.confidence`),
  independent of the value.
- **Criticism** = a separate object (`criticism` rows).

There is **NO** efficacy score, **NO** combined evidence score, **NO**
positive-minus-negative number, **NO** hidden weighting, **NO** effectiveness
percentage — anywhere in schema, service layer, or UI. `final_value` is set only
by a human (`ADR-006`); M3 writes no AI suggestions.

# 16. Criticism workflow

Criticism is added as independent `criticism` rows (category + origin + text +
optional source reference/URL). Adding, withdrawing (status → `WITHDRAWN`), or
superseding criticism **never** mutates any outcome value. Withdrawn/superseded
rows are retained, not deleted (`09` §5). Origin is always recorded so
author-reported vs reviewer-assessed vs external criticism stays distinguishable.

# 17. Human summary

The summary is **human-authored**. M3 introduces no AI summarization, calls no
OpenRouter, calls no AI provider (master prompt §17). The long-term AI design
(`10`) remains future work.

# 18. Review workflow

```text
DRAFT → PENDING_REVIEW → PUBLISHED
             ↓
          REJECTED / (back to DRAFT on request-changes)
PUBLISHED/any → ARCHIVED (admin)
```

- **Reviewer:** create, edit, classify, add criticism, `submit` (DRAFT →
  PENDING_REVIEW), `reject` / `request changes`.
- **Admin:** `approveAndPublish` (PENDING_REVIEW → PUBLISHED), `reject`,
  `archive`.

Every transition writes a `review` row and an `audit_log` entry (§21). No
auto-publish.

# 19. Publication workflow (fail-closed)

`approveAndPublish()` runs in a single transaction and **aborts entirely** unless
**all** required conditions hold (master prompt §19, `12` §9):

- the study exists and is not `is_demo`;
- current `lifecycle_state`/`publication_state` is a legal pre-publish state
  (`PENDING_REVIEW` / not already published/archived/rejected);
- the acting actor is an authenticated **ADMIN**;
- required **provenance** exists (a `research_source` and/or identifier);
- at least one required **identifier** exists (or the record is explicitly
  flagged missing-DOI by a human — mirrors the M2 missing-DOI case);
- a required **outcome classification** with a human `final_value` exists;
- required canonical data (a primary publication with a title) exists.

Any failure → the transaction rolls back, no partial publication, and a clear
error is surfaced (never swallowed, `16` §12). This is enforced in the service
layer **and** backstopped by the database publish-guard trigger (§10) — UI
validation is never the gate.

# 20. Demo data protection

Demo fixtures (`is_demo = true`, `[DEMO]` titles, reserved `10.0000/…` DOIs)
must never become published production research (`17` §10). The publish guard —
both the service check and the `research_study` publish trigger — explicitly
rejects `is_demo = true`. A test proves a demo record cannot be published.

# 21. Audit architecture

Meaningful changes write an append-only `audit_log` row (`05` §10, `12` §13):
create, classification change, submit, approve, publish, reject, archive. Each
records actor, action, entity, entity_id, before, after, reason. A `review` row
additionally captures before/after snapshots for review decisions. Audit is
staff-only (RLS), never public, and append-only (M2 trigger). Audit writes use
the privileged server path so they succeed even under restrictive write RLS.

# 22. Public research detail page

`/research/[id]` (SSR) shows a **published** study only, read via the **anon**
Supabase path so production RLS is genuinely exercised (a draft/rejected/archived
id returns 404). It renders: title, authors, journal, date, DOI (with the
existing copy control), source link, study type, evidence level, reported
outcome, quality, confidence, conditions, interventions, criticism, the
human summary, and provenance.

Outcome, quality, confidence, and criticism are kept **visually and semantically
separate**. The page explicitly states these are **structured interpretations,
not proof of efficacy**. No private field, no audit data, no AI-only suggestion,
and no internal-only id detail is exposed. DOI normalization/copy reuses the
existing island.

# 23. Security model (summary)

- Supabase Auth; `httpOnly` cookie sessions; no privileged secret in the browser.
- RLS is the boundary; server service layer re-authorizes; middleware is UX.
- Crossref fetch is host-pinned, timeout/size-bounded, redirect-constrained, and
  its output sanitized (SSRF + untrusted-content defense).
- Input validation on every admin form and DOI entry.
- No committed secrets, no `.env`, no service-role key in client code, no AI key.
- Publication and role changes are separately, more strongly protected.

# 24. Test strategy

Deterministic, no network, no cost, building on the M2 PGlite + Supabase shim
harness (`ADR-013`, `20`):

- **Domain:** existing DOI tests preserved.
- **Metadata:** success, malformed response, 404/not-found, timeout, oversized
  response, invalid metadata, sanitization (control-char strip, length cap,
  DOI-mismatch rejection, non-http URL rejection) — via an injected fake fetch,
  never a real network call.
- **Database / workflow:** create draft, edit, classify, criticism, submit,
  reject, approve, publish, archive — through the service layer against PGlite.
- **Security / RLS:** anon cannot see drafts; anon cannot mutate; authenticated
  non-staff cannot mutate; reviewer can perform permitted ops; reviewer cannot
  publish; reviewer cannot self-promote; admin can publish; demo cannot publish;
  private audit inaccessible to public.
- **Public read:** published visible; draft/rejected/archived invisible on the
  anon path.

All M1/M2 tests are preserved and continue to pass.

# 25. Supabase pending gate

There is currently **no guaranteed live Supabase project** (master prompt §27).
Therefore:

- **Implementation compatibility:** YES — the same canonical migrations/policies
  used in tests deploy to Supabase unchanged.
- **Deterministic database verification:** REQUIRED and done (PGlite + shim).
- **Live Supabase verification:** **PENDING** until real project
  credentials/URL are supplied. It is never fabricated.

Remaining live-verification steps (to run once a project exists): apply
`supabase/migrations/*` to the project; create an `ADMIN` and a `REVIEWER`
`app_user` bound to real `auth.users`; set `PUBLIC_SUPABASE_URL`,
`PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`; then
walk the manual flow (sign-in → create → edit → classify → criticism → submit →
approve → publish → public detail) and confirm RLS denies anon/reviewer the
publish path in the live database.
