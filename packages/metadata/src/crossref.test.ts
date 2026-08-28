import { describe, it, expect } from "vitest";
import { CrossrefMetadataProvider, type FetchLike, type FetchLikeResponse } from "./crossref.js";

/** Build a fake JSON response, optionally with a size-capped stream body. */
function jsonResponse(status: number, payload: unknown, opts?: { stream?: boolean }): FetchLikeResponse {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text);
  return {
    ok: status >= 200 && status < 300,
    status,
    body: opts?.stream
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        })
      : null,
    text: () => Promise.resolve(text),
  };
}

/** A well-formed Crossref `message` for a DOI. */
function crossrefMessage(doi: string, overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    message: {
      DOI: doi,
      title: ["A Trial Of Something"],
      "container-title": ["Journal of Example"],
      publisher: "Example Press",
      author: [
        { given: "Jane", family: "Smith" },
        { given: "Bob", family: "Jones" },
      ],
      issued: { "date-parts": [[2021, 3, 1]] },
      abstract: "<jats:p>Structured <b>abstract</b>.</jats:p>",
      URL: "https://doi.org/" + doi,
      ...overrides,
    },
  };
}

function providerWith(fetchImpl: FetchLike, maxBytes?: number) {
  return new CrossrefMetadataProvider({ fetch: fetchImpl, timeoutMs: 50, maxBytes });
}

describe("CrossrefMetadataProvider", () => {
  const DOI = "10.1234/abcd";

  it("returns invalid-doi without fetching for a bad DOI", async () => {
    let called = false;
    const provider = providerWith(() => {
      called = true;
      return Promise.resolve(jsonResponse(200, {}));
    });
    const result = await provider.fetchByDoi("not-a-doi");
    expect(result).toEqual({ ok: false, reason: "invalid-doi" });
    expect(called).toBe(false);
  });

  it("pins the host to api.crossref.org and only puts the DOI in the path", async () => {
    let seenUrl = "";
    const provider = providerWith((url) => {
      seenUrl = url;
      return Promise.resolve(jsonResponse(200, crossrefMessage(DOI)));
    });
    await provider.fetchByDoi("https://doi.org/10.1234/abcd");
    expect(seenUrl.startsWith("https://api.crossref.org/works/")).toBe(true);
    expect(seenUrl).toContain(encodeURIComponent(DOI));
  });

  it("normalizes and sanitizes a successful response", async () => {
    const provider = providerWith(() =>
      Promise.resolve(jsonResponse(200, crossrefMessage(DOI))),
    );
    const result = await provider.fetchByDoi(DOI);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const m = result.metadata;
    expect(m.doi).toBe(DOI);
    expect(m.title).toBe("A Trial Of Something");
    expect(m.journalTitle).toBe("Journal of Example");
    expect(m.authors.map((a) => a.displayName)).toEqual(["Jane Smith", "Bob Jones"]);
    expect(m.authors[0]?.order).toBe(0);
    expect(m.publicationDate).toBe("2021-03-01");
    // JATS markup is reduced to text, never rendered (tag boundaries → spaces).
    expect(m.abstract).toContain("Structured abstract");
    expect(m.abstract).not.toContain("<");
    expect(m.provider).toBe("crossref");
  });

  it("maps HTTP 404 to not-found", async () => {
    const provider = providerWith(() => Promise.resolve(jsonResponse(404, { message: "no" })));
    expect(await provider.fetchByDoi(DOI)).toEqual({ ok: false, reason: "not-found" });
  });

  it("maps other non-2xx to provider-error", async () => {
    const provider = providerWith(() => Promise.resolve(jsonResponse(500, "boom")));
    const r = await provider.fetchByDoi(DOI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("provider-error");
  });

  it("maps malformed JSON to provider-error", async () => {
    const provider = providerWith(() => Promise.resolve(jsonResponse(200, "{ not json")));
    const r = await provider.fetchByDoi(DOI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("provider-error");
  });

  it("rejects a DOI mismatch as invalid-metadata (untrusted output)", async () => {
    const provider = providerWith(() =>
      Promise.resolve(jsonResponse(200, crossrefMessage("10.9999/somethingelse"))),
    );
    const r = await provider.fetchByDoi(DOI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-metadata");
  });

  it("maps an aborted (timeout) fetch to timeout", async () => {
    const provider = providerWith((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    expect(await provider.fetchByDoi(DOI)).toEqual({ ok: false, reason: "timeout" });
  });

  it("maps a transport failure to network", async () => {
    const provider = providerWith(() => Promise.reject(new Error("ECONNRESET")));
    expect(await provider.fetchByDoi(DOI)).toEqual({ ok: false, reason: "network" });
  });

  it("rejects an oversized streamed response as too-large", async () => {
    const big = { message: { DOI, note: "x".repeat(10000) } };
    const provider = providerWith(
      () => Promise.resolve(jsonResponse(200, big, { stream: true })),
      500, // 500-byte cap
    );
    expect(await provider.fetchByDoi(DOI)).toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects an oversized non-streamed response as too-large", async () => {
    const big = { message: { DOI, note: "x".repeat(10000) } };
    const provider = providerWith(() => Promise.resolve(jsonResponse(200, big)), 500);
    expect(await provider.fetchByDoi(DOI)).toEqual({ ok: false, reason: "too-large" });
  });

  it("requests with redirect:error (no SSRF via redirects)", async () => {
    let seenInit: unknown;
    const provider = providerWith((_url, init) => {
      seenInit = init;
      return Promise.resolve(jsonResponse(200, crossrefMessage(DOI)));
    });
    await provider.fetchByDoi(DOI);
    expect((seenInit as { redirect?: string }).redirect).toBe("error");
  });
});
