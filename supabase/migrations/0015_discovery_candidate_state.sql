-- 0015_discovery_candidate_state.sql
-- Milestone 7 (Automated Research Discovery). Add a terminal REJECTED state for
-- import candidates a reviewer declines. Additive enum change only; the value is
-- not used in this migration (Postgres forbids using a new enum value in the same
-- transaction that adds it). Existing states are unchanged.
alter type import_state add value if not exists 'REJECTED';
