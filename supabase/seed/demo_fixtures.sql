-- =============================================================================
-- WiseEvidence — DEMO fixtures. NOT REAL RESEARCH. NOT A MIGRATION.
-- =============================================================================
-- Every row here is demonstration data for local development and tests. It is
-- deliberately impossible to mistake for real research (docs/17 §10, docs/20 §6,
-- docs/25 §9):
--   * every study/publication row has is_demo = true (the column defaults to
--     false, so real inserts are never demo);
--   * every study/publication title is prefixed "[DEMO]";
--   * every demo DOI uses the reserved, non-existent registrant 10.0000/… .
-- No real scientific claim is asserted; titles/abstracts are invented.
--
-- Loaded only by the deterministic test harness and by local `supabase db reset`
-- style workflows — never shipped as a migration. Fixed UUIDs make the fixtures
-- referenceable from tests.
-- =============================================================================

-- Demo reviewer (private table; used as actor on demo overrides). -------------
insert into app_user (id, email, display_name, role) values
  ('10000000-0000-0000-0000-000000000001', 'demo-reviewer@example.invalid', '[DEMO] Reviewer', 'REVIEWER');

-- ---------------------------------------------------------------------------
-- Studies (Study != Publication). All is_demo = true.
-- ---------------------------------------------------------------------------
insert into research_study
  (id, canonical_title, normalized_title, study_type_id, subject_type,
   lifecycle_state, publication_state, is_demo)
values
  ('20000000-0000-0000-0000-000000000001', '[DEMO] Positive reported outcome trial',
   'demo positive reported outcome trial', (select id from study_type where code='RCT'),
   'HUMAN', 'PUBLISHED', 'PUBLISHED', true),
  ('20000000-0000-0000-0000-000000000002', '[DEMO] Negative reported outcome trial',
   'demo negative reported outcome trial', (select id from study_type where code='RCT'),
   'HUMAN', 'PUBLISHED', 'PUBLISHED', true),
  ('20000000-0000-0000-0000-000000000003', '[DEMO] Mixed / leaning outcome trial',
   'demo mixed leaning outcome trial', (select id from study_type where code='CONTROLLED_TRIAL'),
   'HUMAN', 'PUBLISHED', 'PUBLISHED', true),
  ('20000000-0000-0000-0000-000000000004', '[DEMO] Neutral / inconclusive trial',
   'demo neutral inconclusive trial', (select id from study_type where code='RCT'),
   'HUMAN', 'PUBLISHED', 'PUBLISHED', true),
  ('20000000-0000-0000-0000-000000000005', '[DEMO] Study with missing DOI',
   'demo study with missing doi', (select id from study_type where code='CASE_SERIES'),
   'HUMAN', 'PUBLISHED', 'PUBLISHED', true),
  ('20000000-0000-0000-0000-000000000006', '[DEMO] One study, multiple publications',
   'demo one study multiple publications', (select id from study_type where code='RCT'),
   'HUMAN', 'PUBLISHED', 'PUBLISHED', true),
  ('20000000-0000-0000-0000-000000000007', '[DEMO] AI suggestion overridden by human',
   'demo ai suggestion overridden by human', (select id from study_type where code='RCT'),
   'HUMAN', 'PUBLISHED', 'PUBLISHED', true),
  ('20000000-0000-0000-0000-000000000009', '[DEMO] Draft / unpublished study',
   'demo draft unpublished study', (select id from study_type where code='RCT'),
   'HUMAN', 'PENDING_REVIEW', 'DRAFT', true),
  ('20000000-0000-0000-0000-00000000000a', '[DEMO] Duplicate original',
   'demo duplicate title shared', (select id from study_type where code='RCT'),
   'HUMAN', 'PUBLISHED', 'PUBLISHED', true),
  ('20000000-0000-0000-0000-00000000000b', '[DEMO] Duplicate candidate (routed to review, not deleted)',
   'demo duplicate title shared', (select id from study_type where code='RCT'),
   'HUMAN', 'DUPLICATE_CANDIDATE', 'DRAFT', true);

