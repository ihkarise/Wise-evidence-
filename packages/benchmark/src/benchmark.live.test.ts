/**
 * The LIVE OpenRouter benchmark (master prompt §28, §29, §36, §37).
 *
 * This is the operational gate. It runs ONLY when explicitly enabled with a
 * server-side key in a network-permitted environment — it is `describe.runIf`-
 * guarded, so CI and every offline run SKIP it (no key, no network, no cost). It
 * therefore never fabricates results: if it does not run, there simply are none.
 *
 * Enable it with server-side secrets ONLY (never pasted into chat, never a
 * PUBLIC_* var):
 *
 *   BENCH_LIVE=1 \
 *   AI_BASE_URL=https://openrouter.ai/api/v1 \
 *   AI_API_KEY=<server-side secret> \
 *   BENCH_MODELS="deepseek/deepseek-v4-flash-latest,qwen/qwen3.5-35b-a3b,google/gemini-3.7-flash" \
 *   AI_PRICE_INPUT_PER_MTOK=<verified> AI_PRICE_OUTPUT_PER_MTOK=<verified> \
 *   pnpm --filter @wise-evidence/benchmark exec vitest run src/benchmark.live.test.ts
 *
 * It first verifies the live model catalogue and pricing (§28); it uses the fewest
 * calls needed (§29): each candidate runs FULL once, and ESSENTIAL is derived from
 * the FULL measurements rather than re-called. It writes a timestamped JSON +
 * Markdown report under docs/reports/benchmark/ for the human write-up.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { OpenAICompatibleProvider, parsePricing, type FetchLike } from "@wise-evidence/ai";
import { fetchCatalogue, verifyCandidates, type CatalogueFetch } from "./catalogue.js";
import { parseCandidates } from "./models.js";
import { aggregate, runModelWorkload } from "./runner.js";
import {
  renderAggregateTable,
  renderCatalogueTable,
  renderMeasurementTable,
  type BenchmarkReport,
  type WorkloadReport,
} from "./report.js";
import { ESSENTIAL_TASKS, FULL_TASKS } from "./workloads.js";

const env = process.env;
const LIVE = env.BENCH_LIVE === "1" && !!env.AI_API_KEY && !!env.AI_BASE_URL;

const REPORT_DIR = fileURLToPath(new URL("../../../docs/reports/benchmark/", import.meta.url));

describe.runIf(LIVE)("LIVE OpenRouter benchmark", () => {
  it(
    "verifies the catalogue, runs FULL + ESSENTIAL, and writes a report",
    async () => {
      const baseUrl = env.AI_BASE_URL!;
      const apiKey = env.AI_API_KEY!;
      const fetchLike = globalThis.fetch as unknown as FetchLike;
      const catFetch = globalThis.fetch as unknown as CatalogueFetch;
      const pricing = parsePricing(env.AI_PRICE_INPUT_PER_MTOK, env.AI_PRICE_OUTPUT_PER_MTOK);

      // 1. Verify the live model catalogue + pricing before spending anything (§28).
      const catalogue = await fetchCatalogue(catFetch, baseUrl, apiKey);
      const candidates = parseCandidates(env, pricing);
      const verifications = verifyCandidates(
        candidates.map((c) => c.id),
        catalogue,
      );

      // 2. For each AVAILABLE model, run FULL once; derive ESSENTIAL from it (§29).
      const runs: WorkloadReport[] = [];
      for (const verification of verifications) {
        if (!verification.available) continue;
        const provider = new OpenAICompatibleProvider({
          fetch: fetchLike,
          baseUrl,
          apiKey,
          model: verification.id,
          providerId: "openrouter",
        });
        const modelPricing = verification.livePricing ?? pricing;
        const full = await runModelWorkload(provider, FULL_TASKS, {
          pricing: modelPricing,
          maxOutputTokens: 1024,
          timeoutMs: 60_000,
          maxRetries: 1,
        });
        const essential = full.filter((m) =>
          (ESSENTIAL_TASKS as readonly string[]).includes(m.task),
        );
        runs.push({
          workload: "FULL",
          aggregate: aggregate(verification.id, full),
          measurements: full,
        });
        runs.push({
          workload: "ESSENTIAL",
          aggregate: aggregate(verification.id, essential),
          measurements: essential,
        });
      }

      // 3. Persist a machine-readable + human-readable report (§36).
      const report: BenchmarkReport = {
        generatedAt: new Date().toISOString(),
        baseUrlHost: safeHost(baseUrl),
        studyId: "20000000-0000-0000-0000-000000000001",
        catalogueOk: catalogue.ok,
        catalogueError: catalogue.error,
        verifications,
        runs,
      };
      await writeReport(report);

      // The benchmark records measurements; it asserts only that it produced them.
      expect(catalogue.ok).toBe(true);
      expect(runs.length).toBeGreaterThan(0);
    },
    5 * 60_000,
  );
});

async function writeReport(report: BenchmarkReport): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  await writeFile(`${REPORT_DIR}${stamp}.json`, JSON.stringify(report, null, 2), "utf8");

  const md: string[] = [
    `# Live benchmark — ${report.generatedAt}`,
    "",
    `Endpoint host: ${report.baseUrlHost} · Study: ${report.studyId}`,
    "",
    "## Catalogue verification",
    renderCatalogueTable(report.verifications),
    "",
  ];
  for (const run of report.runs) {
    md.push(`## ${run.aggregate.model} — ${run.workload}`, "");
    md.push(renderMeasurementTable(run.measurements), "");
    md.push(renderAggregateTable([run.aggregate]), "");
  }
  await writeFile(`${REPORT_DIR}${stamp}.md`, md.join("\n"), "utf8");
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
