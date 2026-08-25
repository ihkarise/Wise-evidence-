/**
 * M6.1 model benchmark harness (NOT a unit test).
 *
 * Benchmarks several OpenRouter (OpenAI-compatible) models over the six
 * WiseEvidence enrichment tasks on ONE DEMO study, using the EXISTING
 * OpenAICompatibleProvider — no new provider abstraction, no adapter change, no
 * schema change. It measures, per model × task: latency, reliability, provider-
 * reported token usage, structured-output validity, and cost (from operator-
 * supplied per-model pricing). The SAME source content / prompt / prompt-version /
 * settings are used for every model; the only variable is the model.
 *
 * Gated: INERT unless RUN_M6_1_BENCH=1, so it never runs in CI. Configure via
 * server-only env (a local gitignored .env is read for AI_*-prefixed keys):
 *
 *   AI_BASE_URL      e.g. https://openrouter.ai/api/v1
 *   AI_API_KEY       OpenRouter key (never committed / logged)
 *   AI_REFERER       optional attribution header
 *   AI_BENCH_MODELS  comma-separated model slugs to benchmark
 *   AI_BENCH_PRICING JSON: { "<slug>": { "in": <usd/1M>, "out": <usd/1M> }, ... }
 *                    (fill ONLY from the current official OpenRouter catalogue)
 *
 * With no AI_BASE_URL it falls back to the deterministic MockAIProvider so the
 * matrix/report logic can be validated offline (no spend, no network).
 *
 *   RUN_M6_1_BENCH=1 pnpm exec vitest run packages/database/src/m6-1-benchmark.test.ts
 *
 * NOTE: cost/latency/reliability for a real run require live OpenRouter egress +
 * a key. This harness never invents pricing or token usage — missing values are
 * reported as unavailable, never as 0.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MockAIProvider,
  OpenAICompatibleProvider,
  computeInputHash,
  validateOutput,
  estimateCostUsd,
  PROMPT_VERSION,
  TASK_OPERATION,
  AI_TASKS,
  type AIProvider,
  type AITask,
  type AIEnrichmentRequest,
  type AIUsage,
  type StudyInput,
  type ModelPricing,
} from '@wise-evidence/ai';
import { createTestDatabase, type TestDatabase } from './testing/index.js';
import { findCachedSuggestion, persistSuggestion, type AiCacheKey } from './ai-jobs.js';
import type { ActorContext } from './service.js';

const RUN = process.env.RUN_M6_1_BENCH === '1';
const DEMO_STUDY = '00000000-0000-0000-0000-000000001001';
const REVIEWER: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a1', role: 'REVIEWER' };
const REVIEWER_SUB = '00000000-0000-0000-0000-0000000000b1';

const OUTCOME_VALUES = ['STRONG_POSITIVE', 'POSITIVE', 'LEANING_POSITIVE', 'NEUTRAL_INCONCLUSIVE', 'LEANING_NEGATIVE', 'NEGATIVE', 'STRONG_NEGATIVE'];
const QUALITY_VALUES = ['ADEQUATE', 'UNCLEAR', 'INADEQUATE', 'NOT_APPLICABLE'];
// "Essential enrichment" scenario (a cheaper production subset). Its cost is
// DERIVED from these four actual task results — no separate run is made.
const ESSENTIAL_TASKS: AITask[] = ['summary', 'study-type', 'evidence-level', 'outcome'];

/** Read only AI_-prefixed keys from a local gitignored .env into process.env (Vitest does not). */
function loadAiEnvFromDotenv(): void {
  let text: string;
  try {
    text = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key.startsWith('AI_') || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function providerFor(model: string): AIProvider {
  if (process.env.AI_BASE_URL && process.env.AI_API_KEY) {
    return new OpenAICompatibleProvider({
      baseUrl: process.env.AI_BASE_URL,
      model,
      apiKey: process.env.AI_API_KEY,
      referer: process.env.AI_REFERER,
      title: 'WiseEvidence',
    });
  }
  return new MockAIProvider(model);
}

function pricingFor(model: string): ModelPricing | null {
  try {
    const map = JSON.parse(process.env.AI_BENCH_PRICING ?? '{}') as Record<string, { in?: number; out?: number }>;
    const p = map[model];
    if (p && Number.isFinite(p.in) && Number.isFinite(p.out)) return { inputPerMillion: p.in!, outputPerMillion: p.out! };
  } catch {
    /* ignore malformed pricing map */
  }
  return null;
}

interface Cell {
  model: string;
  task: AITask;
  ok: boolean;
  retried: boolean;
  validation: 'VALID' | 'INVALID' | 'ERROR';
  value: string | null;
  output: unknown;
  usage: AIUsage | null | undefined;
  cost: number | null;
  latencyMs: number | null;
  note: string;
}

const TRANSIENT = new Set(['TIMEOUT', 'PROVIDER_ERROR']);

describe.skipIf(!RUN)('M6.1 model benchmark (gated by RUN_M6_1_BENCH)', () => {
  it('benchmarks the candidate models over six tasks (same input/prompt; model is the only variable)', async () => {
    loadAiEnvFromDotenv();
    const models = (process.env.AI_BENCH_MODELS ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    // With no models configured, benchmark two mock slugs so the report logic is exercised offline.
    const modelList = models.length > 0 ? models : ['mock-a', 'mock-b'];
    const live = Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY);

    const db: TestDatabase = await createTestDatabase({ seed: true });
    try {
      // Load the DEMO study input + taxonomy allowed-value sets ONCE (shared by every model).
      const { input, studyTypes, evidenceLevels } = await db.asRolePersistent('authenticated', REVIEWER_SUB, async (exec) => {
        const base = (
          await exec.query<{
            canonical_title: string;
            summary: string | null;
            study_type_code: string | null;
            subject: string | null;
            journal: string | null;
            year: string | null;
            abstract: string | null;
            is_demo: boolean;
          }>(
            `select s.canonical_title, s.summary, s.study_type_code, s.subject,
                    j.display_name as journal, to_char(p.publication_date,'YYYY') as year, p.abstract, s.is_demo
               from research_study s
               left join publication p on p.study_id = s.id and p.is_primary = true
               left join journal j on j.id = p.journal_id
              where s.id = $1 limit 1`,
            [DEMO_STUDY]
          )
        ).rows[0]!;
        expect(base.is_demo).toBe(true);
        const st = (await exec.query<{ code: string }>(`select code from study_type order by hierarchy_position`)).rows.map((r) => r.code);
        const el = (await exec.query<{ code: string }>(`select code from evidence_level order by pyramid_rank`)).rows.map((r) => r.code);
        const si: StudyInput = {
          title: base.canonical_title,
          summary: base.summary,
          studyType: base.study_type_code,
          subject: base.subject,
          journal: base.journal,
          year: base.year,
          abstract: base.abstract,
        };
        return { input: si, studyTypes: st, evidenceLevels: el };
      });

      const allowedFor = (task: AITask): string[] =>
        task === 'outcome' ? OUTCOME_VALUES : task === 'quality' ? QUALITY_VALUES : task === 'study-type' ? studyTypes : task === 'evidence-level' ? evidenceLevels : [];

      const cells: Cell[] = [];

      for (const model of modelList) {
        const provider = providerFor(model);
        const pricing = pricingFor(model);
        for (const task of AI_TASKS) {
          const req: AIEnrichmentRequest = { task, input, allowedValues: allowedFor(task) };
          const inputHash = await computeInputHash(req);
          const key: AiCacheKey = {
            studyId: DEMO_STUDY,
            operation: TASK_OPERATION[task],
            inputHash,
            provider: provider.name,
            model,
            promptVersion: PROMPT_VERSION[task],
          };
          // Benchmark measures MODEL inference: call the provider directly (no cache lookup).
          const t0 = performance.now();
          let pr = await provider.enrich(req);
          let retried = false;
          if (!pr.ok && TRANSIENT.has(pr.error)) {
            retried = true; // single controlled retry for a transient transport error (marked)
            pr = await provider.enrich(req);
          }
          const latencyMs = Math.round(performance.now() - t0);

          if (!pr.ok) {
            await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => persistSuggestion(exec, REVIEWER, { key, status: 'FAILED' }));
            cells.push({ model, task, ok: false, retried, validation: 'ERROR', value: null, output: null, usage: null, cost: null, latencyMs, note: pr.error });
            continue;
          }
          const cost = pricing ? estimateCostUsd(pr.usage, pricing) : null;
          const v = validateOutput(task, pr.raw, req.allowedValues);
          if (!v.ok) {
            await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => persistSuggestion(exec, REVIEWER, { key, status: 'FAILED', costEstimate: cost }));
            cells.push({ model, task, ok: true, retried, validation: 'INVALID', value: null, output: pr.raw, usage: pr.usage, cost, latencyMs, note: v.message });
            continue;
          }
          await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
            persistSuggestion(exec, REVIEWER, {
              key,
              status: 'SUCCEEDED',
              costEstimate: cost,
              result: { output: v.suggestion.output, suggestedValue: v.suggestion.suggestedValue, confidence: v.suggestion.confidence, validationStatus: 'VALID' },
            })
          );
          cells.push({ model, task, ok: true, retried, validation: 'VALID', value: v.suggestion.suggestedValue, output: v.suggestion.output, usage: pr.usage, cost, latencyMs, note: 'ok' });
        }
      }

      // Separate cache verification (NOT part of the inference cost comparison):
      // a repeated request for the first model+task must be served from cache.
      const first = modelList[0]!;
      const cacheKey: AiCacheKey = {
        studyId: DEMO_STUDY,
        operation: TASK_OPERATION.outcome,
        inputHash: await computeInputHash({ task: 'outcome', input, allowedValues: OUTCOME_VALUES }),
        provider: providerFor(first).name,
        model: first,
        promptVersion: PROMPT_VERSION.outcome,
      };
      const cacheHit = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => findCachedSuggestion(exec, cacheKey));

      // ---- Report ----
      const fmtCost = (c: number | null) => (c === null ? 'n/a' : `$${c.toFixed(6)}`);
      const fmtUsage = (u: AIUsage | null | undefined) => (u ? `${u.inputTokens ?? '-'}/${u.outputTokens ?? '-'}/${u.totalTokens ?? '-'}` : 'UNAVAILABLE');
      const lines: string[] = [
        '',
        '==================== M6.1 MODEL BENCHMARK ====================',
        `mode: ${live ? 'LIVE (openai-compatible)' : 'MOCK (offline — report logic only)'}`,
        `base: ${live ? process.env.AI_BASE_URL : 'n/a'}   study: ${DEMO_STUDY} (DEMO)`,
        `models: ${modelList.join(', ')}`,
        '-------------------------------------------------------------',
        'model            task           ok    valid    in/out/total    lat(ms) cost',
      ];
      for (const c of cells) {
        lines.push(
          `${c.model.slice(0, 15).padEnd(15)} ${c.task.padEnd(14)} ${String(c.ok).padEnd(5)} ${c.validation.padEnd(7)} ${fmtUsage(c.usage).padEnd(15)} ${String(c.latencyMs ?? '-').padEnd(6)} ${fmtCost(c.cost)}${c.retried ? ' [retried]' : ''}`
        );
      }
      lines.push('-------------------------------------------------------------');
      for (const model of modelList) {
        const mc = cells.filter((c) => c.model === model);
        const valid = mc.filter((c) => c.validation === 'VALID').length;
        const failed = mc.filter((c) => c.validation !== 'VALID').length;
        const retries = mc.filter((c) => c.retried).length;
        const anyCost = mc.some((c) => c.cost !== null);
        const sixCost = anyCost ? mc.reduce((n, c) => n + (c.cost ?? 0), 0) : null;
        // Essential-4 cost only when ALL four essential tasks have a real cost.
        const essCells = ESSENTIAL_TASKS.map((t) => mc.find((c) => c.task === t));
        const essCost = essCells.every((c) => c && c.cost !== null) ? essCells.reduce((n, c) => n + (c!.cost ?? 0), 0) : null;
        const tokens = mc.reduce((n, c) => n + (c.usage?.totalTokens ?? 0), 0);
        const avgLat = Math.round(mc.reduce((n, c) => n + (c.latencyMs ?? 0), 0) / mc.length);
        lines.push(
          `SUMMARY ${model}: valid=${valid}/6 failed=${failed} retries=${retries} tokens=${tokens || 'n/a'} avg_latency=${avgLat}ms`
        );
        lines.push(`  FULL(6):      cost=${sixCost === null ? 'n/a (set AI_BENCH_PRICING)' : fmtCost(sixCost)}` + (sixCost !== null ? `  100=${fmtCost(sixCost * 100)}  1,000=${fmtCost(sixCost * 1000)}  10,000=${fmtCost(sixCost * 10000)} [ESTIMATE]` : ''));
        lines.push(`  ESSENTIAL(4): cost=${essCost === null ? 'n/a' : fmtCost(essCost)}` + (essCost !== null ? `  100=${fmtCost(essCost * 100)}  1,000=${fmtCost(essCost * 1000)}  10,000=${fmtCost(essCost * 10000)} [ESTIMATE, derived from 4 task results]` : ''));
      }
      // Full outputs, for the manual source-grounding + human-review assessment.
      lines.push('-------------------------------------------------------------', 'OUTPUTS (for manual grounding / human-review assessment):');
      for (const c of cells) {
        const body = c.output !== null && c.output !== undefined ? JSON.stringify(c.output).slice(0, 600) : c.note;
        lines.push(`  [${c.model} · ${c.task}] ${c.validation}: ${body}`);
      }
      lines.push(`cache verification: ${cacheHit ? 'HIT (repeat served from stored result — no new call)' : 'MISS'}`);
      lines.push('=============================================================', '');
      console.log(lines.join('\n'));

      // Invariants (hold for mock and live): every model×task produced a row; cache works.
      expect(cells).toHaveLength(modelList.length * AI_TASKS.length);
      expect(cacheHit).not.toBeNull();
    } finally {
      await db.close();
    }
  });
});
