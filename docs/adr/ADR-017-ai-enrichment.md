# ADR-017: AI Enrichment — Suggestion-Only Pipeline, Provider Independence, and the Canonical/Publication/M5 Firewalls

**Status:** Accepted (design)
**Date:** 2026-08-29
**Related:** `docs/29-AI-ENRICHMENT.md`, `docs/10-AI-ARCHITECTURE.md`, `docs/16-SECURITY.md`,
`docs/21-COST-CONTROL.md`, `docs/28-EVIDENCE-VISUALIZATION-METHODOLOGY.md`, `ADR-005`, `ADR-006`, `ADR-010`

## Context

Milestone 6 introduces AI *logic* over the AI *tables* that M2 already shipped
(`ai_job`, `ai_result`, and the `ai_result_id` provenance columns on
`classification` / `evidence_quality_assessment` / `criticism`). The credibility
core of WiseEvidence depends on AI never becoming an authority: outcome, quality,
confidence, criticism, and provenance must stay separate, and public/M5 data must
reflect only human-reviewed canonical values. M6 is methodology- and
security-gated, so the design is fixed before any code, prompt, provider, or UI is
written.

## Decision

1. **AI is a suggestion engine, never an authority.** AI outputs are stored only
   as immutable `ai_result` rows and become canonical **only** when a human runs
   the existing M3 service operation (Accept/Edit), which records the `ai_result`
   id as provenance. AI never writes a canonical value, never publishes, never
   changes lifecycle/publication state, and holds no write privilege of its own.
2. **Provider independence.** All AI use goes through a provider-independent
   interface in a new `packages/ai`; the default and CI provider is a deterministic
   offline `MockAIProvider`, and the real provider is a generic
   `OpenAICompatibleProvider` (injected `fetch`, unit-tested with fake responses).
   OpenRouter is one compatible endpoint used later for the M6.1 benchmark — not
   the architecture. All AI config is **server-only** (never `PUBLIC_*`, never
   committed, never in the browser bundle).
3. **Exactly the six documented tasks** (`research-summary`,
   `outcome-classification`, `evidence-quality`, `criticism-extraction`,
   `metadata-extraction`, `duplicate-detection`), each with a stable id, versioned
   prompt (`prompts/<task>/vN.md`), explicit input contract, structured output
   schema + validation, provider/model metadata, AI confidence where applicable,
   provenance, and the M2 cache identity
   (`research_id + operation + input_hash + model + prompt_version`).
4. **Untrusted-in, untrusted-out.** Research text is data, never instructions
   (delimited, injection-resistant prompts); model output is validated before it
   is trusted (schema/enum/length/confidence, DOI-format rejection). Data is
   minimised (structured fields only; input hash stored, not the full input).
   Usage and cost are recorded only when really reported/priced, else NULL —
   never a faked zero.
5. **Three firewalls, test-enforced.** *Canonical*: only human service ops write
   canonical values. *Publication*: the existing ADMIN-or-service, non-demo,
   PENDING_REVIEW guard is untouched — AI cannot publish. *M5*: `stats.ts` counts
   only PUBLISHED + human `final_value`; AI suggestions are private and structurally
   invisible to it, and no AI weighting/score/cross-tab is introduced.

This ADR is **design-only** (like ADR-012): implementation is authorized
separately. A minimal additive, nullable migration (`0011`) for token
usage/diagnostics is defined but not written here.

## Consequences

- The canonical data model, the publication gate, and the M5 methodology are
  preserved exactly; AI adds provenance-linked suggestions, not authority.
- CI stays fully offline and free: no AI key, no live network, no paid service is
  ever required (ADR-010).
- Provider swap (OpenRouter, a second endpoint, a local model) is a config change,
  not a code change above the interface (ADR-005).
- One new abstraction layer (`packages/ai`) and one small migration to maintain —
  accepted for portability, testability, and the firewalls.
- Rules out: AI-authored canonical values, AI publication, AI-driven statistics,
  fabricated identifiers, secret exposure, and any efficacy/combined score.
- Live provider + live Supabase verification remain **PENDING**; M6.1 and M7 are
  **NOT STARTED** until explicit authorization.
