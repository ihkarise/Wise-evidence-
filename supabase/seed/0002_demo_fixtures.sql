-- 0002_demo_fixtures.sql
-- CLEARLY-LABELED DEMO / TEST DATA (docs/17 §10). Every study has is_demo = true
-- and a "[DEMO]" title. These are NOT real research and must never be presented
-- as actual scientific publications. DOIs use the 10.5555 test prefix.
--
-- Covers the ten required fixture scenarios (docs/23 Phase L):
-- 1 positive · 2 negative · 3 mixed · 4 neutral/inconclusive · 5 missing DOI ·
-- 6 duplicate candidate · 7 multiple publications for one study ·
-- 8 AI classification overridden by human · 9 criticism attached ·
-- 10 unpublished/draft.

-- Demo privileged users -------------------------------------------------------
insert into app_user (id, auth_id, email, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'reviewer@demo.invalid', 'Demo Reviewer', 'REVIEWER'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'admin@demo.invalid', 'Demo Admin', 'ADMIN');

-- Shared venue / people / source ---------------------------------------------
insert into journal (id, normalized_name, display_name, issn) values
  ('00000000-0000-0000-0000-000000000701', 'demo journal of homeopathy research', 'Demo Journal of Homeopathy Research', '{"0000-0000"}');

insert into author (id, normalized_name, display_name) values
  ('00000000-0000-0000-0000-000000000801', 'demo author one', 'Demo Author One'),
  ('00000000-0000-0000-0000-000000000802', 'demo author two', 'Demo Author Two');

insert into research_source (id, source_name, source_url, import_method, external_id) values
  ('00000000-0000-0000-0000-000000000901', 'Demo Manual Import', 'https://example.invalid/demo', 'MANUAL', 'demo-src-1');

-- Studies ---------------------------------------------------------------------
insert into research_study (id, canonical_title, study_type_code, subject, lifecycle_state, is_demo) values
  ('00000000-0000-0000-0000-000000001001', '[demo] individualized homeopathy for allergic rhinitis', 'RCT', 'HUMAN', 'PUBLISHED', true),          -- 1 positive (+9 criticism)
  ('00000000-0000-0000-0000-000000001002', '[demo] homeopathic arnica for post-operative recovery', 'RCT', 'HUMAN', 'PUBLISHED', true),              -- 2 negative
  ('00000000-0000-0000-0000-000000001003', '[demo] adjunctive homeopathy in migraine prophylaxis', 'CONTROLLED_TRIAL', 'HUMAN', 'PUBLISHED', true),   -- 3 mixed
  ('00000000-0000-0000-0000-000000001004', '[demo] galphimia glauca versus placebo in rhinitis', 'RCT', 'HUMAN', 'PUBLISHED', true),                  -- 4 neutral
  ('00000000-0000-0000-0000-000000001005', '[demo] observational report without a doi', 'CASE_SERIES', 'HUMAN', 'PUBLISHED', true),                   -- 5 missing DOI
  ('00000000-0000-0000-0000-000000001006', '[demo] duplicate candidate of the rhinitis trial', 'RCT', 'HUMAN', 'DUPLICATE_CANDIDATE', true),          -- 6 duplicate candidate
  ('00000000-0000-0000-0000-000000001007', '[demo] multi-publication homeopathy trial', 'RCT', 'HUMAN', 'PUBLISHED', true),                           -- 7 multiple publications
  ('00000000-0000-0000-0000-000000001008', '[demo] ai-overridden classification study', 'RCT', 'HUMAN', 'PUBLISHED', true),                           -- 8 AI override
  ('00000000-0000-0000-0000-000000001010', '[demo] draft unpublished study', 'RCT', 'HUMAN', 'PENDING_REVIEW', true);                                 -- 10 draft

-- Study <-> taxonomy links ----------------------------------------------------
insert into study_condition (study_id, condition_id) values
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-0000000000c1');
insert into study_intervention (study_id, intervention_id) values
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-000000001004', '00000000-0000-0000-0000-0000000000e3');
insert into study_tag (study_id, tag_id) values
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-0000000000f2');

