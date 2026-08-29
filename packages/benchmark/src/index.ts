/**
 * @wise-evidence/benchmark — the Milestone 6.1 operational benchmark harness.
 *
 * It DRIVES the existing `@wise-evidence/ai` provider + orchestrator to compare
 * candidate models on the DEMO study under identical conditions (model is the only
 * variable). It adds NO new provider and NO parallel AI architecture (master prompt
 * §8, §11). Live inference is env-gated (`benchmark.live.test.ts`) and never runs in
 * CI; every function here is pure/offline-testable and never fabricates a value.
 */
export {
  FULL_TASKS,
  ESSENTIAL_TASKS,
  WORKLOAD_MODES,
  tasksForWorkload,
  type WorkloadMode,
} from "./workloads.js";

export { DEMO_STUDY_ID, DEMO_STUDY_LABEL, demoInputForTask } from "./demo-study.js";

export { DEFAULT_CANDIDATES, parseCandidates, type CandidateModel } from "./models.js";

export { benchProvider, type BenchProviderOptions } from "./provider-config.js";

export {
  fetchCatalogue,
  parseCatalogue,
  verifyCandidates,
  type CatalogueFetch,
  type CatalogueEntry,
  type CatalogueResult,
  type ModelVerification,
} from "./catalogue.js";

export {
  runModelWorkload,
  aggregate,
  cacheKeyParts,
  cacheKeyString,
  type TaskMeasurement,
  type RunModelOptions,
  type ModelAggregate,
  type CacheKeyParts,
} from "./runner.js";

export {
  renderMeasurementTable,
  renderAggregateTable,
  renderCatalogueTable,
  type WorkloadReport,
  type BenchmarkReport,
} from "./report.js";
