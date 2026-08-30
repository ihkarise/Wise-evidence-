# M7 Security Review — Automated Research Discovery (Design)

**Status:** design threat model. **M7 IMPLEMENTATION = NOT STARTED. AUTHORIZATION =
NOT GRANTED.**
**Design:** `docs/30-AUTOMATED-DISCOVERY-METHODOLOGY.md`, `docs/adr/ADR-020-…md`,
`docs/16-SECURITY.md`

This threat-models the *designed* discovery subsystem so mitigations are decided
before any code exists. It is a security review, **not legal advice**; items needing
owner/legal sign-off are flagged.

## Attack surface (designed)

- **Outbound**: connector HTTP(S) requests to approved source APIs (the only new
  egress).
- **Inbound data**: untrusted source payloads (titles, abstracts, identifiers, URLs,
  author names) entering the pipeline.
- **Persistence**: candidate/job/source/provenance rows (staff-only via RLS).
- **Admin control plane**: ADMIN triggers runs / enables sources; reviewers act on
  candidates.
- **Downstream**: optional AI enrichment on accepted drafts (existing M6 surface).

Discovery adds **no public** surface: public users still see only `PUBLISHED`
research.

## Threats, mitigations, residual risk

| # | Threat | Mitigation (designed) | Residual risk |
|---|--------|-----------------------|---------------|
| 1 | **SSRF** — item id/URL coerces a fetch to an internal host | Host **allowlist** from `SourceDescriptor`; id/DOI builds path only, never host; HTTPS-only; block loopback/private/link-local (`isPrivateHost`); no cross-host redirects | Low; DNS-rebind needs network-layer pinning (owner infra note) |
| 2 | **Prompt injection in abstracts/titles** | Untrusted text is **data, never instructions**; sanitized (control chars, markup→text, caps) via `packages/metadata`; **no AI in discovery path**; downstream AI wraps input in `<research_data>` delimiters (existing M6) | Low |
| 3 | **Malicious/oversized responses** | Per-request `AbortController` timeout; streamed **response-size cap**; content-type validation; JSON/XML parse errors → item error, run survives | Low |
| 4 | **Hostile HTML / markup** | No HTML scraping in M7; markup stripped to text; never emitted as markup | Low |
| 5 | **Poisoned / spoofed metadata** (fake DOI, wrong identifiers) | Identifier canonicalization + validation; mismatched DOI rejected (as `packages/metadata` already does); everything routes to **human review**; source ≠ truth | Medium — a determined source could still supply plausible-but-wrong metadata; human review is the backstop |
| 6 | **Duplicate flooding** (candidate spam) | Per-run candidate/request **caps**; idempotency `(source_key, stable_source_id)` no-ops re-sightings; conservative dedup | Low/Medium — a hostile source could still fill the queue within caps; source disable is the control |
| 7 | **Source abuse / rate-limit violation** (we harm the source) | Per-source rate limit + concurrency + politeness UA/`mailto`; honor `Retry-After`; circuit breaker on repeated failure | Low |
| 8 | **Credential exposure** | Only politeness contact / optional source key, from **env**, never committed, never client-exposed; no secret in candidate/provenance rows; guard test blocks `PUBLIC_`-prefixed secrets | Low |
| 9 | **AI manipulation** (untrusted text steering AI) | AI is downstream + suggestion-only; never authoritative; firewalls (never canonical/publish/lifecycle/statistics) unchanged; discovery never calls AI | Low |
| 10 | **Privilege escalation** (reviewer over-reach) | RLS: candidates/jobs/sources staff-only; enabling sources / triggering runs / publishing is ADMIN-only; reviewers get no DB-admin rights | Low |
| 11 | **Data exfiltration via public path** | RLS keeps all ingestion data private; public sees only `PUBLISHED`; enforced in DB, not client | Low |
| 12 | **Auto-publish / auto-draft bypass** | Structural: discovery outputs candidates only; `createDraft()` is human; publish is ADMIN-only behind the fail-closed demo-protected guard (migration `0010`); architecture-boundary guard test extended | Low |
| 13 | **Full-text/copyright over-collection** | Metadata minimization; raw payload retained by **hash** only; no PDF hosting (`11` §9) | Low — retention policy is an Open Decision (below) |
| 14 | **Parser/provider failure cascades** | One item's failure is isolated; run bounded; failures visible in `import_job.error_summary`; never spins indefinitely | Low |
| 15 | **Robots/terms/paywall circumvention** | System **stops rather than circumvents**; API-first; Tier-4 HTML only with explicit permission + owner sign-off (not M7) | Owner/legal decision — see below |

## Reused, already-tested controls

- Host-pinned, injected-fetch, timeout+size-capped fetch (`packages/metadata`
  `CrossrefConnector`).
- Base-URL SSRF gate `validateBaseUrl`/`isPrivateHost` (`packages/ai/config.ts`).
- Untrusted-text sanitization (`packages/metadata/sanitize.ts`).
- RLS least-privilege + publish guard (migrations `0008`/`0010`/`0012`), covered by
  the `rls`/`grants`/`workflow-security` suites.
- AI firewalls + `<research_data>` delimiters (`packages/ai`, M6 security tests).

## Owner / legal decisions required

1. **Per-source terms/robots/licensing review** before enabling any source (Tier
   gate). API-first sources (Crossref/Europe PMC/PubMed) are low-risk; still confirm
   current terms.
2. **Raw-payload retention** — retain by hash only, or keep normalized snapshot +
   hash, and for how long (data-governance, `17`).
3. **Politeness contact identity** (the `mailto`/`tool` string) — an operational
   value to set in env.
4. **Any future Tier-4 HTML source** — explicit permission + sign-off; out of M7.

## Verdict

The designed subsystem is **secure by construction** for M7's scope: candidate-only
output, human-gated promotion, RLS-private data, SSRF-hardened egress, untrusted-data
handling, and no new public surface. The highest residual risks (poisoned metadata,
duplicate flooding within caps) are mitigated by conservative dedup + mandatory human
review + source disable, not eliminated — acceptable for a review-gated pipeline.

**M7 IMPLEMENTATION = NOT STARTED. AUTHORIZATION = NOT GRANTED.**
