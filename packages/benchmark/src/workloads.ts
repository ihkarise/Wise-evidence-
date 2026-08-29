/**
 * Benchmark workloads (M6.1 master prompt §12).
 *
 * The ONLY intended experimental variable in the benchmark is the MODEL. The task
 * set, task inputs, prompt versions, and validation are all held constant. Two
 * workloads are compared:
 *
 *   - FULL      — all six approved enrichment tasks (docs/29 §5).
 *   - ESSENTIAL — the four tasks a reviewer needs first: summary, outcome,
 *                 evidence-quality, and duplicate-detection.
 *
 * The repository does not define ESSENTIAL elsewhere, so this follows the master
 * prompt's definition verbatim; if the approved spec later differs, update here
 * and document the difference (master prompt §12).
 *
 * Pure data + a couple of pure helpers: no network, no provider, no DB.
 */
import { AI_TASKS, type AITaskId } from "@wise-evidence/ai";

export type WorkloadMode = "FULL" | "ESSENTIAL";

/** FULL = the six approved tasks, in the canonical order (docs/29 §5). */
export const FULL_TASKS: readonly AITaskId[] = AI_TASKS;

/** ESSENTIAL = the four reviewer-critical tasks (master prompt §12). */
export const ESSENTIAL_TASKS: readonly AITaskId[] = [
  "research-summary",
  "outcome-classification",
  "evidence-quality",
  "duplicate-detection",
] as const;

/** The task list for a workload mode. */
export function tasksForWorkload(mode: WorkloadMode): readonly AITaskId[] {
  return mode === "FULL" ? FULL_TASKS : ESSENTIAL_TASKS;
}

/** Both workload modes, FULL first. */
export const WORKLOAD_MODES: readonly WorkloadMode[] = ["FULL", "ESSENTIAL"] as const;
