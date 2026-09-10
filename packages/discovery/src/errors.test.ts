import { describe, it, expect } from "vitest";
import { DiscoveryError, isDiscoveryError, redactMessage } from "./errors.js";

describe("DiscoveryError", () => {
  it("marks transient codes retryable and others not", () => {
    expect(new DiscoveryError("RATE_LIMITED", "x").retryable).toBe(true);
    expect(new DiscoveryError("TIMEOUT", "x").retryable).toBe(true);
    expect(new DiscoveryError("SOURCE_UNAVAILABLE", "x").retryable).toBe(true);
    expect(new DiscoveryError("INVALID_IDENTIFIER", "x").retryable).toBe(false);
    expect(new DiscoveryError("NOT_CONFIGURED", "x").retryable).toBe(false);
  });

  it("redacts secret-shaped text from message and detail", () => {
    const err = new DiscoveryError("FETCH_FAILED", "Authorization: Bearer abc123", {
      detail: "x-api-key=zzz",
    });
    expect(err.message).not.toContain("abc123");
    expect(err.detail).not.toContain("zzz");
  });

  it("keeps a safe message intact", () => {
    expect(redactMessage("host 'crossref.org' is not allowed")).toBe(
      "host 'crossref.org' is not allowed",
    );
  });

  it("serializes to a safe JSON view without a stack or cause", () => {
    const err = new DiscoveryError("MALFORMED_RESPONSE", "bad", {
      source: "mock",
      cause: new Error("inner"),
    });
    const json = err.toJSON();
    expect(json).toEqual({
      name: "DiscoveryError",
      code: "MALFORMED_RESPONSE",
      message: "bad",
      source: "mock",
      detail: null,
      retryable: false,
    });
    expect(Object.keys(json)).not.toContain("stack");
  });

  it("is recognizable via the type guard", () => {
    expect(isDiscoveryError(new DiscoveryError("TIMEOUT", "x"))).toBe(true);
    expect(isDiscoveryError(new Error("x"))).toBe(false);
  });
});
