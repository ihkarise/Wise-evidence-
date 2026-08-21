-- 0012_explorer_search_index.sql
-- Study-level full-text index for the public explorer (ADR-014, docs/14).
-- Index-backs the relevance core (study title + human summary). Broader recall
-- (authors/conditions/interventions/abstract) is matched at query time over the
-- already-PUBLISHED-filtered candidate set. No pg_trgm / vector search (Phase 26-27).

create index research_study_fts_idx on research_study
  using gin (to_tsvector('english', canonical_title || ' ' || coalesce(summary, '')));
