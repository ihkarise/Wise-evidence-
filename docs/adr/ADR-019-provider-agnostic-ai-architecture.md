# ADR-019: Provider-Agnostic AI Architecture — Registry, Configuration, Capabilities, and Secret Handling

**Status:** Accepted — IMPLEMENTED (Architecture-hardening milestone, pre-M7)
**Date:** 2026-08-29
**Related:** `docs/29-AI-ENRICHMENT.md`, `docs/10-AI-ARCHITECTURE.md`, `docs/16-SECURITY.md`,
`docs/21-COST-CONTROL.md`, `ADR-005`, `ADR-006`, `ADR-010`, `ADR-017`

## Context

Milestone 6 shipped a provider-independent `AIProvider` boundary with a
deterministic `MockAIProvider` (the CI default) and an injected-fetch
`OpenAICompatibleProvider`, plus a versioned prompt registry, task validators,
input hashing, cost derivation, and a pure orchestrator (`ADR-017`). The M6.1
benchmark was written specifically for OpenRouter.

That left two risks worth closing **before** Milestone 7:

1. **Latent OpenRouter coupling.** OpenRouter is only *one* possible backend. The
   web coordinator resolved a provider with an ad-hoc `if (provider ===
   "openai-compatible")` branch, the benchmark constructed an OpenRouter provider
   directly, and there was no first-class concept of "provider vs model",
   "capabilities", provider "presets", or configurable local/self-hosted
   endpoints. Nothing was *broken*, but adding Ollama, a self-hosted vLLM/LM
   Studio server, or a future native Gemini/Anthropic adapter would have meant
   touching application code.
2. **No explicit capability or secret-reference model.** The app assumed every
   configured model could produce structured output, and configuration held a raw
   `AI_API_KEY` rather than a *reference* to a server-side secret.

This ADR hardens the architecture so the operator can switch AI providers and
models purely by configuration, with no change to the research workflow, database
schema, canonical/AI models, human review, public pages, statistics, or explorer.
It is an **architecture-hardening** change: no new product features, no M7
discovery, no migration.

## Decision

### Provider abstraction (unchanged boundary, sharpened contract)

`AIProvider` remains the single stable, application-facing contract: `{ id,
modelId, capabilities?, complete(request) }`. The orchestrator, web coordinator,
and benchmark depend only on it and never on a vendor SDK. The neutral request
(`AICompletionRequest`) and response (`AICompletionResponse` — output, usage,
served model, finish reason) are the provider-neutral I/O contracts; adapters
translate them to and from vendor wire formats. Future response fields
(`rawProviderRequestId`, `warnings`) may be added additively without changing the
boundary.

### Provider registry

A new `AIProviderRegistry` maps a `ProviderConfig.type` to an adapter **factory**
and turns configuration into a provider instance: it validates the base URL,
resolves the secret by reference, checks that an adapter is registered, and
constructs the provider. `createDefaultRegistry()` registers `MOCK`,
`OPENAI_COMPATIBLE`, and `LOCAL` (LOCAL reuses the OpenAI-compatible adapter).
`resolveProviderFromEnv(env, { fetch })` is the single env→provider path shared by
the web coordinator and the benchmark. Resolution performs **no** network I/O.

### Provider types and presets

Four provider families are recognised: `OPENAI_COMPATIBLE`, `DIRECT_API`,
`LOCAL`, `MOCK`. The runtime adapter is chosen from the *type*, never a vendor
name. Thin configuration **presets** let one adapter represent many backends
without duplicated code: `mock`, `openrouter`, `ollama`, `lmstudio`, `vllm`,
`openai-compatible`. A base URL is configuration, never an application constant
(OpenRouter `https://openrouter.ai/api/v1`, Ollama `http://localhost:11434/v1`,
self-hosted vLLM/LM Studio operator-supplied).

### Model configuration and capability negotiation

Provider and model are separate concepts. `ModelConfig` carries `providerId`,
`modelId`, `displayName`, `capabilities`, `pricing`, `enabled`. `AICapabilities`
declares `structuredOutput`, `jsonSchema`, `toolCalling`, `vision`, and
nullable `maxContextTokens` / `maxOutputTokens`. Before a task runs the
orchestrator negotiates the task's required capabilities against the model's
declared capabilities; a shortfall fails with a typed `unsupported-capability`
error and is **never** silently downgraded. All six tasks require structured
output; none requires a strict provider JSON schema (the adapter may fall back to
`json_object`, and WiseEvidence application-level validation remains the real gate
regardless of what a provider claims).

