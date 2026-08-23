/**
 * Deterministic mock provider (docs/10 §14). Returns fixed, schema-valid raw
 * output derived only from the request, so developers and CI run the entire
 * enrichment pipeline — job, validation, persistence, cache, UI — without any
 * network or spend. Same input → same output (cache-testable).
 */
import type { AIEnrichmentRequest, AIProvider, AIProviderResult, AITask } from './types.js';

/** Pick a stable element from a list using a cheap deterministic hash of `seed`. */
function pick<T>(list: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length] as T;
}

function seedOf(req: AIEnrichmentRequest): string {
  return `${req.task}|${req.input.title}|${req.input.summary ?? ''}|${req.input.abstract ?? ''}`;
}

function buildRaw(req: AIEnrichmentRequest): unknown {
  const seed = seedOf(req);
  const allowed = req.allowedValues ?? [];
  const task: AITask = req.task;

  if (task === 'summary') {
    const basis = req.input.summary ?? req.input.abstract ?? req.input.title;
    return {
      summary: `Deterministic mock summary for review: ${basis.slice(0, 240)}`.trim(),
      confidence: 'MODERATE',
      rationale: 'Mock provider — deterministic fixture, not a real model output.',
    };
  }

  if (task === 'criticism') {
    return {
      items: [{ category: 'SAMPLE_SIZE', note: 'Mock: sample size not stated in the provided text.' }],
      confidence: 'LOW',
      rationale: 'Mock provider — deterministic fixture.',
    };
  }

  // Classification tasks: choose a value from the allowed set when provided.
  const value = allowed.length > 0 ? pick(allowed, seed) : 'NEUTRAL_INCONCLUSIVE';
  return {
    value,
    confidence: pick(['LOW', 'MODERATE', 'HIGH'] as const, seed),
    rationale: 'Mock provider — deterministic fixture, pending human review.',
  };
}

export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  readonly model: string;

  constructor(model = 'mock-1') {
    this.model = model;
  }

  async enrich(req: AIEnrichmentRequest): Promise<AIProviderResult> {
    return { ok: true, raw: buildRaw(req), costEstimate: 0 };
  }
}
