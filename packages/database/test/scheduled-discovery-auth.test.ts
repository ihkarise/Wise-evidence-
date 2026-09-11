/**
 * M7.9 — trusted scheduled-invocation authorization + configuration (pure).
 *
 * Deterministic, offline unit tests for the security-critical decision logic the
 * /api/internal/discovery/run endpoint delegates to: constant-time secret
 * verification, bearer parsing, fail-closed ordering, and (non-secret)
 * provider/query resolution. No database, no network, no Astro.
 */
import { describe, it, expect } from "vitest";
import {
  authorizeScheduledInvocation,
  parseBearerToken,
  verifySharedSecret,
  resolveScheduledQuery,
  resolveScheduledProvider,
  SCHEDULED_DISCOVERY_DEFAULT_QUERY,
  SCHEDULED_DISCOVERY_DEFAULT_PROVIDER,
} from "../src/index.js";

describe("parseBearerToken", () => {
  it("extracts the credential from a well-formed header (case-insensitive)", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
    expect(parseBearerToken("bearer abc123")).toBe("abc123");
    expect(parseBearerToken("BEARER   spaced-token")).toBe("spaced-token");
    expect(parseBearerToken("  Bearer trimmed  ")).toBe("trimmed");
  });

  it("returns null for missing, empty, or non-bearer headers", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "Basic abc",
      "Token abc",
      "Bearer",
      "Bearer   ",
    ]) {
      expect(parseBearerToken(bad)).toBeNull();
    }
  });
});

describe("verifySharedSecret — constant-time, length-guarded", () => {
  it("accepts an exact match only", () => {
    expect(verifySharedSecret("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("rejects a wrong value of the same length, and any length mismatch", () => {
    expect(verifySharedSecret("s3cret-value", "s3cret-valuX")).toBe(false);
    expect(verifySharedSecret("short", "a-much-longer-secret")).toBe(false);
    expect(verifySharedSecret("a-much-longer-secret", "short")).toBe(false);
  });

  it("rejects when either side is null/empty (never throws)", () => {
    expect(verifySharedSecret(null, "x")).toBe(false);
    expect(verifySharedSecret("x", null)).toBe(false);
    expect(verifySharedSecret("", "")).toBe(false);
    expect(verifySharedSecret(undefined, undefined)).toBe(false);
  });
});

describe("authorizeScheduledInvocation — fail-closed ordering", () => {
  const TOKEN = "the-configured-secret";
  const ACTOR = "10000000-0000-0000-0000-000000000002";

  it("is DISABLED (404) when no token is configured — never reveals the route", () => {
    const r = authorizeScheduledInvocation("Bearer anything", {
      expectedToken: "",
      actorId: ACTOR,
      dbConfigured: true,
    });
    expect(r).toEqual({ ok: false, status: 404, message: "not found" });
  });

  it("returns 401 for a missing or wrong bearer token", () => {
    const base = { expectedToken: TOKEN, actorId: ACTOR, dbConfigured: true };
    expect(authorizeScheduledInvocation(null, base).ok).toBe(false);
    expect(authorizeScheduledInvocation(null, base)).toMatchObject({ status: 401 });
    expect(authorizeScheduledInvocation("Bearer wrong", base)).toMatchObject({ status: 401 });
  });

  it("returns 503 when authenticated but the server is not fully configured", () => {
    expect(
      authorizeScheduledInvocation(`Bearer ${TOKEN}`, {
        expectedToken: TOKEN,
        actorId: ACTOR,
        dbConfigured: false,
      }),
    ).toMatchObject({ status: 503 });
    expect(
      authorizeScheduledInvocation(`Bearer ${TOKEN}`, {
        expectedToken: TOKEN,
        actorId: "",
        dbConfigured: true,
      }),
    ).toMatchObject({ status: 503 });
  });

  it("authorizes only a correct token with full configuration", () => {
    expect(
      authorizeScheduledInvocation(`Bearer ${TOKEN}`, {
        expectedToken: TOKEN,
        actorId: ACTOR,
        dbConfigured: true,
      }),
    ).toEqual({ ok: true });
  });

  it("never leaks the expected token in any result message", () => {
    for (const header of [null, "Bearer wrong", `Bearer ${TOKEN}`]) {
      const r = authorizeScheduledInvocation(header, {
        expectedToken: TOKEN,
        actorId: "",
        dbConfigured: true,
      });
      expect(JSON.stringify(r)).not.toContain(TOKEN);
    }
  });
});

describe("resolveScheduledQuery / resolveScheduledProvider", () => {
  it("query defaults to the platform domain and honours a configured value", () => {
    expect(resolveScheduledQuery(null)).toBe(SCHEDULED_DISCOVERY_DEFAULT_QUERY);
    expect(resolveScheduledQuery("   ")).toBe(SCHEDULED_DISCOVERY_DEFAULT_QUERY);
    expect(resolveScheduledQuery("arnica montana")).toBe("arnica montana");
  });

  it("provider prefers the request, then config, then MOCK", () => {
    expect(resolveScheduledProvider("CROSSREF", "PUBMED")).toBe("CROSSREF");
    expect(resolveScheduledProvider(null, "PUBMED")).toBe("PUBMED");
    expect(resolveScheduledProvider("", "")).toBe(SCHEDULED_DISCOVERY_DEFAULT_PROVIDER);
    expect(resolveScheduledProvider(undefined, undefined)).toBe("MOCK");
  });
});
