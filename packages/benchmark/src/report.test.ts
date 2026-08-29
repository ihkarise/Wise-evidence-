/**
 * Report-rendering tests (master prompt §36, §37). NULL renders as `NULL`, never
 * `0`; tables carry the required columns.
 */
import { describe, it, expect } from "vitest";
import { renderMeasurementTable, renderAggregateTable, renderCatalogueTable } from "./report.js";
import type { TaskMeasurement, ModelAggregate } from "./runner.js";
import type { ModelVerification } from "./catalogue.js";

const okRow: TaskMeasurement = {
  model: "m",
  task: "research-summary",
  promptVersion: "v1",
  inputTokens: 120,
  outputTokens: 40,
  totalTokens: 160,
  latencyMs: 850,
  providerStatus: "ok",
  retries: 0,
  validOutput: true,
  validationDetail: null,
  costEstimate: 0.0000112,
  output: { summary: "x" },
  rawOutputSha256: "a".repeat(64),
  errorReason: null,
};

const nullRow: TaskMeasurement = {
  ...okRow,
  task: "outcome-classification",
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  latencyMs: null,
  costEstimate: null,
};

const errRow: TaskMeasurement = {
  ...nullRow,
  task: "evidence-quality",
  providerStatus: "provider-error",
  validOutput: null,
  errorReason: "unavailable",
};

describe("renderMeasurementTable", () => {
  const table = renderMeasurementTable([okRow, nullRow, errRow]);

  it("has the §37 header columns", () => {
    expect(table).toContain("| Model | Task | Input Tokens |");
    expect(table).toContain("Latency (ms)");
    expect(table).toContain("Retries");
  });

  it("renders unknown token/cost values as NULL, not 0", () => {
    const outcomeLine = table.split("\n").find((l) => l.includes("outcome-classification"))!;
    // input/output/total tokens, latency, and cost are all unknown → NULL.
    expect(outcomeLine).toContain("| outcome-classification | NULL | NULL | NULL | NULL |");
    expect(outcomeLine.endsWith("| NULL |")).toBe(true); // cost column
  });

  it("shows the provider error reason instead of a validity boolean", () => {
    const errLine = table.split("\n").find((l) => l.includes("evidence-quality"))!;
    expect(errLine).toContain("ERR:unavailable");
  });
});

describe("renderAggregateTable", () => {
  it("renders success/valid rates as percentages and NULL totals", () => {
    const agg: ModelAggregate = {
      model: "m",
      taskCount: 4,
      okCount: 4,
      validCount: 3,
      totalInputTokens: 400,
      totalOutputTokens: 120,
      totalTokens: 520,
      totalCost: null,
      avgLatencyMs: 700,
      successRate: 1,
      validRate: 0.75,
    };
    const table = renderAggregateTable([agg]);
    expect(table).toContain("100%");
    expect(table).toContain("75%");
    expect(table).toContain("NULL");
  });
});

describe("renderCatalogueTable", () => {
  it("renders availability, live pricing, and verification", () => {
    const vs: ModelVerification[] = [
      {
        id: "deepseek/deepseek-v4-flash-latest",
        available: true,
        livePricing: { inputPerMTok: 0.04, outputPerMTok: 0.08 },
        pricingVerified: true,
        note: "verified against live catalogue",
      },
      {
        id: "ghost/removed",
        available: false,
        livePricing: null,
        pricingVerified: false,
        note: "not found in live catalogue (do not substitute)",
      },
    ];
    const table = renderCatalogueTable(vs);
    expect(table).toContain("deepseek/deepseek-v4-flash-latest");
    expect(table).toContain("| false |");
    expect(table).toContain("not found");
  });
});
