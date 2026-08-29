/**
 * Workload-definition tests (master prompt §12). FULL is the six approved tasks;
 * ESSENTIAL is the four reviewer-critical tasks — a strict subset, no invented task.
 */
import { describe, it, expect } from "vitest";
import { AI_TASKS } from "@wise-evidence/ai";
import { FULL_TASKS, ESSENTIAL_TASKS, WORKLOAD_MODES, tasksForWorkload } from "./workloads.js";

describe("workloads", () => {
  it("FULL is exactly the six approved tasks", () => {
    expect([...FULL_TASKS]).toEqual([...AI_TASKS]);
    expect(FULL_TASKS).toHaveLength(6);
  });

  it("ESSENTIAL is the four reviewer-critical tasks", () => {
    expect([...ESSENTIAL_TASKS]).toEqual([
      "research-summary",
      "outcome-classification",
      "evidence-quality",
      "duplicate-detection",
    ]);
  });

  it("ESSENTIAL is a strict subset of FULL (no invented tasks)", () => {
    for (const task of ESSENTIAL_TASKS) {
      expect(FULL_TASKS).toContain(task);
    }
    expect(ESSENTIAL_TASKS.length).toBeLessThan(FULL_TASKS.length);
  });

  it("tasksForWorkload selects the right list", () => {
    expect(tasksForWorkload("FULL")).toEqual(FULL_TASKS);
    expect(tasksForWorkload("ESSENTIAL")).toEqual(ESSENTIAL_TASKS);
  });

  it("both modes are exposed, FULL first", () => {
    expect([...WORKLOAD_MODES]).toEqual(["FULL", "ESSENTIAL"]);
  });
});
