/**
 * Report rendering (M6.1 master prompt §36, §37).
 *
 * Pure formatting: turns measurements, aggregates, and catalogue verifications
 * into the Markdown tables §37 specifies and a machine-readable JSON summary. It
 * writes NOTHING to disk (the live test does that) and it NEVER invents a value —
 * a null measurement renders as `NULL`, never `0` or a guessed number.
 */
import type { ModelVerification } from "./catalogue.js";
import type { ModelAggregate, TaskMeasurement } from "./runner.js";
import type { WorkloadMode } from "./workloads.js";

/** Render `null` as `NULL`; a number with bounded precision; a string as-is. */
function cell(value: number | string | null, digits = 6): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(digits);
  }
  return value;
}

/** The per (model × task) result table (§37, table 1). */
export function renderMeasurementTable(measurements: readonly TaskMeasurement[]): string {
  const header =
    "| Model | Task | Input Tokens | Output Tokens | Total Tokens | Latency (ms) | Retries | Valid | Cost |\n" +
    "|-------|------|--------------|---------------|--------------|--------------|---------|-------|------|";
  const rows = measurements.map((m) => {
    const valid =
      m.providerStatus === "provider-error" ? `ERR:${m.errorReason}` : String(m.validOutput);
    return `| ${m.model} | ${m.task} | ${cell(m.inputTokens)} | ${cell(m.outputTokens)} | ${cell(
      m.totalTokens,
    )} | ${cell(m.latencyMs, 0)} | ${m.retries} | ${valid} | ${cell(m.costEstimate)} |`;
  });
  return [header, ...rows].join("\n");
}

/** The per-model aggregate table (§37, table 2). */
export function renderAggregateTable(aggregates: readonly ModelAggregate[]): string {
  const header =
    "| Model | Tasks | Total Tokens | Total Cost | Avg Latency (ms) | Success Rate | Valid Rate |\n" +
    "|-------|-------|--------------|------------|------------------|--------------|------------|";
  const rows = aggregates.map(
    (a) =>
      `| ${a.model} | ${a.taskCount} | ${cell(a.totalTokens)} | ${cell(a.totalCost)} | ${cell(
        a.avgLatencyMs,
        0,
      )} | ${pct(a.successRate)} | ${pct(a.validRate)} |`,
  );
  return [header, ...rows].join("\n");
}

/** The model-catalogue verification table (§5, §6). */
export function renderCatalogueTable(verifications: readonly ModelVerification[]): string {
  const header =
    "| Model | Available | Input $/MTok | Output $/MTok | Pricing Verified | Note |\n" +
    "|-------|-----------|--------------|---------------|------------------|------|";
  const rows = verifications.map(
    (v) =>
      `| ${v.id} | ${v.available} | ${cell(v.livePricing?.inputPerMTok ?? null)} | ${cell(
        v.livePricing?.outputPerMTok ?? null,
      )} | ${v.pricingVerified} | ${v.note} |`,
  );
  return [header, ...rows].join("\n");
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

/** A machine-readable summary for one workload run of one model. */
export interface WorkloadReport {
  readonly workload: WorkloadMode;
  readonly aggregate: ModelAggregate;
  readonly measurements: readonly TaskMeasurement[];
}

/** The full benchmark report object written alongside the Markdown (§36). */
export interface BenchmarkReport {
  readonly generatedAt: string;
  readonly baseUrlHost: string;
  readonly studyId: string;
  readonly catalogueOk: boolean;
  readonly catalogueError: string | null;
  readonly verifications: readonly ModelVerification[];
  readonly runs: readonly WorkloadReport[];
}
