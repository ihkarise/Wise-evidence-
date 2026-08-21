/**
 * Typed mirror of the WiseEvidence database schema.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ AUTHORITY: the SQL migrations in `supabase/migrations/` are the single      │
 * │ source of truth for the schema. This file is a HAND-AUTHORED, DERIVED       │
 * │ mirror kept in sync with those migrations by hand (docs/05 §15, ADR-012).   │
 * │ It is NOT an independent schema authority. When the Supabase CLI / type-    │
 * │ generation workflow is introduced in a later milestone, REGENERATE or       │
 * │ REPLACE this file from the real Supabase schema rather than maintaining two │
 * │ competing definitions.                                                      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Column names are snake_case to match the SQL exactly.
 */

// --- Enums (mirror 0001_enums.sql) ---
export type AppRole = 'PUBLIC' | 'REVIEWER' | 'ADMIN';

export type LifecycleState =
  | 'DISCOVERED'
  | 'IMPORTED'
  | 'PROCESSING'
  | 'PENDING_REVIEW'
  | 'PUBLISHED'
  | 'IMPORT_FAILED'
  | 'DUPLICATE_CANDIDATE'
  | 'REJECTED'
  | 'ARCHIVED';

export type PublicationState = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';

export type ClassificationDimension =
  | 'OUTCOME'
  | 'EVIDENCE_LEVEL'
  | 'QUALITY'
  | 'CONFIDENCE'
  | 'STUDY_TYPE';

export type OutcomeValue =
  | 'STRONG_POSITIVE'
  | 'POSITIVE'
  | 'LEANING_POSITIVE'
  | 'NEUTRAL_INCONCLUSIVE'
  | 'LEANING_NEGATIVE'
  | 'NEGATIVE'
  | 'STRONG_NEGATIVE';

export type ConfidenceLevel = 'LOW' | 'MODERATE' | 'HIGH';

export type QualityAssessment = 'ADEQUATE' | 'UNCLEAR' | 'INADEQUATE' | 'NOT_APPLICABLE';

export type CriticismCategory =
  | 'METHODOLOGY'
  | 'RANDOMIZATION'
  | 'BLINDING'
  | 'SAMPLE_SIZE'
  | 'STATISTICS'
  | 'CONTROLS'
  | 'REPLICATION'
  | 'PUBLICATION_BIAS'
  | 'REPORTING'
  | 'INTERPRETATION'
  | 'GENERALIZABILITY'
  | 'OTHER';

export type CriticismOrigin =
  | 'AUTHOR_REPORTED'
  | 'EXTERNAL_PUBLICATION'
  | 'REVIEWER_ASSESSED'
  | 'AI_SUGGESTED';

export type SubjectType = 'HUMAN' | 'ANIMAL' | 'IN_VITRO' | 'MIXED' | 'NOT_APPLICABLE';

export type IdentifierType = 'DOI' | 'PMID' | 'PMCID' | 'EUROPEPMC' | 'URL' | 'OTHER';

export type ImportMethod = 'MANUAL' | 'CONNECTOR';

export type ImportState =
  | 'DISCOVERED'
  | 'FETCHING'
  | 'FETCHED'
  | 'NORMALIZED'
  | 'DUPLICATE_CANDIDATE'
  | 'IMPORTED'
  | 'FAILED'
  | 'REVIEW_REQUIRED';

export type AiOperation =
  | 'SUMMARIZE'
  | 'CLASSIFY_OUTCOME'
  | 'CLASSIFY_STUDY_TYPE'
  | 'ASSESS_QUALITY'
  | 'EXTRACT_CRITICISM'
  | 'EXTRACT_METADATA'
  | 'GENERATE_KEYWORDS'
  | 'DETECT_DUPLICATE';

export type AiStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED';

export type ReviewAction = 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'EDIT';

export type CorrectionStatus = 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'MERGED';

