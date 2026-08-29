/**
 * DEMO-input tests (master prompt §8, §11; docs/29 §12). The benchmark input must
 * be the DEMO study, clearly labelled, minimised, and identical across models.
 */
import { describe, it, expect } from "vitest";
import { hashInput } from "@wise-evidence/ai";
import { demoInputForTask, DEMO_STUDY_ID, DEMO_STUDY_LABEL } from "./demo-study.js";
import { FULL_TASKS } from "./workloads.js";

describe("demo study input", () => {
  it("uses the first demo study id and a [DEMO]-labelled title", () => {
    expect(DEMO_STUDY_ID).toBe("20000000-0000-0000-0000-000000000001");
    expect(DEMO_STUDY_LABEL.startsWith("[DEMO]")).toBe(true);
  });

  it("every task input is [DEMO]-labelled data (never a real claim)", () => {
    for (const task of FULL_TASKS) {
      const json = JSON.stringify(demoInputForTask(task));
      expect(json).toContain("[DEMO]");
    }
  });

  it("is minimised: no PDF, credentials, or audit fields leak in", () => {
    for (const task of FULL_TASKS) {
      const keys = Object.keys(demoInputForTask(task)).join(",");
      expect(keys).not.toMatch(/pdf|password|token|secret|audit|apikey|api_key/i);
    }
  });

  it("is deterministic and identical across calls (constant across models)", () => {
    for (const task of FULL_TASKS) {
      expect(hashInput(demoInputForTask(task))).toBe(hashInput(demoInputForTask(task)));
    }
  });

  it("metadata-extraction omits studyType/subjectType (task-scoped minimisation)", () => {
    const meta = demoInputForTask("metadata-extraction");
    expect(Object.keys(meta).sort()).toEqual(["abstract", "journal", "publicationYear", "title"]);
  });

  it("duplicate-detection carries an empty candidate set (no discovery)", () => {
    const dup = demoInputForTask("duplicate-detection") as { candidates: unknown[] };
    expect(dup.candidates).toEqual([]);
  });

  it("returns a fresh object each call (a run cannot mutate the shared fixture)", () => {
    const a = demoInputForTask("research-summary");
    (a as Record<string, unknown>).title = "mutated";
    expect((demoInputForTask("research-summary") as Record<string, unknown>).title).toBe(
      "[DEMO] Positive reported outcome trial",
    );
  });
});
