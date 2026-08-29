/**
 * @wise-evidence/database — the framework-independent data-access boundary.
 *
 * This package isolates SQL and database concerns from the Astro UI (docs/23 §5).
 * Its published surface must never import Astro, React, the Supabase client, or
 * any AI SDK. DOI canonicalisation is reused from `@wise-evidence/domain` rather
 * than duplicated (see `reexportedNormalizeDoi` below).
 *
 * Milestone 2 scope: the canonical enum vocabularies (mirroring the SQL enums),
 * TypeScript types, and locators/loaders for the version-controlled migrations
 * and seed. Query helpers for the application arrive with the Manual Research MVP
 * (Milestone 3); the deterministic test harness lives under `test/` and is not
 * part of this public API.
 */
export * from "./constants.js";
export {
  MIGRATIONS_DIR,
  SEED_DIR,
  loadMigrations,
  loadSeedFile,
  type MigrationFile,
} from "./paths.js";

/**
 * Re-export the shared DOI canonicaliser so database callers use the exact same
 * normalization as import and search, without this package owning a second copy.
 */
export { normalizeDoi, toCanonicalDoi, isValidDoi, normalizeTitle } from "@wise-evidence/domain";

/**
 * Milestone 3 service / data-access layer (docs/26). All research-workflow
 * business rules and SQL live here, on the framework-independent SqlExecutor
 * boundary shared by the tests and the Astro server.
 */
export {
  type SqlExecutor,
  type Actor,
  type ServiceErrorReason,
  ServiceError,
  requireStaff,
  requireAdmin,
} from "./executor.js";

export * from "./service/research.js";
export * from "./service/read.js";

/**
 * Milestone 4 public research explorer (docs/27). A PostgreSQL-only,
 * published-only search/browse query layer + validated query-parameter parsing
 * + canonical filter options. No AI, embeddings, popularity, or efficacy score.
 */
export * from "./service/search.js";

/**
 * Milestone 5 evidence visualization (docs/28, ADR-016). Descriptive, published-
 * only, distinct-study COUNTS for the evidence pyramid and the outcome / quality
 * / criticism distributions. Separate axes only — no cross-tab and no combined /
 * efficacy / balance / weighted score of any kind.
 */
export * from "./stats.js";

/**
 * Milestone 6 AI enrichment persistence + cache + human-decision layer
 * (docs/29, ADR-017). Records AI jobs and immutable AI results, resolves the
 * cache identity, builds minimised task input, lists suggestions, and records the
 * human Accept/Edit/Reject decision (append-only). Holds NO AI logic — the
 * provider/registry/validation live in @wise-evidence/ai, which this package does
 * not import. AI never writes canonical data, never publishes, never enters M5.
 */
export * from "./service/ai.js";
