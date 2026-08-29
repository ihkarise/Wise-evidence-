/**
 * MockAIProvider — the deterministic, OFFLINE default provider (docs/29 §3.1, §14).
 *
 * It performs NO network I/O and needs NO API key, so development and CI run the
 * full enrichment pipeline for free (docs/29 §23). Given a task and input it
 * returns a fixed, schema-valid structured output plus clearly-fixture token
 * usage. Because it ignores any instruction-like text inside the untrusted input
 * and always returns its own deterministic result, it also demonstrates
 * prompt-injection resistance (docs/29 §10): the output never bends to text in
 * the research data.
 *
 * The mock is intentionally conservative: it never suggests a strong outcome and
 * never suggests a duplicate, so a mock-driven pipeline cannot manufacture an
 * alarming or destructive suggestion.
 */
import { sha256Hex } from "../hash.js";
import { MOCK_CAPABILITIES, type AICapabilities } from "../capabilities.js";
import {
  UNKNOWN_USAGE,
  type AICompletionRequest,
  type AICompletionResponse,
  type AIProvider,
  type AIUsage,
} from "../types.js";

export interface MockProviderOptions {
  /** Provider-reported model id (provenance). Default "mock-1". */
  readonly model?: string;
  /**
   * When false, the mock reports UNKNOWN usage (all null) — useful for exercising
   * the "usage unavailable → cost null" path. Default true (fixture usage).
   */
  readonly reportUsage?: boolean;
}

export class MockAIProvider implements AIProvider {
  readonly id = "mock";
  readonly modelId: string;
  readonly capabilities: AICapabilities = MOCK_CAPABILITIES;
  readonly #model: string;
  readonly #reportUsage: boolean;

  constructor(options: MockProviderOptions = {}) {
    this.#model = options.model ?? "mock-1";
    this.modelId = this.#model;
    this.#reportUsage = options.reportUsage ?? true;
  }

  complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const rawText = this.#buildOutput(request);
    const usage: AIUsage = this.#reportUsage
      ? {
          // Clearly-fixture counts derived from text length (~4 chars/token).
          inputTokens: Math.ceil((request.system.length + request.userContent.length) / 4),
          outputTokens: Math.ceil(rawText.length / 4),
          totalTokens: null, // filled below
        }
      : UNKNOWN_USAGE;
    const finalUsage: AIUsage = this.#reportUsage
      ? { ...usage, totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) }
      : usage;
    return Promise.resolve({
      rawText,
      usage: finalUsage,
      model: this.#model,
      finishReason: "stop",
    });
  }

  /** Deterministic, schema-valid JSON per task. Same input → same output. */
  #buildOutput(request: AICompletionRequest): string {
    const seed = sha256Hex(request.userContent);
    const pick = <T>(arr: readonly T[]): T => arr[parseInt(seed.slice(0, 8), 16) % arr.length]!;

    switch (request.task) {
      case "research-summary":
        return json({
          summary:
            "Mock deterministic summary of the supplied study metadata, provided for human review. This is an AI suggestion, not a human-reviewed value.",
          confidence: 0.5,
        });
      case "outcome-classification":
        // Conservative, non-strong values only.
        return json({
          outcome: pick(["NEUTRAL_INCONCLUSIVE", "LEANING_POSITIVE", "LEANING_NEGATIVE"] as const),
          confidence: 0.42,
          rationale: "Mock suggestion derived deterministically from the input; review required.",
        });
      case "evidence-quality":
        return json({
          quality: pick(["UNCLEAR", "MODERATE", "LOW"] as const),
          confidence: 0.4,
          rationale: "Mock methodological-quality suggestion; review required.",
        });
      case "criticism-extraction":
        return json({
          criticisms: [
            {
              category: "SAMPLE_SIZE",
              text: "Mock: the reported sample size may be insufficient to support firm conclusions.",
              confidence: 0.4,
            },
          ],
        });
      case "metadata-extraction":
        return json({
          subjectType: "HUMAN",
          studyTypeCode: null,
          confidence: 0.4,
        });
      case "duplicate-detection":
        // Never suggest a duplicate by default — no destructive false positives.
        return json({ duplicates: [] });
      default:
        return json({});
    }
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
