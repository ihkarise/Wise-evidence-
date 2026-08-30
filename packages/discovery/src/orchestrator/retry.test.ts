import { describe, it, expect } from "vitest";
import { withRetry, parseRetryAfterMs } from "./retry.js";
import { DiscoveryError, type DiscoveryErrorCode } from "../errors.js";
import type { DiscoveryResult } from "../types.js";

const noSleep = () => Promise.resolve();
const fixedRng = () => 0;

function fail(code: DiscoveryErrorCode): DiscoveryResult<number> {
  return { ok: false, error: new DiscoveryError(code, "x") };
}

describe("withRetry", () => {
  it("returns immediately on success with zero retries", async () => {
    let calls = 0;
    const { result, retries } = await withRetry(
      () => {
        calls += 1;
        return Promise.resolve<DiscoveryResult<number>>({ ok: true, value: 42 });
      },
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, sleep: noSleep, rng: fixedRng },
    );
    expect(result.ok).toBe(true);
    expect(retries).toBe(0);
    expect(calls).toBe(1);
  });

  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const { result, retries } = await withRetry(
      () => {
        calls += 1;
        return Promise.resolve<DiscoveryResult<number>>(
          calls < 3 ? fail("RATE_LIMITED") : { ok: true, value: 7 },
        );
      },
      { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 10, sleep: noSleep, rng: fixedRng },
    );
    expect(result.ok).toBe(true);
    expect(retries).toBe(2);
    expect(calls).toBe(3);
  });

  it("does NOT retry non-retryable failures (malformed/invalid/forbidden)", async () => {
    for (const code of ["MALFORMED_RESPONSE", "INVALID_IDENTIFIER", "FORBIDDEN_SOURCE"] as const) {
      let calls = 0;
      const { retries } = await withRetry(
        () => {
          calls += 1;
          return Promise.resolve(fail(code));
        },
        { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 10, sleep: noSleep, rng: fixedRng },
      );
      expect(calls).toBe(1);
      expect(retries).toBe(0);
    }
  });

  it("stops after maxRetries (bounded, never infinite)", async () => {
    let calls = 0;
    const { result, retries } = await withRetry(
      () => {
        calls += 1;
        return Promise.resolve(fail("TIMEOUT"));
      },
      { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10, sleep: noSleep, rng: fixedRng },
    );
    expect(result.ok).toBe(false);
    expect(retries).toBe(2);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("respects a canRetry budget gate", async () => {
    let calls = 0;
    const { retries } = await withRetry(
      () => {
        calls += 1;
        return Promise.resolve(fail("SOURCE_UNAVAILABLE"));
      },
      {
        maxRetries: 5,
        baseDelayMs: 1,
        maxDelayMs: 10,
        sleep: noSleep,
        rng: fixedRng,
        canRetry: () => false,
      },
    );
    expect(calls).toBe(1);
    expect(retries).toBe(0);
  });

  it("honours a bounded Retry-After hint", () => {
    expect(parseRetryAfterMs("HTTP 429; retry-after 120", 600_000)).toBe(120_000);
    expect(parseRetryAfterMs("HTTP 429; retry-after 999999", 5000)).toBe(5000); // capped
    expect(parseRetryAfterMs("HTTP 500", 10_000)).toBeNull();
    expect(parseRetryAfterMs(null, 10_000)).toBeNull();
  });
});
