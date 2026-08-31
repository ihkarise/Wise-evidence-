/**
 * Discovery provider registry / source seam (M7.1; docs/30, ADR-020 design).
 *
 * The registry is the single place that turns a `DiscoveryProviderType` into a
 * provider instance (cf. the AI provider registry, ADR-019). The orchestrator
 * that ships in a later milestone will ask the registry for a provider — it will
 * never `new` an adapter and never learn which real source answered.
 *
 * Fail-closed: `MOCK` and `CROSSREF` (M7.2) ship registered; `PUBMED` /
 * `EUROPE_PMC` (and any unregistered type) throw a typed
 * `DiscoveryError("NOT_CONFIGURED")` with a SAFE message. CROSSREF additionally
 * fails closed with `NOT_CONFIGURED` when resolved WITHOUT an injected `fetch` —
 * the package never reaches for a global fetch, so egress must be supplied by the
 * caller. Constructing a provider performs no I/O (the first network call happens
 * only when the provider is actually used).
 *
 * Framework-independent: no Astro, React, Supabase, or AI imports; no ambient I/O.
 */
import { DiscoveryError } from "./errors.js";
import { MockDiscoveryProvider } from "./mock/provider.js";
import { CrossrefDiscoveryProvider } from "./crossref/provider.js";
import type { FetchLike } from "./http.js";
import type { DiscoveryProvider } from "./provider.js";
import type { DiscoveryProviderType } from "./types.js";

/**
 * Everything a factory may need to build a provider. Extended per adapter. The
 * `fetch` is injected (never a global) so networked adapters stay testable and
 * the discovery package never reaches for ambient egress; an adapter that needs
 * it and does not receive it fails closed with `NOT_CONFIGURED`.
 */
export interface DiscoveryProviderFactoryContext {
  /** Source key to assign (a source may reuse an adapter under different keys). */
  readonly key?: string;
  /** Injected fetch for networked adapters (required by CROSSREF; unused by MOCK). */
  readonly fetch?: FetchLike;
  /** Contact email for a polite-pool User-Agent, supplied by configuration. */
  readonly contactEmail?: string | null;
  /** Deterministic clock override (tests). */
  readonly clock?: () => string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

/** Builds a provider instance. Must perform NO I/O and make NO network call. */
export type DiscoveryProviderFactory = (
  context: DiscoveryProviderFactoryContext,
) => DiscoveryProvider;

/** The provider types the platform intends to support (design surface). */
export const KNOWN_PROVIDER_TYPES: readonly DiscoveryProviderType[] = [
  "MOCK",
  "CROSSREF",
  "PUBMED",
  "EUROPE_PMC",
];

export class DiscoveryProviderRegistry {
  readonly #factories = new Map<DiscoveryProviderType, DiscoveryProviderFactory>();

  /** Register (or replace) the factory for a provider type. */
  register(type: DiscoveryProviderType, factory: DiscoveryProviderFactory): this {
    this.#factories.set(type, factory);
    return this;
  }

  /** Whether an adapter is registered for a provider type. */
  has(type: DiscoveryProviderType): boolean {
    return this.#factories.has(type);
  }

  /** The provider types with a registered adapter (implemented sources). */
  registeredTypes(): DiscoveryProviderType[] {
    return [...this.#factories.keys()];
  }

  /**
   * Build the provider for `type`. Throws `DiscoveryError("NOT_CONFIGURED")`
   * when no adapter is registered — the fail-closed path for CROSSREF / PUBMED /
   * EUROPE_PMC until their adapters ship.
   */
  resolve(
    type: DiscoveryProviderType,
    context: DiscoveryProviderFactoryContext = {},
  ): DiscoveryProvider {
    const factory = this.#factories.get(type);
    if (factory === undefined) {
      throw new DiscoveryError(
        "NOT_CONFIGURED",
        `no discovery adapter registered for provider type '${type}'`,
      );
    }
    return factory(context);
  }
}

/**
 * A registry pre-registered with the shipped adapters: MOCK and CROSSREF (M7.2).
 * CROSSREF requires an injected `fetch` at resolve time (egress is never ambient
 * in this package); resolving it without one fails closed as `NOT_CONFIGURED`.
 * PUBMED / EUROPE_PMC are intentionally NOT registered, so the orchestrator fails
 * clearly until each adapter is added, without any change to the seam.
 */
export function createDefaultDiscoveryRegistry(): DiscoveryProviderRegistry {
  return new DiscoveryProviderRegistry()
    .register("MOCK", (context) => new MockDiscoveryProvider({ key: context.key }))
    .register("CROSSREF", (context) => {
      if (context.fetch === undefined) {
        throw new DiscoveryError(
          "NOT_CONFIGURED",
          "CROSSREF requires an injected fetch (egress is not ambient in @wise-evidence/discovery)",
        );
      }
      return new CrossrefDiscoveryProvider({
        fetch: context.fetch,
        key: context.key,
        contactEmail: context.contactEmail ?? null,
        clock: context.clock,
        timeoutMs: context.timeoutMs,
        maxBytes: context.maxBytes,
      });
    });
}
