/**
 * Security-boundary tests for the source host/URL policy (M7.1; docs/16 §8).
 * These prove the M7.1 security acceptance criteria: an arbitrary host is not
 * silently accepted, the HTTPS policy is represented and enforced, and no
 * generic "fetch any URL" capability exists (the gate returns/throws, it never
 * fetches).
 */
import { describe, it, expect } from "vitest";
import { assertUrlAllowed, isHostAllowed, isPrivateHost, isUrlAllowed } from "./host-policy.js";
import { DiscoveryError } from "./errors.js";
import type { SourceDescriptor } from "./descriptor.js";

const CROSSREF_LIKE: SourceDescriptor = {
  key: "crossref-like",
  displayName: "Crossref-like (test descriptor)",
  providerType: "CROSSREF",
  allowedHosts: ["crossref.org"],
  requireHttps: true,
  allowLocalNetwork: false,
  timeoutMs: 10_000,
  maxResponseBytes: 5_000_000,
  maxItemsPerRequest: 20,
  maxCandidatesPerRun: 100,
  rateLimit: { requestsPerSecond: 1, burst: 2 },
  supportedIdentifierTypes: ["DOI"],
  capabilities: { canDiscover: true, canFetch: true, canPaginate: true, providesAbstracts: true },
};

const LOCAL_OK: SourceDescriptor = {
  ...CROSSREF_LIKE,
  allowedHosts: ["localhost"],
  allowLocalNetwork: true,
};

describe("isPrivateHost", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.1.1",
    "::1",
    "svc.internal",
  ])("flags %s as private", (host) => expect(isPrivateHost(host)).toBe(true));
  it.each(["crossref.org", "api.crossref.org", "8.8.8.8", "example.com"])(
    "treats %s as public",
    (host) => expect(isPrivateHost(host)).toBe(false),
  );
});

describe("isHostAllowed", () => {
  it("matches exact hosts and sub-domains, case-insensitively", () => {
    expect(isHostAllowed("crossref.org", ["crossref.org"])).toBe(true);
    expect(isHostAllowed("api.Crossref.org", ["crossref.org"])).toBe(true);
    expect(isHostAllowed("evil-crossref.org", ["crossref.org"])).toBe(false);
    expect(isHostAllowed("crossref.org.evil.com", ["crossref.org"])).toBe(false);
  });
  it("matches nothing against an empty allow-list", () => {
    expect(isHostAllowed("crossref.org", [])).toBe(false);
  });
});

describe("assertUrlAllowed", () => {
  it("accepts an allow-listed https host and returns the parsed URL", () => {
    const url = assertUrlAllowed("https://api.crossref.org/works?query=x", CROSSREF_LIKE);
    expect(url.hostname).toBe("api.crossref.org");
  });

  it("rejects an arbitrary (non-allow-listed) host with FORBIDDEN_SOURCE", () => {
    expect(() => assertUrlAllowed("https://evil.example.com/works", CROSSREF_LIKE)).toThrow(
      DiscoveryError,
    );
    expect(isUrlAllowed("https://evil.example.com/works", CROSSREF_LIKE)).toBe(false);
  });

  it("rejects http when the descriptor requires https", () => {
    let code: string | undefined;
    try {
      assertUrlAllowed("http://api.crossref.org/works", CROSSREF_LIKE);
    } catch (e) {
      code = (e as DiscoveryError).code;
    }
    expect(code).toBe("FORBIDDEN_SOURCE");
  });

  it("rejects non-http(s) schemes (e.g. file:) ", () => {
    expect(() => assertUrlAllowed("file:///etc/passwd", CROSSREF_LIKE)).toThrow(DiscoveryError);
  });

  it("rejects URLs that embed credentials", () => {
    expect(() => assertUrlAllowed("https://user:pass@api.crossref.org/x", CROSSREF_LIKE)).toThrow(
      DiscoveryError,
    );
  });

  it("rejects a private/loopback host unless explicitly opted in", () => {
    expect(isUrlAllowed("https://localhost/works", CROSSREF_LIKE)).toBe(false);
    // Opted-in local descriptor may reach localhost over http.
    expect(isUrlAllowed("http://localhost:8080/works", LOCAL_OK)).toBe(true);
  });

  it("never leaks a secret in the error message", () => {
    let message = "";
    try {
      assertUrlAllowed("https://evil.example.com/?apikey=SUPERSECRET", CROSSREF_LIKE);
    } catch (e) {
      message = (e as DiscoveryError).message;
    }
    expect(message).not.toContain("SUPERSECRET");
  });
});
