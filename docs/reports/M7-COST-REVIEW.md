# M7 Cost Review — Automated Research Discovery (Design)

**Status:** architecture-level estimate. **M7 IMPLEMENTATION = NOT STARTED.
AUTHORIZATION = NOT GRANTED.**
**Design:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`, `docs/adr/ADR-020-…md`,
`docs/21-COST-CONTROL.md`

Estimates are **architecture-level only**. No API pricing is invented; unknown or
time-varying figures are marked **UNKNOWN / REQUIRES LIVE VERIFICATION**. WiseEvidence
policy is *free first, cheap second, paid only when justified* (`21` §1).

## Cost model

Total M7 recurring cost = compute (runs) + storage (candidates/provenance) + source
API fees + AI + any new infrastructure.

| Component | Design choice | Cost |
|-----------|---------------|------|
| **Source API fees** | First source is a **free, keyless public API** (Crossref; Europe PMC / PubMed also free). No paid scraping API. | **$0** (free tier). Politeness contact required, not paid. |
| **Compute for runs** | ADMIN-triggered, **bounded** on-demand runs on the **existing** app/server. No new worker, no queue. | Effectively **$0** incremental on current hosting; bounded by per-run caps. |
| **Storage** | Candidate/job/provenance rows in the **existing** Supabase/PostgreSQL. Metadata + hashes only; **no full-text/PDF hosting**. | Marginal DB growth; within existing plan for expected volumes. **Exact plan headroom: REQUIRES LIVE VERIFICATION** once volumes are known. |
| **AI** | **None in discovery.** Optional downstream enrichment reuses M6; default provider is the offline **Mock** (no key, no network). A real provider is opt-in. | **$0** by default. If a real provider is enabled later, cost = actual tokens × operator pricing, `null` when pricing/usage unknown (never a guessed $0) — `29` §16. |
| **Scheduler** | **Deferred.** On-demand only in M7. | **$0** (none built). |
| **CI** | Deterministic, **offline**, injected-fetch + fixtures. No live calls in CI. | **$0** external spend. |

## Explicitly NOT introduced (no cost added)

Vector database · embeddings · Elasticsearch · Redis · paid scraping/HTTP API ·
browser automation · a production scheduler/worker/queue · Hermes · production AI on
every item. Each is a deliberate non-purchase (`21` §4, `docs/24` §18, `ADR-020`).

## Free-first justification

- The first source and the likely next two (Europe PMC, PubMed) are free, keyless
  public APIs with structured metadata — no fee, no vendor lock-in.
- Runs execute on existing infrastructure within bounded caps, so no new compute line
  item.
- Offline fixture CI means development and testing cost nothing externally.
- AI stays optional and defaults to the offline Mock, so discovery incurs no model
  spend.

## Items requiring live verification (not fabricated here)

- Current **rate limits / terms** of each candidate source (Crossref, Europe PMC,
  PubMed) — **REQUIRES LIVE VERIFICATION** before enabling a source; treated as
  per-source `SourceDescriptor` config, not asserted here.
- **Supabase/Postgres storage headroom** at projected candidate volumes —
  **REQUIRES LIVE VERIFICATION** against the provisioned project.
- **Hosting compute** impact of on-demand runs on the chosen SSR host (Render, once
  provisioned) — **REQUIRES LIVE VERIFICATION**.
- Any future **real AI provider** pricing — operator-supplied; **UNKNOWN** until
  configured (`29` §16, `ADR-019`).

## Scheduler cost comparison (for the deferred decision)

If/when a cadence justifies scheduling, compare on cost + reliability + secrets +
limits + observability + recovery (`docs/30` §14). At design level: GitHub Actions
cron and Supabase scheduled functions have **free/low** tiers and reuse existing
secrets/observability; a custom worker ("Hermes") adds build + run + maintenance cost
for no current benefit. **Recommendation: defer; prefer the cheapest free mechanism
that meets a demonstrated need.**

## Verdict

M7 as designed is **$0 incremental** in the default configuration (free source API,
existing DB/compute, offline CI, Mock AI). The only cost variables are storage growth
and optional real-AI enrichment, both bounded and operator-controlled. No paid
service is required or introduced.

**M7 IMPLEMENTATION = NOT STARTED. AUTHORIZATION = NOT GRANTED.**
