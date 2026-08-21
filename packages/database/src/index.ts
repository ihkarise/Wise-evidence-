// Public API of @wise-evidence/database (data-access foundation, Milestone 2).
// Note: the PGlite test harness is exported separately from '@wise-evidence/database/testing'.

export type { QueryExecutor, QueryResult } from './db.js';
export * from './types.js';
export { toCanonicalIdentifier, type CanonicalIdentifier } from './identifiers.js';
export { findStudyByDoi, listPublishedPublications } from './repositories.js';
export {
  runMigrations,
  runSeed,
  readSqlFiles,
  migrationsDir,
  seedDir,
  type SqlScriptRunner,
  type SqlFile,
} from './migrate.js';
