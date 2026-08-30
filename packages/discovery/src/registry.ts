/**
 * Discovery provider registry / source seam (M7.1; docs/30, ADR-020 design).
 *
 * The registry is the single place that turns a `DiscoveryProviderType` into a
 * provider instance (cf. the AI provider registry, ADR-019). The orchestrator
 * that ships in a later milestone will ask the registry for a provider — it will
 * never `new` an adapter and never learn which real source answered.
 *
 * Fail-closed: only `MOCK` is registered in M7.1. Resolving `CROSSREF`,
 * `PUBMED`, or `EUROPE_PMC` (or any unregistered type) throws a typed
 * `DiscoveryError("NOT_CONFIGURED")` with a SAFE message. There is deliberately
 * no fake Crossref behaviour and no network call anywhere in this module.
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports; no I/O.
 */
import { DiscoveryError } from "./errors.js";
import { MockDiscoveryProvider } from "./mock/provider.js";
import type { DiscoveryProvider } from "./provider.js";
import type { DiscoveryProviderType } from "./types.js";

/** Everything a factory may need to build a provider. Extended per adapter. */
export interface DiscoveryProviderFactoryContext {
  /** Source key to assign (a source may reuse an adapter under different keys). */
  readonly key?: string;
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
 * A registry pre-registered with the shipped adapters. In M7.1 that is MOCK
 * only; CROSSREF / PUBMED / EUROPE_PMC are intentionally NOT registered, so the
 * orchestrator fails clearly (NOT_CONFIGURED) until each adapter is added,
 * without any change to the seam.
 */
export function createDefaultDiscoveryRegistry(): DiscoveryProviderRegistry {
  return new DiscoveryProviderRegistry().register(
    "MOCK",
    (context) => new MockDiscoveryProvider({ key: context.key }),
  );
}
