// Public API of @wise-evidence/database (data-access foundation, Milestone 2).
// Note: the PGlite test harness is exported separately from '@wise-evidence/database/testing'.

export type { QueryExecutor, QueryResult } from './db.js';
export * from './types.js';
export { toCanonicalIdentifier, type CanonicalIdentifier } from './identifiers.js';
export { findStudyByDoi, listPublishedPublications } from './repositories.js';
export {
  createDraft,
  updateDraft,
  setClassification,
  addCriticism,
  submitForReview,
  reject,
  approveAndPublish,
  archive,
  findExistingByDoi,
  PermissionError,
  PublicationError,
  ValidationError,
  type ActorContext,
  type CreateDraftInput,
  type CreatedDraft,
  type UpdateDraftPatch,
  type SetClassificationInput,
  type AddCriticismInput,
} from './service.js';
export {
  getPublishedStudyDetail,
  getStudyForEditor,
  listReviewQueue,
  type PublicResearchDetail,
  type PublicClassification,
  type PublicCriticism,
  type EditorStudy,
} from './read.js';
export {
  searchPublishedResearch,
  getPublishedResearchFacets,
  normalizeExplorerParams,
  PAGE_SIZE,
  type ExplorerParams,
  type ResearchCard,
  type ResearchSort,
  type SearchResult,
  type Facets,
} from './search.js';
export {
  findCachedSuggestion,
  persistSuggestion,
  listLatestSuggestions,
  type AiCacheKey,
  type AiJobStatus,
  type AiSuggestionRecord,
  type PersistSuggestionInput,
} from './ai-jobs.js';
export {
  getEvidenceLandscape,
  type EvidenceLandscape,
  type LevelCount,
  type StudyTypeCount,
  type ValueCount,
  type CriticismCount,
} from './landscape.js';
export {
  runMigrations,
  runSeed,
  readSqlFiles,
  migrationsDir,
  seedDir,
  type SqlScriptRunner,
  type SqlFile,
} from './migrate.js';
