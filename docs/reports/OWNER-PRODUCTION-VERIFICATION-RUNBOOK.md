# Owner Production Verification Runbook

**Audience:** the project owner, verifying WiseEvidence against **live**
infrastructure with limited time (e.g. from a laptop while travelling).
**Prepared by:** M6.3 offline hardening pass. Everything that could be verified
without live credentials already has been; this runbook covers only the gates that
genuinely require you, a browser, and real services.

## Before you start (2 minutes)

- You will need: the Supabase project dashboard, a Render account, and (optionally,
  and only later) one OpenRouter key for the M6.1 benchmark.
- **Never paste a secret into this repo, a commit, a screenshot, a chat, or an
  issue.** Secrets live only in the Supabase and Render dashboards. When a step
  says "bring back a result", it means the **non-secret** outcome (a status, a
  count, a screenshot of a page — never a key or connection string).
- The app is safe by default: with no AI key it uses the offline Mock provider; with
  no Supabase config the admin/data pages show a "not configured" notice instead of
  breaking.
- Status words used here: **VERIFIED / PARTIALLY VERIFIED / PENDING / BLOCKED.** Do
  not upgrade a PENDING gate to VERIFIED without actually doing the step.

---

## STEP 1 — Supabase project

**Do:** In the Supabase dashboard, confirm a project exists (or create one). Note
the project URL and the two keys from **Project Settings → API**: the `anon` public
key and the `service_role` secret key.

**Success:** The project is provisioned and reachable; you can see the API keys.

**Do not expose:** The `service_role` key is RLS-bypassing — it is server-only.
Never put it in a `PUBLIC_*` variable, client code, or a screenshot.

**Bring back:** "Supabase project provisioned: yes/no." (No keys.)

---

## STEP 2 — Migration inspection (read-only)

**Do:** Apply the repository migrations if not already applied — either
`supabase db push` from a checkout, or paste `supabase/migrations/0001…0012` in
order into the SQL editor. Then open **SQL Editor**, paste the whole of
[`PRODUCTION-DATABASE-INSPECTION.sql`](./PRODUCTION-DATABASE-INSPECTION.sql), and run
it. Read results against [`PRODUCTION-DATABASE-INSPECTION.md`](./PRODUCTION-DATABASE-INSPECTION.md).

**Success:** Section 2 shows all 27 tables `present`, section 3 all 23 enums,
section 4 `rls_enabled = true` everywhere, sections 8–9 show the guard functions and
publish trigger. There is **no migration beyond 0012**.

**Do not expose:** The script reads no secrets; its output is safe to share. Do not
edit the script to add writes.

**Bring back:** The section 2/3/4/6 result tables (screenshots are fine).

---

## STEP 3 — Migration 0012 decision (grant hardening)

**Do:** Look at **section 6** of the inspection output. If any **private** table
(`app_user`, `review`, `correction`, `audit_log`, `import_job`, `import_candidate`,
`ai_job`, `ai_result`) shows `true` for `anon`, then Supabase's default grants have
handed `anon` privileges the docs say it should not hold. RLS still blocks the data,
but to match least-privilege intent, apply `supabase/migrations/0012_grant_hardening.sql`.

**Success:** After applying 0012, re-run the inspection: section 6 shows `anon`
holding **only** `SELECT` on public tables and **nothing** on private tables, with
no `INSERT/UPDATE/DELETE` anywhere.

**Do not expose:** Nothing sensitive here. Applying 0012 is **your** decision — it is
not applied automatically from CI.

**Bring back:** "0012 applied: yes/no" and the post-apply section 6 result.

---

## STEP 4 — Render deployment

**Do:** In Render, **New → Blueprint**, connect this repo. Render reads
[`render.yaml`](../../render.yaml): a single Node 22 web service that builds with
`pnpm --filter web build` and starts `node apps/web/dist/server/entry.mjs`, health
check `/`.

**Success:** The service builds and goes live; the health check passes; the Render
URL loads the WiseEvidence home page.

**Do not expose:** All secrets in `render.yaml` are `sync: false` — you set their
values in the Render dashboard, never in the file. AI keys and the service-role key
must never get a `PUBLIC_` prefix.

**Bring back:** The live Render URL and "build/health: green".

---

## STEP 5 — Environment variables

**Do:** In the Render service **Environment** tab, set the `sync:false` values from
`render.yaml`:

- Public pair (browser, RLS-protected): `PUBLIC_SUPABASE_URL`,
  `PUBLIC_SUPABASE_ANON_KEY`.
