import { describe, it, expect } from "vitest";
import { MockMetadataProvider } from "./mock.js";

describe("MockMetadataProvider", () => {
  const provider = new MockMetadataProvider();

  it("returns sanitized metadata for a known fixture (any DOI form)", async () => {
    const result = await provider.fetchByDoi("https://doi.org/10.0000/wise.mock.positive");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.doi).toBe("10.0000/wise.mock.positive");
    expect(result.metadata.title).toContain("randomized");
    expect(result.metadata.authors).toHaveLength(2);
    expect(result.metadata.provider).toBe("mock");
  });

  it("returns not-found for an unknown DOI", async () => {
    expect(await provider.fetchByDoi("10.0000/wise.mock.unknown")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("returns invalid-doi for a malformed DOI", async () => {
    expect(await provider.fetchByDoi("nope")).toEqual({ ok: false, reason: "invalid-doi" });
  });

  it("supports custom fixtures", async () => {
    const custom = new MockMetadataProvider({
      "10.1111/custom": { title: "Custom", authors: ["A. Person"] },
    });
    const r = await custom.fetchByDoi("10.1111/custom");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metadata.title).toBe("Custom");
  });
});
