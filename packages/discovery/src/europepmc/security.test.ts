/**
 * Europe PMC connector — HTTP security & error-mapping tests (M7.6; docs/16).
 * All offline via an injected fake fetch. Proves the host/HTTPS/redirect/size/
 * content-type policy and the mapping of transport/HTTP failures onto typed,
 * secret-free discovery errors.
 */
import { describe, it, expect } from "vitest";
import { EuropePMCDiscoveryProvider, EUROPE_PMC_SOURCE_DESCRIPTOR } from "./provider.js";
import { makeFakeFetch, searchListBody, RESULT_FULL, type FakeResponseSpec } from "./fixtures.js";
import { assertUrlAllowed } from "../host-policy.js";
import { DiscoveryError } from "../errors.js";
import type { EuropePMCDiscoveryProviderOptions } from "./provider.js";
import type { SourceDescriptor } from "../descriptor.js";
import type { DiscoveryResult, DiscoveryPage } from "../types.js";

const CLOCK = () => "2026-02-02T00:00:00.000Z";

/** A provider whose fake fetch always returns `spec`, driven by a query. */
function discoverWith(
  spec: FakeResponseSpec,
  overrides: Partial<Omit<EuropePMCDiscoveryProviderOptions, "fetch">> = {},
): Promise<DiscoveryResult<DiscoveryPage>> {
  const { fetch } = makeFakeFetch(() => spec);
  const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK, ...overrides });
  return provider.discover({ query: "homeopathy" });
}

describe("Europe PMC host / URL policy (defense in depth)", () => {
  it("the descriptor pins www.ebi.ac.uk over https, no local network, no API key", () => {
    expect(EUROPE_PMC_SOURCE_DESCRIPTOR.allowedHosts).toEqual(["www.ebi.ac.uk"]);
    expect(EUROPE_PMC_SOURCE_DESCRIPTOR.requireHttps).toBe(true);
    expect(EUROPE_PMC_SOURCE_DESCRIPTOR.allowLocalNetwork).toBe(false);
    for (const key of Object.keys(EUROPE_PMC_SOURCE_DESCRIPTOR)) {
      expect(key).not.toMatch(/secret|api[-_]?key|token|password|credential/i);
    }
  });

  it("rejects http, arbitrary hosts, and loopback against the Europe PMC descriptor", () => {
    const d = EUROPE_PMC_SOURCE_DESCRIPTOR;
    const path = "/europepmc/webservices/rest/search";
    expect(() => assertUrlAllowed(`http://www.ebi.ac.uk${path}`, d)).toThrow(DiscoveryError);
    expect(() => assertUrlAllowed(`https://evil.example.com${path}`, d)).toThrow(DiscoveryError);
    expect(() => assertUrlAllowed("https://127.0.0.1/x", d)).toThrow(DiscoveryError);
    expect(assertUrlAllowed(`https://www.ebi.ac.uk${path}?query=x`, d).hostname).toBe(
      "www.ebi.ac.uk",
    );
  });

  it("fails closed with FORBIDDEN_SOURCE if the descriptor does not allow the request host", async () => {
    const tampered: SourceDescriptor = {
      ...EUROPE_PMC_SOURCE_DESCRIPTOR,
      allowedHosts: ["evil.example.com"],
    };
    const { fetch } = makeFakeFetch(() => ({ bodyText: searchListBody([RESULT_FULL], "*") }));
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK, descriptor: tampered });
    const result = await provider.discover({ query: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN_SOURCE");
  });
});

describe("Europe PMC transport & status error mapping", () => {
  it("maps a blocked redirect / connection failure to SOURCE_UNAVAILABLE", async () => {
    const result = await discoverWith({ throwKind: "redirect" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SOURCE_UNAVAILABLE");
  });

  it("maps an aborted request to TIMEOUT", async () => {
    const result = await discoverWith({ throwKind: "abort" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TIMEOUT");
  });

  it("maps 429 to RATE_LIMITED and keeps Retry-After in safe detail", async () => {
    const result = await discoverWith({
      status: 429,
      headers: { "retry-after": "120" },
      bodyText: "{}",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RATE_LIMITED");
    expect(result.error.retryable).toBe(true);
    expect(result.error.detail).toContain("retry-after 120");
  });

  it("maps 5xx to SOURCE_UNAVAILABLE", async () => {
    const result = await discoverWith({ status: 503, bodyText: "{}" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SOURCE_UNAVAILABLE");
  });

  it("rejects a non-JSON content type with MALFORMED_RESPONSE", async () => {
    const result = await discoverWith({ contentType: "text/html", bodyText: "<html></html>" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("rejects invalid JSON with MALFORMED_RESPONSE", async () => {
    const result = await discoverWith({ bodyText: "not json {" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("rejects a non-array resultList.result with MALFORMED_RESPONSE", async () => {
    const result = await discoverWith({
      bodyText: JSON.stringify({ resultList: { result: "oops" } }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("treats a well-formed empty page as a terminal, non-error result", async () => {
    const result = await discoverWith({ bodyText: JSON.stringify({ resultList: { result: [] } }) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toEqual([]);
    expect(result.value.nextCursor).toBeNull();
  });

  it("rejects an oversized response with MALFORMED_RESPONSE", async () => {
    const result = await discoverWith({ streamBytes: 5000 }, { maxBytes: 1000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("never leaks a secret from response headers into the error", async () => {
    const result = await discoverWith({
      status: 500,
      headers: { authorization: "Bearer SUPERSECRET", "retry-after": "5" },
      bodyText: "{}",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result.error.toJSON());
    expect(serialized).not.toContain("SUPERSECRET");
  });
});
