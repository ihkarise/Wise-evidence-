import { describe, it, expect } from "vitest";
import {
  DiscoveryProviderRegistry,
  createDefaultDiscoveryRegistry,
  KNOWN_PROVIDER_TYPES,
} from "./registry.js";
import { MockDiscoveryProvider } from "./mock/provider.js";
import { CrossrefDiscoveryProvider } from "./crossref/provider.js";
import { makeCrossrefFixtureFetch } from "./crossref/fixtures.js";
import { DiscoveryError, isDiscoveryError } from "./errors.js";
import type { DiscoveryProviderType } from "./types.js";

describe("DiscoveryProviderRegistry", () => {
  it("resolves the MOCK provider from the default registry", () => {
    const registry = createDefaultDiscoveryRegistry();
    const provider = registry.resolve("MOCK");
    expect(provider).toBeInstanceOf(MockDiscoveryProvider);
    expect(provider.descriptor.providerType).toBe("MOCK");
  });

  it("registers MOCK and CROSSREF by default; PUBMED/EUROPE_PMC stay unconfigured", () => {
    const registry = createDefaultDiscoveryRegistry();
    expect(registry.registeredTypes()).toEqual(["MOCK", "CROSSREF"]);
    expect(registry.has("MOCK")).toBe(true);
    expect(registry.has("CROSSREF")).toBe(true);
    expect(registry.has("PUBMED")).toBe(false);
    expect(registry.has("EUROPE_PMC")).toBe(false);
  });

  it("resolves CROSSREF when an injected fetch is supplied", () => {
    const registry = createDefaultDiscoveryRegistry();
    const { fetch } = makeCrossrefFixtureFetch({});
    const provider = registry.resolve("CROSSREF", { fetch });
    expect(provider).toBeInstanceOf(CrossrefDiscoveryProvider);
    expect(provider.descriptor.providerType).toBe("CROSSREF");
  });

  it("fails closed with NOT_CONFIGURED when CROSSREF is resolved without a fetch", () => {
    const registry = createDefaultDiscoveryRegistry();
    let thrown: unknown;
    try {
      registry.resolve("CROSSREF");
    } catch (error) {
      thrown = error;
    }
    expect(isDiscoveryError(thrown)).toBe(true);
    expect((thrown as DiscoveryError).code).toBe("NOT_CONFIGURED");
  });

  it.each<DiscoveryProviderType>(["PUBMED", "EUROPE_PMC"])(
    "fails closed with NOT_CONFIGURED for the unregistered %s",
    (type) => {
      const registry = createDefaultDiscoveryRegistry();
      let thrown: unknown;
      try {
        registry.resolve(type);
      } catch (error) {
        thrown = error;
      }
      expect(isDiscoveryError(thrown)).toBe(true);
      expect((thrown as DiscoveryError).code).toBe("NOT_CONFIGURED");
    },
  );

  it("passes an overridden source key through the factory", () => {
    const registry = createDefaultDiscoveryRegistry();
    const provider = registry.resolve("MOCK", { key: "mock-2" });
    expect(provider.key).toBe("mock-2");
  });

  it("lists all provider types the platform intends to support", () => {
    expect(KNOWN_PROVIDER_TYPES).toEqual(["MOCK", "CROSSREF", "PUBMED", "EUROPE_PMC"]);
  });

  it("allows registering a custom adapter without touching the seam", () => {
    const registry = new DiscoveryProviderRegistry().register(
      "MOCK",
      () => new MockDiscoveryProvider({ key: "custom" }),
    );
    expect(registry.resolve("MOCK").key).toBe("custom");
  });
});
