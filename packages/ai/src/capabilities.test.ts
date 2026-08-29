/**
 * Capability-negotiation tests (ADR-019). Every task requires structured output;
 * a model that cannot provide it fails clearly (never a silent downgrade).
 */
import { describe, it, expect } from "vitest";
import {
  assertCapabilities,
  missingCapabilities,
  MOCK_CAPABILITIES,
  OPENAI_COMPATIBLE_CAPABILITIES,
  LOCAL_MODEL_CAPABILITIES,
  TASK_CAPABILITY_REQUIREMENTS,
  type AICapabilities,
} from "./capabilities.js";
import { AI_TASKS, AIProviderError } from "./types.js";

describe("capability negotiation", () => {
  it("every task requires structured output", () => {
    for (const task of AI_TASKS) {
      expect(TASK_CAPABILITY_REQUIREMENTS[task].structuredOutput).toBe(true);
    }
  });

  it("mock, OpenAI-compatible, and local defaults satisfy every task", () => {
    for (const caps of [
      MOCK_CAPABILITIES,
      OPENAI_COMPATIBLE_CAPABILITIES,
      LOCAL_MODEL_CAPABILITIES,
    ]) {
      for (const task of AI_TASKS) {
        expect(missingCapabilities(task, caps)).toEqual([]);
        expect(() => assertCapabilities(task, caps)).not.toThrow();
      }
    }
  });

  it("fails clearly when structured output is unsupported", () => {
    const noStructured: AICapabilities = {
      structuredOutput: false,
      jsonSchema: false,
      toolCalling: false,
      vision: false,
      maxContextTokens: null,
      maxOutputTokens: null,
    };
    expect(missingCapabilities("outcome-classification", noStructured)).toContain(
      "structuredOutput",
    );
    try {
      assertCapabilities("outcome-classification", noStructured);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).reason).toBe("unsupported-capability");
      expect((error as Error).message).toContain("structuredOutput");
    }
  });

  it("does not require json schema, tool calling, or vision (json_object suffices)", () => {
    // A model that supports structured output but not strict schema still passes:
    // the adapter uses json_object and our validator is the real gate.
    const jsonObjectOnly: AICapabilities = {
      structuredOutput: true,
      jsonSchema: false,
      toolCalling: false,
      vision: false,
      maxContextTokens: null,
      maxOutputTokens: null,
    };
    for (const task of AI_TASKS) {
      expect(() => assertCapabilities(task, jsonObjectOnly)).not.toThrow();
    }
  });
});
