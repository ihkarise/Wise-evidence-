# WiseEvidence
## Security

**Document:** `docs/16-SECURITY.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `04-SYSTEM-ARCHITECTURE.md`, `10-AI-ARCHITECTURE.md`, `11-DATA-IMPORT-ARCHITECTURE.md`, `17-DATA-GOVERNANCE.md`

---

# 1. Purpose

Define the security posture. The overriding rule: **security must not depend on
client-side hiding** (`04` §15). Privileged logic and secrets live server-side.

# 2. Authentication

- Authentication required for `REVIEWER` and `ADMIN` (and future privileged
  contributors). Public browsing needs no login (`04` §39).
- Auth via Supabase Auth; the frontend holds no privileged secrets (`04` §8, §11).

# 3. Authorization

- Roles: `PUBLIC | REVIEWER | ADMIN` (future: SENIOR_REVIEWER, DATA_CURATOR,
  SOURCE_MANAGER) (`04` §40).
- Reviewers never receive database-admin privileges (master prompt §53).
- Authorization is enforced server-side and in the database (RLS), not in the UI.

# 4. Row-Level Security (RLS)

- Public read path exposes only `PUBLISHED` records and their published fields
  (`05` §7, §13).
- Drafts, review queue, AI results, corrections, and audit are restricted to
  authenticated privileged roles.
- RLS policies are the enforcement boundary; the UI merely reflects them
  (`04` §15).

**M3 reviewer-write extension (migration 0011).** M2 made all `research_study`/
`publication` writes admin-only. M3 extends RLS so a REVIEWER may create and edit
research and drive it up to `PENDING_REVIEW`/`REJECTED` (and create reference
`author`/`journal`/`research_source` rows), matching the `docs/12` workflow —
but a reviewer's UPDATE `WITH CHECK` forbids setting `PUBLISHED`/`ARCHIVED`, which
remain **admin-only** (`12` §9a). Taxonomy tables, `app_user`, `ai_*`, `import_*`,
and audit inserts stay as in M2. Reviewer permissions are broadened only for the
exact M3 workflow; everything remains fail-closed and role changes stay
admin-only.

# 5. Secrets

Never expose to the frontend (`04` §41, master prompt §53):
service-role keys, AI provider secrets, database admin credentials, private
source credentials. Secrets are configured via environment/secret storage
(`19`), never committed.

# 6. API Security

- Prefer domain operations over table-CRUD endpoints (`04` §16).
- Validate and authorize every privileged operation server-side (`04` §11).
- Rate-limit public and community endpoints (`13` §7).

# 7. Input Validation

Validate all input: admin forms, community submissions, DOI/URL entry, search
queries. Reject malformed AI output (`10` §6). Defend against XSS, CSRF (where
relevant), and SSRF (especially in metadata fetch / URL import — restrict
outbound fetch targets) (master prompt §30).

# 8. Untrusted Research Content (critical)

Research abstracts, article text, scraped web pages, and community text are
**untrusted input** and are treated strictly as data (master prompt §30, §66,
`10` §12):
- Paper/scraped/community text must **never** override system instructions.
- The AI pipeline separates instruction context from untrusted content and
  constrains models to validated structured outputs.
- Instruction-like strings inside a paper are content to classify, not commands.

# 9. Webhook / Automation Security

Automation triggers (GitHub Actions, Supabase scheduling, future Hermes) and any
webhooks are authenticated and validated. Automation failure must not break the
core application (`04` §46, `11` §11).

# 10. SSRF & Fetch Controls

Metadata/URL import fetches only permitted, expected hosts; block internal
network ranges and unexpected schemes. Respect robots rules, rate limits, terms,
and licensing (`04` §29, `11` §5).

# 11. Audit & Abuse Prevention

- Append-only audit log for privileged actions (`04` §21, `05` §10).
- Rate limiting, submission validation, and moderation guard against abuse
  (`13` §7).

# 12. Error Handling

Never silently swallow import, AI, database, validation, or auth errors (master
prompt §65). Errors are logged and surfaced appropriately without leaking secrets
or internal detail to the public.

# 13. Security Reporting

A responsible-disclosure process is documented in `18-OPEN-SOURCE-GOVERNANCE.md`
and will be reflected in a `SECURITY.md` file at Milestone 1. Security-sensitive
findings are handled privately before public disclosure.
