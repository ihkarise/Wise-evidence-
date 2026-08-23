-- 0013_ai_evidence_level_operation.sql
-- Milestone 6 (AI enrichment, ADR-016). The sixth suggestion task is evidence
-- level; it needs its own ai_operation so every AI result keeps an operation for
-- provenance/caching. Additive enum change only — no data is modified, and AI
-- still writes ONLY to ai_job/ai_result, never to canonical classification.
alter type ai_operation add value if not exists 'CLASSIFY_EVIDENCE_LEVEL';
