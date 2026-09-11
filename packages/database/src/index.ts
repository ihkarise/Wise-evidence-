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

/**
 * Milestone 7.4A discovery persistence adapter (docs/30 §10, migration 0013,
 * ADR-020). The thin, server-side (`service_role`) implementation of the M7.3
 * discovery persistence ports (`DiscoveryRunStore` / `CandidateStore`) and the
 * read-only `KnownStudyIndex`, mapping to `import_job` / `import_candidate` and
 * reading existing canonical studies for dedup. Holds NO provider/pagination/
 * dedup/AI logic; writes nothing canonical and never publishes. Candidate
 * idempotency is DB-enforced (migration 0013 partial unique index).
 */
export { DatabaseDiscoveryStore, DatabaseStudyIndex } from "./service/discovery.js";

/**
 * Milestone 7.4B discovery-candidate review workflow (docs/30 §11, ADR-020). The
 * staff-only review operations over `import_candidate`: list/detail reads plus
 * accept / reject / link-duplicate / correct / refetch / defer. ACCEPT starts the
 * EXISTING manual research lifecycle (a DRAFT via `createDraftFromMetadata`) and
 * NEVER publishes, classifies, or calls AI; candidates are never deleted and
 * duplicates stay reviewable. Provenance is preserved through the shared discovery
 * `research_source`, the candidate DOI, and append-only `audit_log`.
 */
export * from "./service/candidates.js";

/**
 * Milestone 7.8 manual "Run discovery now" (docs/30 §14, ADR-020 M7.8). The one
 * composition point that lets an authenticated staff user start the EXISTING
 * bounded discovery orchestrator against the EXISTING persistence adapters — no
 * second discovery implementation, no scheduler/worker/queue. It persists
 * REVIEWABLE candidates only and never publishes, classifies, scores, accepts,
 * merges, deletes, or calls AI. The client may choose only an allowlisted
 * provider + a bounded query; identity, role, budget, and host are server-side.
 */
export * from "./service/run-discovery.js";

/**
 * M7.9 — trusted scheduled-invocation authorization + configuration. Pure,
 * framework-independent helpers used by the `/api/internal/discovery/run`
 * endpoint to authenticate an external scheduler (shared secret, constant-time)
 * and resolve the server-configured provider/query. The run itself goes through
 * `runScheduledDiscovery` (above), under a real server-resolved staff actor.
 */
export * from "./service/scheduled-discovery.js";
