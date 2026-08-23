-- 0014_ai_staff_write.sql
-- Milestone 6 (ADR-016). AI enrichment is STAFF-triggered: reviewers, not only
-- admins, generate AI suggestions while reviewing. Widen ai_job / ai_result
-- WRITE from admin-only to reviewer-or-admin, and keep results append-only
-- (insert only; no update/delete policy — provenance is immutable, docs/10 §4).
--
-- This does NOT weaken any canonical boundary: AI writes ONLY to these provenance
-- tables. Human-final classification is still reviewer/admin via setClassification
-- (0011), and publication is still ADMIN-only (fail-closed, service.ts). AI never
-- writes classification, never changes lifecycle/publication state.

drop policy if exists ai_job_admin_write on ai_job;
drop policy if exists ai_result_admin_write on ai_result;

-- ai_job: staff may create an attempt and update its status (PENDING → SUCCEEDED/FAILED).
create policy ai_job_staff_insert on ai_job for insert to authenticated
  with check (app.is_reviewer_or_admin());
create policy ai_job_staff_update on ai_job for update to authenticated
  using (app.is_reviewer_or_admin()) with check (app.is_reviewer_or_admin());

-- ai_result: staff may insert a result; results are immutable (no update/delete).
create policy ai_result_staff_insert on ai_result for insert to authenticated
  with check (app.is_reviewer_or_admin());
