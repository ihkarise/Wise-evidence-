-- WiseEvidence — Milestone 2 Database Foundation
-- Migration 0009: canonical REFERENCE data (taxonomy-v1). This is production-safe
-- reference seed — the versioned taxonomy the application needs to function
-- (docs/06). It is NOT demo research: no studies, publications, or claims here.
-- Demo research fixtures live separately in supabase/seed/ and are never a
-- migration (docs/17 §10, docs/25 §9).

-- Taxonomy version -----------------------------------------------------------
insert into taxonomy_version (code, description)
values ('taxonomy-v1', 'Initial WiseEvidence study-type and evidence-level taxonomy (docs/06).');

-- Evidence levels — pyramid_rank is a NAVIGATION ORDERING, not a truth score
-- (docs/06 §4). ---------------------------------------------------------------
insert into evidence_level (code, label, pyramid_rank, taxonomy_version_id)
select v.code, v.label, v.rank,
       (select id from taxonomy_version where code = 'taxonomy-v1')
from (values
  ('META_ANALYSIS',    'Meta-analysis',        1),
  ('SYSTEMATIC_REVIEW','Systematic Review',    2),
  ('RCT',              'Randomized Controlled Trial', 3),
  ('CONTROLLED_TRIAL', 'Controlled Trial',     4),
  ('OBSERVATIONAL',    'Observational',        5),
  ('CASE_SERIES',      'Case Series',          6),
  ('CASE_REPORT',      'Case Report',          7),
  ('PRECLINICAL',      'Preclinical',          8),
  ('EXPERT_OPINION',   'Expert Opinion / Narrative', 9),
  ('OTHER',            'Other / Unclassified', 10)
) as v(code, label, rank);

-- Study types (docs/06 §3) mapped to their coarser evidence level. ------------
insert into study_type
  (code, label, is_clinical, subject_type, evidence_level_id,
   hierarchy_position, taxonomy_version_id)
select s.code, s.label, s.is_clinical, s.subject::subject_type,
       (select id from evidence_level where code = s.level),
       s.pos,
       (select id from taxonomy_version where code = 'taxonomy-v1')
from (values
  ('META_ANALYSIS',      'Meta-analysis',                 true,  'HUMAN',          'META_ANALYSIS',     1),
  ('SYSTEMATIC_REVIEW',  'Systematic Review',             true,  'HUMAN',          'SYSTEMATIC_REVIEW', 2),
  ('RCT',                'Randomized Controlled Trial',   true,  'HUMAN',          'RCT',               3),
  ('CONTROLLED_TRIAL',   'Controlled Clinical Trial',     true,  'HUMAN',          'CONTROLLED_TRIAL',  4),
  ('COHORT',             'Cohort Study',                  true,  'HUMAN',          'OBSERVATIONAL',     5),
  ('CASE_CONTROL',       'Case-Control Study',            true,  'HUMAN',          'OBSERVATIONAL',     6),
  ('CROSS_SECTIONAL',    'Cross-Sectional Study',         true,  'HUMAN',          'OBSERVATIONAL',     7),
  ('CASE_SERIES',        'Case Series',                   true,  'HUMAN',          'CASE_SERIES',       8),
  ('CASE_REPORT',        'Case Report',                   true,  'HUMAN',          'CASE_REPORT',       9),
  ('EXPERT_OPINION',     'Expert Opinion / Narrative',    false, 'NOT_APPLICABLE', 'EXPERT_OPINION',    10),
  ('ANIMAL',             'Animal Research',               false, 'ANIMAL',         'PRECLINICAL',       11),
  ('IN_VITRO',           'In Vitro / Basic Research',     false, 'IN_VITRO',       'PRECLINICAL',       12),
  ('OTHER_UNCLASSIFIED', 'Other / Unclassified',          false, 'NOT_APPLICABLE', 'OTHER',             13)
) as s(code, label, is_clinical, subject, level, pos);

-- Starter curated taxonomy (admin-extendable). These are catalogue entries, not
-- scientific claims. --------------------------------------------------------
insert into condition (canonical_name, slug, synonyms) values
  ('Asthma',                'asthma',                '{"bronchial asthma"}'),
  ('Allergic Rhinitis',     'allergic-rhinitis',     '{"hay fever"}'),
  ('Osteoarthritis',        'osteoarthritis',        '{"degenerative joint disease"}'),
  ('Depression',            'depression',            '{"major depressive disorder"}'),
  ('Migraine',              'migraine',              '{}');

insert into intervention (canonical_name, slug, intervention_type, synonyms) values
  ('Individualized Homeopathy', 'individualized-homeopathy', 'REGIMEN', '{"classical homeopathy"}'),
  ('Arnica montana',            'arnica-montana',            'REMEDY',  '{"arnica"}'),
  ('Potency 30C',               'potency-30c',               'POTENCY', '{"30ch"}'),
  ('Placebo',                   'placebo',                   'OTHER',   '{}');

insert into tag (label, slug) values
  ('Placebo-controlled', 'placebo-controlled'),
  ('Preprint',           'preprint'),
  ('Protocol',           'protocol'),
  ('Replication',        'replication');
