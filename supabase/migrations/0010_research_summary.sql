-- 0010_research_summary.sql
-- Human-authored concise summary for a study (docs/05 §15). This is NOT an AI
-- summary and is never auto-generated; it is distinct from publication.abstract
-- (the source's abstract). A reviewer/admin writes it during the M3 workflow.

alter table research_study add column summary text;

comment on column research_study.summary is
  'Human-authored concise summary. Distinct from publication.abstract; never AI-generated or auto-copied (docs/05 §15).';
