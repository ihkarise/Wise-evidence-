-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0007: performance, foreign-key, lifecycle, and full-text indexes
-- (docs/05 §12, docs/14 §2-3). Unique indexes are created inline with their
-- constraints in earlier migrations.

-- Foreign-key / lookup indexes -----------------------------------------------
create index idx_study_type_evidence_level     on study_type (evidence_level_id);
create index idx_condition_parent              on condition (parent_id);

create index idx_publication_study             on publication (study_id);
create index idx_publication_journal           on publication (journal_id);
create index idx_publication_source            on publication (source_id);

create index idx_pub_author_author             on publication_author (author_id);

create index idx_identifier_study              on research_identifier (study_id);
create index idx_identifier_publication        on research_identifier (publication_id);
create index idx_identifier_value_canonical    on research_identifier (value_canonical);

create index idx_study_condition_condition     on study_condition (condition_id);
create index idx_study_intervention_interv     on study_intervention (intervention_id);
create index idx_study_tag_tag                 on study_tag (tag_id);

create index idx_classification_study          on classification (study_id);
create index idx_classification_ai_result      on classification (ai_result_id);
create index idx_eqa_study                     on evidence_quality_assessment (study_id);
create index idx_criticism_study               on criticism (study_id);
create index idx_criticism_publication         on criticism (publication_id);

create index idx_review_study                  on review (study_id);
create index idx_review_reviewer               on review (reviewer_id);
create index idx_correction_study              on correction (study_id);
create index idx_audit_entity                  on audit_log (entity, entity_id);

create index idx_ai_job_study                  on ai_job (research_study_id);
create index idx_ai_result_job                 on ai_result (job_id);
create index idx_import_candidate_job          on import_candidate (import_job_id);
create index idx_import_candidate_dup          on import_candidate (duplicate_of_study_id);

-- Lifecycle / publication-state indexes (review queue + public read path) -----
create index idx_study_publication_state       on research_study (publication_state);
create index idx_study_lifecycle_state         on research_study (lifecycle_state);

-- Deduplication support (docs/05 §11): normalized-title similarity lookups ----
create index idx_study_normalized_title        on research_study (normalized_title);

-- Full-text search preparation (docs/14 §2-3, ADR-009) -----------------------
create index idx_publication_search_vector     on publication using gin (search_vector);