- Server-only (no `PUBLIC_` prefix): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`.
- AI: leave unset to keep the offline Mock provider (recommended for launch).

**Success:** After the values are set and the service redeploys, `/research`,
`/evidence`, and `/statistics` show live data instead of the "not configured"
notice.

**Do not expose:** Confirm no server secret is prefixed `PUBLIC_`. A CI guard
(`packages/domain/test/architecture-boundaries.test.ts`) already blocks this in the
repo; the Render dashboard is your responsibility.

**Bring back:** "Live data renders on public pages: yes/no."

---

## STEP 6 — Admin login

**Do:** Create a reviewer/admin user in **Supabase → Authentication → Users** (email
+ password). Then in the `app_user` table insert (or confirm) a row whose `id`
equals that user's `auth.uid()` with `role = 'ADMIN'`. Visit `/admin` on the live
site → you should be redirected to `/admin/sign-in`; sign in there.

**Success:** Signed out, `/admin` redirects to sign-in (302). Signed in as ADMIN,
`/admin` loads the workflow dashboard.

**Do not expose:** The password. Screenshots of the admin UI are fine; do not
capture the sign-in form with a typed password.

**Bring back:** "Admin sign-in works and `/admin` is protected when signed out:
yes/no."

---

## STEP 7 — Reviewer workflow

**Do:** In the admin UI: create a draft from a DOI (metadata fetch), edit fields,
add independent classification / criticism, move it to review, and — as ADMIN —
approve & publish. Try to publish a `is_demo = true` record too.

**Success:** A non-demo study moves `DRAFT → PENDING_REVIEW → PUBLISHED`. A reviewer
(non-admin) **cannot** publish. A demo record **cannot** be published (the guard
rejects it). Every action is via dropdowns/buttons — never raw row edits.

**Do not expose:** Nothing sensitive. Use a test study, not real personal data.

**Bring back:** "Publish workflow + publish guard behave as expected: yes/no."

---

## STEP 8 — Public research

**Do:** Open the published study at `/research/<id>` in a normal (signed-out)
browser.

**Success:** The published study renders with its human-reviewed classifications.
Drafts / pending / rejected / archived studies are **not** reachable while signed
out. Outcome, quality, confidence, and criticism appear as **separate** dimensions.

**Do not expose:** Nothing.

**Bring back:** "Published detail page renders; unpublished states are not visible to
anon: yes/no."

---

## STEP 9 — Explorer

**Do:** Open `/research`. Exercise search, DOI lookup, and the study-type / evidence
-level / outcome / quality / condition / intervention / year filters, plus sorting
and pagination.

**Success:** Filters and sorting work; results are **published-only**. There is **no**
"most effective", popularity, vote, or combined-score sort — only neutral options.

**Do not expose:** Nothing.

**Bring back:** "Explorer filters/sort/pagination work; no efficacy/popularity sort:
yes/no."

---

## STEP 10 — Evidence

**Do:** Open `/evidence`.

**Success:** The evidence pyramid reflects **evidence level only** (a navigation
device — position implies nothing about outcome, truth, or effectiveness). Missing
data shows as explicit `UNCLASSIFIED`, never as Neutral.

**Do not expose:** Nothing.

**Bring back:** "Evidence pyramid renders by level with no valence encoding:
yes/no."

---

## STEP 11 — Statistics

**Do:** Open `/statistics`.

**Success:** Outcome, quality, and criticism distributions render as **independent**
axes. There is **no** cross-tab and **no** efficacy/balance/combined score. Study
counts are distinct studies (multi-publication studies counted once).

**Do not expose:** Nothing.

**Bring back:** "Three independent distributions render; no combined score: yes/no."

---

## STEP 12 — AI provider

**Do:** Keep AI on the **Mock** provider for launch (leave `AI_*` unset). Only if you
deliberately want a live provider: set `AI_PROVIDER` (e.g. `openai-compatible` or
`openrouter`), `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY` in the Render dashboard,
plus optional `AI_PRICE_*`. Then, as staff, run one enrichment from the editor AI
panel and Accept/Edit/Reject the suggestion.

**Success:** With Mock, enrichment produces a deterministic suggestion offline.
Switching providers is **configuration only** — no code change. The AI suggestion
is never canonical until a human accepts it, and never publishes.

**Do not expose:** The `AI_API_KEY`. It is server-only and never `PUBLIC_`. It is not
stored in `ai_job`/`ai_result` or logs.

**Bring back:** "AI panel produces a suggestion and Accept/Edit/Reject works;
provider is switchable by config: yes/no." (No key.)

---

## STEP 13 — M6.1 benchmark (optional, secure environment only)

**Do:** Only in a secure server-side environment with a funded OpenRouter key, run
the benchmark harness (`packages/benchmark`) against the configured provider. This is
a one-off measurement, not a production dependency.

**Success:** The harness records provider/model/task/latency/tokens/validity/cost.
Cost is `actual tokens × operator pricing`; when pricing or usage is missing, cost is
`null` — never a guessed `0`.

**Do not expose:** The OpenRouter key. Do not run live model calls from an
environment that should not have egress.

**Bring back:** The benchmark report (numbers are fine; no key). If you do not run
it, this gate stays **BLOCKED/PENDING** — that is expected.

---

## STEP 14 — Security check

**Do:** Confirm the security posture end-to-end:

- Signed out, private tables are invisible: `/api/*` admin routes and any AI/review/
  audit data are not reachable.
- No `PUBLIC_`-prefixed secret exists in Render.
- The `service_role` key is only in server-only variables.
- Re-run the inspection **section 6** to confirm `anon` least privilege.

**Success:** Anonymous users can read **only** published research; AI jobs/results,
reviews, corrections, import candidates, and audit logs are hard-denied. No secret is
exposed to the browser.

**Do not expose:** Any key. Share only pass/fail.

**Bring back:** "Anon is published-only; no secret exposed; section 6 least-privilege
confirmed: yes/no."

---

## After you finish

Report each step as VERIFIED / PARTIALLY VERIFIED / PENDING / BLOCKED. The offline
work is already done and recorded in the M6.3 checkpoint; your results close the live
gates. Nothing here starts Milestone 7 — automated discovery remains a separate,
un-authorized design review.
