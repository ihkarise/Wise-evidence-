-- 0001_taxonomy.sql — reference taxonomy (docs/06). Real reference data, not
-- research. Study types and the evidence pyramid ranks (ranks are navigation
-- ordering, NOT a truth score).

insert into study_type (code, label, clinical, subject, hierarchy_position) values
  ('META_ANALYSIS', 'Meta-analysis', true, 'HUMAN', 1),
  ('SYSTEMATIC_REVIEW', 'Systematic Review', true, 'HUMAN', 2),
  ('RCT', 'Randomized Controlled Trial', true, 'HUMAN', 3),
  ('CONTROLLED_TRIAL', 'Controlled Clinical Trial', true, 'HUMAN', 4),
  ('COHORT', 'Cohort Study', true, 'HUMAN', 5),
  ('CASE_CONTROL', 'Case-Control Study', true, 'HUMAN', 6),
  ('CROSS_SECTIONAL', 'Cross-Sectional Study', true, 'HUMAN', 7),
  ('CASE_SERIES', 'Case Series', true, 'HUMAN', 8),
  ('CASE_REPORT', 'Case Report', true, 'HUMAN', 9),
  ('EXPERT_OPINION', 'Expert Opinion / Narrative', false, 'NOT_APPLICABLE', 10),
  ('ANIMAL', 'Animal Research', false, 'ANIMAL', 11),
  ('IN_VITRO', 'In Vitro / Basic Research', false, 'IN_VITRO', 12),
  ('OTHER_UNCLASSIFIED', 'Other / Unclassified', false, 'NOT_APPLICABLE', 13);

insert into evidence_level (code, label, pyramid_rank) values
  ('META_ANALYSIS', 'Meta-analysis', 1),
  ('SYSTEMATIC_REVIEW', 'Systematic Review', 2),
  ('RCT', 'Randomized Controlled Trial', 3),
  ('CONTROLLED_TRIAL', 'Controlled Trial', 4),
  ('OBSERVATIONAL', 'Observational', 5),
  ('CASE_SERIES', 'Case Series', 6),
  ('CASE_REPORT', 'Case Report', 7),
  ('PRECLINICAL', 'Preclinical (animal / in-vitro)', 8),
  ('EXPERT_OPINION', 'Expert Opinion', 9),
  ('OTHER', 'Other / Unclassified', 10);

insert into condition (id, slug, canonical_name, synonyms) values
  ('00000000-0000-0000-0000-0000000000c1', 'allergic-rhinitis', 'Allergic Rhinitis', '{"hay fever"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'asthma', 'Asthma', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'migraine', 'Migraine', '{}');

insert into intervention (id, slug, canonical_name, kind) values
  ('00000000-0000-0000-0000-0000000000e1', 'individualized-homeopathy', 'Individualized Homeopathy', 'regimen'),
  ('00000000-0000-0000-0000-0000000000e2', 'arnica-montana', 'Arnica montana', 'remedy'),
  ('00000000-0000-0000-0000-0000000000e3', 'galphimia-glauca', 'Galphimia glauca', 'remedy');

insert into tag (id, slug, label) values
  ('00000000-0000-0000-0000-0000000000f1', 'rct', 'RCT'),
  ('00000000-0000-0000-0000-0000000000f2', 'placebo-controlled', 'Placebo-controlled'),
  ('00000000-0000-0000-0000-0000000000f3', 'double-blind', 'Double-blind');
