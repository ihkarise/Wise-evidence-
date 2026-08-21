-- 0008_indexes_fts.sql
-- Deliberate indexes (docs/05 §12, docs/23 Phase P). Unique constraints already
-- create indexes for research_identifier(id_type,value_canonical) and the slug
-- columns, so those are not repeated here.

-- Study / publication read + review-queue paths
create index research_study_lifecycle_idx on research_study (lifecycle_state);
create index publication_study_idx on publication (study_id);
create index publication_state_idx on publication (publication_state);
create index publication_date_idx on publication (publication_date);

-- Relationship reverse-lookups (PKs cover the forward direction)
create index publication_author_author_idx on publication_author (author_id);
create index study_condition_condition_idx on study_condition (condition_id);
create index study_intervention_intervention_idx on study_intervention (intervention_id);
create index study_tag_tag_idx on study_tag (tag_id);

-- Identifiers, classification, criticism
create index research_identifier_value_idx on research_identifier (value_canonical);
create index classification_study_idx on classification (study_id);
create index criticism_study_idx on criticism (study_id);

-- AI, review, correction
create index ai_job_study_idx on ai_job (study_id);
create index ai_result_job_idx on ai_result (job_id);
create index review_study_idx on review (study_id);
create index correction_study_idx on correction (study_id);

-- Dedup / matching helpers
create index author_normalized_idx on author (normalized_name);
create index journal_normalized_idx on journal (normalized_name);

-- Prepare PostgreSQL full-text search (docs/14, ADR-009). No search UI is built
-- in M2 — this only lays the index so search can be added without a rewrite.
create index publication_fts_idx on publication
  using gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(abstract, '')));