-- ---------------------------------------------------------------------------
-- Publications. The multi-publication study (…0006) has TWO publications.
-- ---------------------------------------------------------------------------
insert into publication
  (id, study_id, title, abstract, publication_date, language, is_primary, is_demo)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   '[DEMO] Positive reported outcome trial', '[DEMO] Invented abstract for a positive-outcome demonstration record.',
   '2021-03-01', 'en', true, true),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
   '[DEMO] Negative reported outcome trial', '[DEMO] Invented abstract for a negative-outcome demonstration record.',
   '2020-07-15', 'en', true, true),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003',
   '[DEMO] Mixed / leaning outcome trial', '[DEMO] Invented abstract for a mixed-outcome demonstration record.',
   '2022-01-10', 'en', true, true),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004',
   '[DEMO] Neutral / inconclusive trial', '[DEMO] Invented abstract for a neutral/inconclusive demonstration record.',
   '2019-11-20', 'en', true, true),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005',
   '[DEMO] Study with missing DOI', '[DEMO] Invented abstract; this record intentionally has no DOI identifier.',
   '2018-05-05', 'en', true, true),
  -- Two publications for study …0006: a preprint and the primary journal article.
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006',
   '[DEMO] One study, multiple publications (preprint)', '[DEMO] Invented preprint abstract.',
   '2021-09-01', 'en', false, true),
  ('30000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000006',
   '[DEMO] One study, multiple publications (journal version)', '[DEMO] Invented journal-version abstract.',
   '2022-02-01', 'en', true, true),
  ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007',
   '[DEMO] AI suggestion overridden by human', '[DEMO] Invented abstract used to demonstrate AI-vs-human separation.',
   '2023-04-04', 'en', true, true),
  ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009',
   '[DEMO] Draft / unpublished study', '[DEMO] Invented abstract for an unpublished draft (must stay private).',
   '2024-06-06', 'en', true, true),
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '[DEMO] Duplicate original', '[DEMO] Invented abstract for the original of a duplicate pair.',
   '2020-01-01', 'en', true, true),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
   '[DEMO] Duplicate candidate', '[DEMO] Invented abstract for a fuzzy-duplicate candidate.',
   '2020-01-02', 'en', true, true);

-- ---------------------------------------------------------------------------
-- Identifiers. DOIs use the reserved non-existent registrant 10.0000/…
-- Study …0005 deliberately has NO DOI (missing-DOI case).
-- The duplicate candidate has a DISTINCT DOI (fuzzy dup by title, not exact id).
-- ---------------------------------------------------------------------------
insert into research_identifier (publication_id, type, value_raw, value_canonical) values
  ('30000000-0000-0000-0000-000000000001', 'DOI', 'https://doi.org/10.0000/wise.demo.positive', '10.0000/wise.demo.positive'),
  ('30000000-0000-0000-0000-000000000002', 'DOI', 'https://doi.org/10.0000/wise.demo.negative', '10.0000/wise.demo.negative'),
  ('30000000-0000-0000-0000-000000000003', 'DOI', 'https://doi.org/10.0000/wise.demo.mixed',    '10.0000/wise.demo.mixed'),
  ('30000000-0000-0000-0000-000000000004', 'DOI', 'https://doi.org/10.0000/wise.demo.neutral',  '10.0000/wise.demo.neutral'),
  ('30000000-0000-0000-0000-000000000006', 'DOI', 'https://doi.org/10.0000/wise.demo.multipub.preprint', '10.0000/wise.demo.multipub.preprint'),
  ('30000000-0000-0000-0000-000000000016', 'DOI', 'https://doi.org/10.0000/wise.demo.multipub.journal',  '10.0000/wise.demo.multipub.journal'),
  ('30000000-0000-0000-0000-000000000007', 'DOI', 'https://doi.org/10.0000/wise.demo.aioverride', '10.0000/wise.demo.aioverride'),
  ('30000000-0000-0000-0000-00000000000a', 'DOI', 'https://doi.org/10.0000/wise.demo.dup.original',  '10.0000/wise.demo.dup.original'),
  ('30000000-0000-0000-0000-00000000000b', 'DOI', 'https://doi.org/10.0000/wise.demo.dup.candidate', '10.0000/wise.demo.dup.candidate');

-- ---------------------------------------------------------------------------
-- Taxonomy links (illustrative).
-- ---------------------------------------------------------------------------
insert into study_condition (study_id, condition_id)
select s.id, (select id from condition where slug='asthma')
from research_study s where s.id in (
  '20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');