-- Publications ----------------------------------------------------------------
insert into publication (id, study_id, title, abstract, publication_date, journal_id, source_id, publication_state, is_primary) values
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000001001', '[DEMO] Individualized homeopathy for allergic rhinitis', 'Demo abstract. Not a real study.', '2022-01-15', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000901', 'PUBLISHED', true),
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000001002', '[DEMO] Homeopathic arnica for post-operative recovery', 'Demo abstract. Not a real study.', '2021-06-10', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000901', 'PUBLISHED', true),
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000001003', '[DEMO] Adjunctive homeopathy in migraine prophylaxis', 'Demo abstract. Not a real study.', '2023-03-01', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000901', 'PUBLISHED', true),
  ('00000000-0000-0000-0000-000000002004', '00000000-0000-0000-0000-000000001004', '[DEMO] Galphimia glauca versus placebo in rhinitis', 'Demo abstract. Not a real study.', '2020-09-20', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000901', 'PUBLISHED', true),
  ('00000000-0000-0000-0000-000000002005', '00000000-0000-0000-0000-000000001005', '[DEMO] Observational report without a DOI', 'Demo abstract. Not a real study.', '2019-02-05', null, '00000000-0000-0000-0000-000000000901', 'PUBLISHED', true),
  ('00000000-0000-0000-0000-000000002006', '00000000-0000-0000-0000-000000001006', '[DEMO] Duplicate candidate of the rhinitis trial', 'Demo abstract. Not a real study.', '2022-01-20', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000901', 'DRAFT', true),
  ('00000000-0000-0000-0000-000000002007', '00000000-0000-0000-0000-000000001007', '[DEMO] Multi-publication homeopathy trial (journal article)', 'Demo abstract. Not a real study.', '2023-05-01', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000901', 'PUBLISHED', true),
  ('00000000-0000-0000-0000-000000002008', '00000000-0000-0000-0000-000000001007', '[DEMO] Multi-publication homeopathy trial (preprint)', 'Demo abstract. Not a real study.', '2023-01-01', null, '00000000-0000-0000-0000-000000000901', 'PUBLISHED', false),
  ('00000000-0000-0000-0000-000000002009', '00000000-0000-0000-0000-000000001008', '[DEMO] AI-overridden classification study', 'Demo abstract. Not a real study.', '2024-02-02', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000901', 'PUBLISHED', true),
  ('00000000-0000-0000-0000-000000002010', '00000000-0000-0000-0000-000000001010', '[DEMO] Draft unpublished study', 'Demo abstract. Not a real study.', null, null, '00000000-0000-0000-0000-000000000901', 'DRAFT', true);

insert into publication_author (publication_id, author_id, author_position) values
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000801', 1),
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000802', 2);

-- Identifiers (canonical values already lowercased). Scenario 5 has NO DOI. -----
insert into research_identifier (publication_id, id_type, value_raw, value_canonical) values
  ('00000000-0000-0000-0000-000000002001', 'DOI', 'https://doi.org/10.5555/demo.0001', '10.5555/demo.0001'),
  ('00000000-0000-0000-0000-000000002002', 'DOI', 'https://doi.org/10.5555/demo.0002', '10.5555/demo.0002'),
  ('00000000-0000-0000-0000-000000002003', 'DOI', 'https://doi.org/10.5555/demo.0003', '10.5555/demo.0003'),
  ('00000000-0000-0000-0000-000000002004', 'DOI', 'https://doi.org/10.5555/demo.0004', '10.5555/demo.0004'),
  ('00000000-0000-0000-0000-000000002005', 'URL', 'https://example.invalid/demo/report-2019', 'https://example.invalid/demo/report-2019'),
  ('00000000-0000-0000-0000-000000002007', 'DOI', 'https://doi.org/10.5555/demo.0007', '10.5555/demo.0007'),
  ('00000000-0000-0000-0000-000000002008', 'URL', 'https://example.invalid/demo/preprint-0007', 'https://example.invalid/demo/preprint-0007'),
  ('00000000-0000-0000-0000-000000002009', 'DOI', 'https://doi.org/10.5555/demo.0008', '10.5555/demo.0008');

-- AI job + result for scenario 8 (AI suggested POSITIVE) ----------------------
insert into ai_job (id, study_id, operation, provider, model, prompt_version, input_hash, status) values
  ('00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000001008', 'CLASSIFY_OUTCOME', 'mock', 'mock-cheap-v1', 'outcome-classification-v1', 'demohash0008', 'SUCCEEDED');
insert into ai_result (id, job_id, output, suggested_value, confidence) values
  ('00000000-0000-0000-0000-000000003101', '00000000-0000-0000-0000-000000003001', '{"outcome":"POSITIVE","rationale":"demo"}', 'POSITIVE', 'MODERATE');

-- Human classifications (final values). final_actor is always a human reviewer.
-- Scenario 8: human set LEANING_POSITIVE, overriding the AI POSITIVE suggestion;
-- both the ai_result (POSITIVE) and this final value (LEANING_POSITIVE) persist.
insert into classification (study_id, dimension, value, judgement_confidence, ai_result_id, final_actor, final_reason) values
  ('00000000-0000-0000-0000-000000001001', 'OUTCOME', 'POSITIVE', 'MODERATE', null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001001', 'QUALITY', 'ADEQUATE', 'MODERATE', null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001001', 'CONFIDENCE', 'MODERATE', null, null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001001', 'EVIDENCE_LEVEL', 'RCT', null, null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001001', 'STUDY_TYPE', 'RCT', null, null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001002', 'OUTCOME', 'NEGATIVE', 'HIGH', null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001002', 'QUALITY', 'ADEQUATE', 'HIGH', null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001003', 'OUTCOME', 'LEANING_POSITIVE', 'LOW', null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001004', 'OUTCOME', 'NEUTRAL_INCONCLUSIVE', 'MODERATE', null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001005', 'OUTCOME', 'NEUTRAL_INCONCLUSIVE', 'LOW', null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001007', 'OUTCOME', 'POSITIVE', 'MODERATE', null, '00000000-0000-0000-0000-0000000000a1', null),
  ('00000000-0000-0000-0000-000000001008', 'OUTCOME', 'LEANING_POSITIVE', 'MODERATE', '00000000-0000-0000-0000-000000003101', '00000000-0000-0000-0000-0000000000a1', 'AI over-read a secondary endpoint; primary endpoint was mixed.');

-- Scenario 9: criticism attached to the positive study (author-reported), which
-- does NOT change its POSITIVE outcome — criticism != negative outcome.
insert into criticism (study_id, category, origin, body, actor) values
  ('00000000-0000-0000-0000-000000001001', 'SAMPLE_SIZE', 'AUTHOR_REPORTED', 'Authors noted a small sample limited statistical power.', null);

-- Scenario 6: duplicate candidate routed to review (never auto-deleted). An
-- import candidate points at the already-published rhinitis study as the likely
-- original; a human confirms/rejects the link.
insert into import_job (id, source_name, trigger, state) values
  ('00000000-0000-0000-0000-000000004001', 'Demo Manual Import', 'MANUAL', 'REVIEW_REQUIRED');
insert into import_candidate (id, job_id, normalized_payload, state, duplicate_of_study_id) values
  ('00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004001', '{"title":"individualized homeopathy for allergic rhinitis"}', 'DUPLICATE_CANDIDATE', '00000000-0000-0000-0000-000000001001');
