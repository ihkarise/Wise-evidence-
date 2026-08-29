/**
 * Provider tests (docs/29 §21): the deterministic offline mock and the
 * OpenAI-compatible provider driven entirely by an INJECTED fetch — no live
 * network, no API key. Covers success parsing, usage capture, and every mapped
 * failure (rate limit, unavailable, unauthorized, malformed, timeout, too large),
 * and asserts the API key never leaks into an error message.
 */
import { describe, it, expect } from "vitest";
import { MockAIProvider } from "./mock.js";
import { OpenAICompatibleProvider, type FetchLike, type FetchLikeResponse } from "./openai.js";
import { AI_TASKS, AIProviderError, type AICompletionRequest } from "../types.js";
import { validateTaskOutput } from "../validation.js";

const req = (over: Partial<AICompletionRequest> = {}): AICompletionRequest => ({
  task: "outcome-classification",
  system: "SYSTEM",
  userContent: "<research_data>{}</research_data>",
  maxOutputTokens: 512,
  timeoutMs: 1000,
  ...over,
});

function okFetch(body: unknown): FetchLike {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    } as FetchLikeResponse);
}
function statusFetch(status: number): FetchLike {
  return () =>
    Promise.resolve({ ok: false, status, text: () => Promise.resolve("") } as FetchLikeResponse);
}

const SECRET = "sk-super-secret-key-1234567890";

describe("MockAIProvider", () => {
  it("is deterministic: same input → identical output", async () => {
    const p = new MockAIProvider();
    const a = await p.complete(req());
    const b = await p.complete(req());
    expect(a.rawText).toBe(b.rawText);
  });

  it("produces schema-valid output for every task", async () => {
    const p = new MockAIProvider();
    for (const task of AI_TASKS) {
      const res = await p.complete(req({ task }));
      const v = validateTaskOutput(task, res.rawText);
      expect(v.ok, `${task}: ${v.ok ? "" : v.error}`).toBe(true);
    }
  });

  it("reports fixture usage by default and null usage when disabled", async () => {
    const withUsage = await new MockAIProvider().complete(req());
    expect(withUsage.usage.inputTokens).not.toBeNull();
    expect(withUsage.usage.totalTokens).not.toBeNull();

    const noUsage = await new MockAIProvider({ reportUsage: false }).complete(req());
    expect(noUsage.usage.inputTokens).toBeNull();
    expect(noUsage.usage.outputTokens).toBeNull();
    expect(noUsage.usage.totalTokens).toBeNull();
  });

  it("exposes a stable modelId", () => {
    expect(new MockAIProvider().modelId).toBe("mock-1");
    expect(new MockAIProvider({ model: "mock-x" }).modelId).toBe("mock-x");
  });
});

describe("OpenAICompatibleProvider (injected fetch)", () => {
  const base = { baseUrl: "https://example.invalid/v1", apiKey: SECRET, model: "test-model" };

  it("parses a chat-completions envelope and captures usage", async () => {
    const p = new OpenAICompatibleProvider({
      ...base,
      fetch: okFetch({
        model: "served-model",
        choices: [
          {
            message: { content: '{"outcome":"POSITIVE","confidence":0.7}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      }),
    });
    const res = await p.complete(req());
    expect(res.rawText).toContain("POSITIVE");
    expect(res.model).toBe("served-model");
    expect(res.usage).toEqual({ inputTokens: 11, outputTokens: 5, totalTokens: 16 });
  });

  it("leaves usage null (never zero) when the provider omits it", async () => {
    const p = new OpenAICompatibleProvider({
      ...base,
      fetch: okFetch({ choices: [{ message: { content: "{}" } }] }),
    });
    const res = await p.complete(req());
    expect(res.usage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
  });

  it("maps HTTP statuses to typed reasons", async () => {
    const cases: Array<[number, string]> = [
      [429, "rate-limited"],
      [500, "unavailable"],
      [503, "unavailable"],
      [401, "unauthorized"],
      [403, "unauthorized"],
      [418, "bad-response"],
    ];
    for (const [status, reason] of cases) {
      const p = new OpenAICompatibleProvider({ ...base, fetch: statusFetch(status) });
      await expect(p.complete(req())).rejects.toMatchObject({ reason });
    }
  });

  it("rejects non-JSON and empty-choices envelopes as bad-response", async () => {
    const nonJson = new OpenAICompatibleProvider({ ...base, fetch: okFetch("not json") });
    await expect(nonJson.complete(req())).rejects.toMatchObject({ reason: "bad-response" });

    const noChoices = new OpenAICompatibleProvider({ ...base, fetch: okFetch({ choices: [] }) });
    await expect(noChoices.complete(req())).rejects.toMatchObject({ reason: "bad-response" });
  });

  it("aborts on timeout and maps to reason 'timeout'", async () => {
    const hangFetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    const p = new OpenAICompatibleProvider({ ...base, fetch: hangFetch, timeoutMs: 5 });
    await expect(p.complete(req())).rejects.toMatchObject({ reason: "timeout" });
  });

  it("rejects an oversized response body", async () => {
    const big = JSON.stringify({ choices: [{ message: { content: "x".repeat(5000) } }] });
    const p = new OpenAICompatibleProvider({ ...base, fetch: okFetch(big), maxBytes: 1024 });
    await expect(p.complete(req())).rejects.toMatchObject({ reason: "too-large" });
  });

  it("refuses to construct without required configuration", () => {
    expect(
      () =>
        new OpenAICompatibleProvider({ fetch: okFetch({}), baseUrl: "", apiKey: "", model: "" }),
    ).toThrow(AIProviderError);
  });

  it("never leaks the API key in an error message", async () => {
    const p = new OpenAICompatibleProvider({ ...base, fetch: statusFetch(401) });
    try {
      await p.complete(req());
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain(SECRET);
    }
  });
});