### Secret management (server-only, by reference)

Configuration carries a `secretRef` — the *name* of an environment/secret-manager
entry — never a secret value. A server-side `SecretResolver` resolves it at
construction time. Secrets are never `PUBLIC_*`, never sent to the browser, never
persisted in the database, never logged, and never placed in an error message
(error text may name the *ref* — a variable name — but never the value). No raw
API key is stored in Supabase; the preferred model is hosting-environment secret →
server-side resolver → adapter. An encrypted database-backed secret store may be
introduced later only under an explicit security design; it is out of scope here.

### Base-URL SSRF policy

Because a base URL is now configurable, `validateBaseUrl` enforces http/https
only, rejects embedded credentials, and blocks `http:`/private/loopback hosts
unless the provider config opts in (`allowLocalNetwork`, for local dev backends).
Base URLs remain **trusted operator configuration**; an anonymous user can never
specify a provider, a model, or an endpoint.

### Local / open-weight and future direct providers

Ollama, LM Studio, vLLM, and other OpenAI-compatible servers are supported through
the existing adapter with an optional (often absent) key and local-network policy;
no model weights are bundled and none is a production or CI dependency. A future
`DIRECT_API` adapter (native Gemini/Anthropic) implements the same `AIProvider`
interface and registers a factory — addable without changing the orchestrator,
prompts, database, or workflow. Until then, resolving a `DIRECT_API` provider
fails clearly, proving the seam without adding a paid SDK.

### Provenance, cost, and fallback

Every suggestion still records provider, model, prompt version, input hash,
output, token usage (nullable, never fabricated), cost (null unless both usage and
pricing are known — local models are `null`, never `0`), and timestamp. A
`FallbackRecord` type captures a *deliberate* provider/model fallback (both
identities + a safe reason). WiseEvidence performs **no** automatic, uncontrolled
fallback for canonical classification: a different model can classify differently,
so fallback must be explicit and auditable.

### Benchmark generalization

`benchProvider(env, modelId, opts)` resolves the benchmark's provider through the
shared registry, so the M6.1 harness accepts any provider/model by configuration
(defaulting to the `openrouter` preset). It sweeps model ids per call rather than
reading a single `AI_MODEL`, and is no longer hard-coded to OpenRouter.

## Consequences

- The operator switches OpenRouter ↔ OpenAI-compatible ↔ Ollama ↔ local ↔ mock by
  configuration alone; no application, schema, prompt, or workflow change.
- The Mock provider stays the CI/default; `git clone && pnpm install && pnpm test`
  needs no key, no account, and no network.
- All M6/`ADR-017` safety guarantees are unchanged: AI is suggestion-only; it never
  writes canonical data, publishes, changes lifecycle, bypasses RLS, or enters M5
  statistics; AI results remain immutable; provenance is preserved.
- One more abstraction layer (registry + config + capabilities) to maintain —
  accepted for portability, local-model support, and lock-in avoidance (`ADR-005`,
  `ADR-010`).
- **No database migration** is added: provider configuration stays code/config, not
  a table. Persistent provider management would require its own design review.

## Rejected alternatives

- **Keep the ad-hoc provider `if`-branch.** Simplest, but re-couples the app to a
  fixed provider set and blocks local/self-hosted backends without code edits.
- **Add native OpenAI/Gemini/Anthropic SDK adapters now.** Rejected as premature —
  it adds paid dependencies for architectural completeness; the `DIRECT_API` seam
  makes them addable later without churn.
- **Store provider configuration (and secrets) in Supabase now.** Rejected: it
  invites raw secrets into the data model and a migration this task does not need.
  The `secretRef` + server-side resolver model keeps secrets in the hosting
  environment; a future encrypted store is a deliberate, separate decision.
- **Automatic provider fallback for canonical classification.** Rejected as
  unsafe: a silent model swap can change a classification. Fallback must be
  explicit and recorded (`FallbackRecord`).
