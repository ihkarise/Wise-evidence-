/**
 * PubMed connector — HTTP security & error-mapping tests (M7.7; docs/16). All
 * offline via an injected fake fetch. Proves the host/HTTPS/redirect/size/
 * content-type policy, the mapping of transport/HTTP failures onto typed,
 * secret-free discovery errors, and safe handling of hostile metadata.
 */
import { describe, it, expect } from "vitest";
import { PubMedDiscoveryProvider, PUBMED_SOURCE_DESCRIPTOR } from "./provider.js";
import {
  makeFakeFetch,
  makePubMedFixtureFetch,
  esearchBody,
  SUMMARY_HOSTILE,
  type FakeResponseSpec,
} from "./fixtures.js";
import { assertUrlAllowed } from "../host-policy.js";
import { DiscoveryError } from "../errors.js";
import type { PubMedDiscoveryProviderOptions } from "./provider.js";
import type { SourceDescriptor } from "../descriptor.js";
import type { DiscoveryResult, DiscoveryPage } from "../types.js";

const CLOCK = () => "2026-02-02T00:00:00.000Z";

/** A provider whose fake fetch always returns `spec` (the failure hits ESearch). */
function discoverWith(
  spec: FakeResponseSpec,
  overrides: Partial<Omit<PubMedDiscoveryProviderOptions, "fetch">> = {},
): Promise<DiscoveryResult<DiscoveryPage>> {
  const { fetch } = makeFakeFetch(() => spec);
  const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK, ...overrides });
  return provider.discover({ query: "homeopathy" });
}

describe("PubMed host / URL policy (defense in depth)", () => {
  it("the descriptor pins eutils.ncbi.nlm.nih.gov over https, no local network, no API key", () => {
    expect(PUBMED_SOURCE_DESCRIPTOR.allowedHosts).toEqual(["eutils.ncbi.nlm.nih.gov"]);
    expect(PUBMED_SOURCE_DESCRIPTOR.requireHttps).toBe(true);
    expect(PUBMED_SOURCE_DESCRIPTOR.allowLocalNetwork).toBe(false);
    // JSON-only scope: PubMed does not supply abstracts (no XML/EFetch).
    expect(PUBMED_SOURCE_DESCRIPTOR.capabilities.providesAbstracts).toBe(false);
    for (const key of Object.keys(PUBMED_SOURCE_DESCRIPTOR)) {
      expect(key).not.toMatch(/secret|api[-_]?key|token|password|credential/i);
    }
  });

  it("rejects http, arbitrary hosts, and loopback against the PubMed descriptor", () => {
    const d = PUBMED_SOURCE_DESCRIPTOR;
    const path = "/entrez/eutils/esearch.fcgi";
    expect(() => assertUrlAllowed(`http://eutils.ncbi.nlm.nih.gov${path}`, d)).toThrow(
      DiscoveryError,
    );
    expect(() => assertUrlAllowed(`https://evil.example.com${path}`, d)).toThrow(DiscoveryError);
    expect(() => assertUrlAllowed("https://127.0.0.1/x", d)).toThrow(DiscoveryError);
    expect(assertUrlAllowed(`https://eutils.ncbi.nlm.nih.gov${path}?term=x`, d).hostname).toBe(
      "eutils.ncbi.nlm.nih.gov",
    );
  });

  it("fails closed with FORBIDDEN_SOURCE if the descriptor does not allow the request host", async () => {
    const tampered: SourceDescriptor = {
      ...PUBMED_SOURCE_DESCRIPTOR,
      allowedHosts: ["evil.example.com"],
    };
    const { fetch } = makePubMedFixtureFetch({ pages: [] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK, descriptor: tampered });
    const result = await provider.discover({ query: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN_SOURCE");
  });
});

describe("PubMed transport & status error mapping", () => {
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

  it("rejects a response with no esearchresult object as MALFORMED_RESPONSE", async () => {
    const result = await discoverWith({ bodyText: JSON.stringify({ header: {} }) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("rejects a non-array idlist with MALFORMED_RESPONSE", async () => {
    const result = await discoverWith({
      bodyText: JSON.stringify({ esearchresult: { idlist: "oops" } }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("rejects a missing ESummary result object with MALFORMED_RESPONSE", async () => {
    const { fetch } = makeFakeFetch(
      (url) =>
        url.includes("esearch")
          ? { bodyText: esearchBody(["36000001"], 1, 0) }
          : { bodyText: JSON.stringify({ header: {} }) }, // no `result`
    );
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
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

describe("PubMed hostile metadata handling", () => {
  it("keeps hostile title/journal/author as inert sanitized text (never markup, never operators executed)", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [[SUMMARY_HOSTILE]] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.value.items[0];
    expect(item).toBeDefined();
    // Fields are preserved as plain text; the connector renders nothing and the
    // sanitizer strips control characters. The values remain strings only.
    expect(typeof item?.title).toBe("string");
    expect(typeof item?.journal).toBe("string");
    expect(item?.authors[0]).toContain("Evil");
    // Normalization succeeds and produces a normalized (identity) title.
    const normalized = provider.normalize(item!);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.canonicalDoi).toBe("10.0000/wise.pubmed.hostile");
  });
});