insert into study_intervention (study_id, intervention_id)
select s.id, (select id from intervention where slug='individualized-homeopathy')
from research_study s where s.id in (
  '20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- Outcome classifications (human-reviewed final values). Independent per study.
-- ---------------------------------------------------------------------------
insert into classification
  (study_id, dimension, final_value, final_actor, confidence, explanation) values
  ('20000000-0000-0000-0000-000000000001', 'OUTCOME', 'POSITIVE',
   '10000000-0000-0000-0000-000000000001', 'MODERATE', '[DEMO] Primary endpoint favoured the intervention.'),
  ('20000000-0000-0000-0000-000000000002', 'OUTCOME', 'NEGATIVE',
   '10000000-0000-0000-0000-000000000001', 'HIGH', '[DEMO] Adequately powered null on the primary endpoint.'),
  ('20000000-0000-0000-0000-000000000003', 'OUTCOME', 'LEANING_POSITIVE',
   '10000000-0000-0000-0000-000000000001', 'LOW', '[DEMO] Split endpoints; leaning positive.'),
  ('20000000-0000-0000-0000-000000000004', 'OUTCOME', 'NEUTRAL_INCONCLUSIVE',
   '10000000-0000-0000-0000-000000000001', 'LOW', '[DEMO] Underpowered; inconclusive.');

-- Quality on the positive study, stored independently of its outcome.
insert into evidence_quality_assessment (study_id, dimension, value, note, actor) values
  ('20000000-0000-0000-0000-000000000001', 'BLINDING', 'ADEQUATE', '[DEMO] Double-blind.',
   '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001', 'SAMPLE_SIZE', 'UNCLEAR', '[DEMO] Power calculation not reported.',
   '10000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Criticism on the POSITIVE study — a positive outcome can still carry criticism
-- (docs/09 §4). Adding it changes no outcome value.
-- ---------------------------------------------------------------------------
insert into criticism (study_id, category, origin, text, actor, status) values
  ('20000000-0000-0000-0000-000000000001', 'SAMPLE_SIZE', 'REVIEWER_ASSESSED',
   '[DEMO] Small sample limits the strength of the positive finding.',
   '10000000-0000-0000-0000-000000000001', 'ACTIVE');

-- ---------------------------------------------------------------------------
-- AI suggestion overridden by human (study …0007). AI wrote only to ai_job/
-- ai_result; the human final value lives in classification.final_value and
-- differs from the AI suggestion. Both are preserved.
-- ---------------------------------------------------------------------------
insert into ai_job
  (id, research_study_id, operation, provider, model, prompt_version, input_hash, status)
values
  ('40000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007',
   'outcome-classification', 'mock', 'demo-model', 'v1', 'demo-input-hash-0007', 'SUCCEEDED');

insert into ai_result (id, job_id, structured_output, confidence, validation_status) values
  ('50000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000007',
   '{"outcome": "POSITIVE", "rationale": "[DEMO] AI read the abstract as positive."}', 0.700, 'VALID');

insert into classification
  (study_id, dimension, final_value, final_actor, final_reason, ai_result_id, confidence, explanation)
values
  ('20000000-0000-0000-0000-000000000007', 'OUTCOME', 'LEANING_POSITIVE',
   '10000000-0000-0000-0000-000000000001', 'AI misread primary endpoint',
   '50000000-0000-0000-0000-000000000007', 'MODERATE',
   '[DEMO] Human downgraded AI POSITIVE to LEANING_POSITIVE after reading full text.');

insert into review (study_id, reviewer_id, action, dimensions, before_snapshot, after_snapshot, reason) values
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'EDIT',
   '{OUTCOME}', '{"outcome":"POSITIVE","source":"ai"}', '{"outcome":"LEANING_POSITIVE","source":"human"}',
   'AI misread primary endpoint');

insert into audit_log (actor, action, entity, entity_id, field, before, after, reason) values
  ('10000000-0000-0000-0000-000000000001', 'override_ai_outcome', 'classification',
   '20000000-0000-0000-0000-000000000007', 'final_value', '"POSITIVE"', '"LEANING_POSITIVE"',
   'AI misread primary endpoint');

-- ---------------------------------------------------------------------------
-- Draft study (…0009): unpublished, plus an AI-only OUTCOME suggestion whose
-- human final_value is still NULL (pending review). Must stay private.
-- ---------------------------------------------------------------------------
insert into ai_job
  (id, research_study_id, operation, provider, model, prompt_version, input_hash, status)
values
  ('40000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009',
   'outcome-classification', 'mock', 'demo-model', 'v1', 'demo-input-hash-0009', 'SUCCEEDED');

insert into ai_result (id, job_id, structured_output, confidence, validation_status) values
  ('50000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000009',
   '{"outcome": "POSITIVE"}', 0.550, 'VALID');

insert into classification (study_id, dimension, final_value, ai_result_id, confidence) values
  ('20000000-0000-0000-0000-000000000009', 'OUTCOME', null,
   '50000000-0000-0000-0000-000000000009', 'LOW');

-- ---------------------------------------------------------------------------
-- Duplicate candidate routed to review, never deleted (docs/05 §11). Same
-- normalized_title as the original; linked via an import candidate.
-- ---------------------------------------------------------------------------
insert into import_job (id, trigger, state, counts) values
  ('60000000-0000-0000-0000-000000000001', 'MANUAL', 'COMPLETED', '{"discovered": 1, "duplicates": 1}');

insert into import_candidate
  (import_job_id, raw_payload, dedup_decision, duplicate_of_study_id, state)
values
  ('60000000-0000-0000-0000-000000000001',
   '{"title": "[DEMO] Duplicate candidate", "note": "fuzzy title match"}',
   'title-similarity match → routed to human review (not auto-deleted)',
   '20000000-0000-0000-0000-00000000000a', 'DUPLICATE_CANDIDATE');