// --- Tables (mirror 0002–0007) ---
export interface AppUserRow {
  id: string;
  auth_id: string;
  email: string | null;
  display_name: string | null;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface StudyTypeRow {
  code: string;
  label: string;
  clinical: boolean;
  subject: SubjectType;
  hierarchy_position: number | null;
  taxonomy_version: string;
}

export interface EvidenceLevelRow {
  code: string;
  label: string;
  pyramid_rank: number;
  taxonomy_version: string;
}

export interface ConditionRow {
  id: string;
  slug: string;
  canonical_name: string;
  synonyms: string[];
  parent_id: string | null;
  description: string | null;
  created_at: string;
}

export interface InterventionRow {
  id: string;
  slug: string;
  canonical_name: string;
  synonyms: string[];
  kind: string | null;
  description: string | null;
  created_at: string;
}

export interface TagRow {
  id: string;
  slug: string;
  label: string;
}

export interface AuthorRow {
  id: string;
  normalized_name: string;
  display_name: string;
  orcid: string | null;
  disambiguation_note: string | null;
  created_at: string;
}

export interface JournalRow {
  id: string;
  normalized_name: string;
  display_name: string;
  issn: string[];
  publisher: string | null;
  homepage_url: string | null;
  created_at: string;
}

export interface ResearchSourceRow {
  id: string;
  source_name: string;
  source_url: string | null;
  publisher_url: string | null;
  import_method: ImportMethod;
  external_id: string | null;
  license_info: string | null;
  transformation_notes: string | null;
  imported_at: string;
  verification_timestamp: string | null;
}

export interface ResearchStudyRow {
  id: string;
  canonical_title: string;
  study_type_code: string | null;
  subject: SubjectType | null;
  lifecycle_state: LifecycleState;
  is_demo: boolean;
  duplicate_of_study_id: string | null;
  /** Human-authored concise summary (migration 0010). Never AI-generated. */
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicationRow {
  id: string;
  study_id: string;
  title: string;
  abstract: string | null;
  publication_date: string | null;
  language: string | null;
  journal_id: string | null;
  source_id: string | null;
  publication_state: PublicationState;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface PublicationAuthorRow {
  publication_id: string;
  author_id: string;
  author_position: number;
}

export interface ResearchIdentifierRow {
  id: string;
  publication_id: string | null;
  study_id: string | null;
  id_type: IdentifierType;
  value_raw: string;
  value_canonical: string;
  created_at: string;
}

export interface AiJobRow {
  id: string;
  study_id: string | null;
  operation: AiOperation;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  status: AiStatus;
  cost_estimate: string | null;
  created_at: string;
}

export interface AiResultRow {
  id: string;
  job_id: string;
  output: unknown;
  suggested_value: string | null;
  confidence: ConfidenceLevel | null;
  validation_status: string;
  created_at: string;
}

export interface ClassificationRow {
  id: string;
  study_id: string;
  dimension: ClassificationDimension;
  value: string;
  judgement_confidence: ConfidenceLevel | null;
  explanation: string | null;
  ai_result_id: string | null;
  final_actor: string;
  final_reason: string | null;
  updated_at: string;
}

export interface CriticismRow {
  id: string;
  study_id: string;
  publication_id: string | null;
  category: CriticismCategory;
  origin: CriticismOrigin;
  body: string;
  source_reference: string | null;
  actor: string | null;
  ai_result_id: string | null;
  status: string;
  created_at: string;
}

export interface ReviewRow {
  id: string;
  study_id: string;
  reviewer: string;
  action: ReviewAction;
  dimension: ClassificationDimension | null;
  before_snapshot: unknown;
  after_snapshot: unknown;
  reason: string | null;
  created_at: string;
}

export interface CorrectionRow {
  id: string;
  study_id: string | null;
  publication_id: string | null;
  target_field: string | null;
  proposed_value: string | null;
  submitter: string | null;
  submitter_note: string | null;
  status: CorrectionStatus;
  resolution_actor: string | null;
  resolution_reason: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ImportJobRow {
  id: string;
  source_name: string;
  trigger: ImportMethod;
  state: ImportState;
  discovered_count: number;
  imported_count: number;
  started_at: string;
  ended_at: string | null;
}

export interface ImportCandidateRow {
  id: string;
  job_id: string | null;
  raw_payload: unknown;
  normalized_payload: unknown;
  state: ImportState;
  duplicate_of_study_id: string | null;
  error_detail: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  field: string | null;
  before_value: string | null;
  after_value: string | null;
  reason: string | null;
  created_at: string;
}
