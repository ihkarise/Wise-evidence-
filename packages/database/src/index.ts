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
