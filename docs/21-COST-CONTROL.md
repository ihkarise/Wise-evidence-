# WiseEvidence
## Cost Control

**Document:** `docs/21-COST-CONTROL.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `10-AI-ARCHITECTURE.md`, `14-SEARCH-ARCHITECTURE.md`, `19-DEPLOYMENT.md`

---

# 1. Purpose

Make the cost philosophy operational: **Free first. Cheap second. Paid only when
justified.** (`00` §14, master prompt §7.)

> **Milestone 6 (AI enrichment) is free-first.** The default and CI provider is the
> offline `MockAIProvider` — no key, no network, no paid call. A real provider is
> opt-in via server-only config; every real call is cache-guarded by the M2 cache
> identity (`study + operation + input_hash + model + prompt_version`). Cost is
> derived ONLY from real provider-reported usage and operator-supplied pricing; if
> either is unavailable the cost is NULL — never a guessed `$0`. No paid queue, no
> vector DB, no scraping. See `docs/29-AI-ENRICHMENT.md` §16, §23.

# 2. Cost Principles

- Every external paid dependency must have a documented reason (master prompt
  §35). If a paid service seems necessary, explain why **before** adding it
  (`00` §16, master prompt §7) — this is a stop condition (`23`, master prompt
  §89).
- Do not introduce Kubernetes, microservices, Elasticsearch, a dedicated vector
  database, expensive observability, or expensive AI-on-every-paper without a
  measured requirement (`00` §16, master prompt §7).

# 3. Free-Tier Strategy

- Static-first Astro site on free/low-cost hosting (`19` §3).
- Supabase free/low tiers for PostgreSQL, Auth, and (only when justified) Edge
  Functions / Storage (`04` §12).
- GitHub + GitHub Actions within free CI limits (`19` §5).

# 4. AI Cost Strategy

- Cheapest suitable model first, escalate only when necessary (`10` §7).
- Cache on `research_id + operation + input_hash + model + prompt_version`
  (`10` §8).
- Batch processing, small prompts, structured outputs (master prompt §11).
- Deterministic mock provider in development and CI — no spend to develop or test
  (`10` §14, `20` §4).
- Track per-job cost where the provider exposes it (`10` §15); surface AI cost as
  a success metric (`02` §14).
- **Model choice + real cost are decided by the Milestone 6.1 benchmark**
  (`packages/benchmark`, `docs/reports/M6.1-OPERATIONAL-VERIFICATION.md`): it
  compares candidate models on the DEMO study, verifies live catalogue + pricing,
  and produces per-study cost and 100/1k/10k/100k projections from _real_ usage.
  Until that live gate runs (currently BLOCKED — egress denied + no key), no model
  is named primary and no live cost is quoted; projection method and honest-NULL
  rule are fixed, values are PENDING.

# 5. Data & Storage Limits

- Do not host PDFs by default (`17` §5) — store identifiers and links.
- Keep the database within free/low tiers for the MVP scale (hundreds → tens of
  thousands of records, `02` §11).

# 6. Scraping / Import Limits

Respect source rate limits and prefer official APIs (`11` §5). Manual import
first avoids premature infrastructure cost (`11` §2).

# 7. Search Cost

PostgreSQL FTS first; no search cluster or vector DB during MVP (`14` §2).

# 8. Monitoring Cost

Low-cost, privacy-conscious monitoring; avoid expensive observability without a
measured need (`19` §9).

# 9. Upgrade Triggers

Move off a free tier / adopt a paid service only when a measured trigger appears,
for example:
- Sustained rate-limit or quota exhaustion on a free tier.
- A measured performance bottleneck search/caching cannot solve (`14` §9).
- Storage or compute needs that exceed free tiers at real scale.
Each upgrade is justified in writing and, if architectural, recorded as an ADR.
