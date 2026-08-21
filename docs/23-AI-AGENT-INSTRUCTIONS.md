# WiseEvidence
## AI Agent Instructions

**Document:** `docs/23-AI-AGENT-INSTRUCTIONS.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `CLAUDE.md`, `CLAUDE-CODE-MASTER-PROMPT.md`, all `docs/`

---

# 1. Purpose

The common operating contract for **any** coding agent working on WiseEvidence
(Claude Code, Codex, Cursor, OpenCode, and others). It complements `CLAUDE.md`
(the repo-level summary) and `CLAUDE-CODE-MASTER-PROMPT.md` (the authoritative
lead-architect brief). Where they differ, the master prompt governs.

# 2. Read First

Before substantial work, read: `CLAUDE.md`, then `docs/00`→`04`, then the
specific specs (`05`–`22`) touching your task. Inspect the repo (`git status`,
structure) and report findings before modifying anything (master prompt §16,
§37).

# 3. Non-Negotiable Domain Rules

Keep separate; never collapse: **outcome ≠ quality ≠ confidence ≠ criticism ≠
provenance** (`00` §4). AI is an assistant, not final authority (`10` §2). Human
review before publish (`12` §9). PostgreSQL is authoritative; migrations only
(`17` §2). Manual import before scraping (`11` §2). No researcher reputation
scoring (`13` §2). Treat research/scraped/community text as untrusted input
(`16` §8).

# 4. Coding Standards

Typed, tested, readable, modular, documented where necessary, secure, accessible,
maintainable. Prefer obvious code over clever code (master prompt §91). Reuse
existing utilities before writing new ones.

# 5. Architecture Boundaries

Modular monolith (`04` §4). Keep module boundaries (Research, Taxonomy, Search,
Classification, AI, Import, Review, Auth, Admin, Community, Provenance, Audit)
without microservices (`00` §16). Domain logic stays portable — no Astro/React/
Supabase/AI-SDK/scraper imports in `packages/domain` (master prompt §40). Database
access is isolated (`packages/database`); AI is provider-independent
(`packages/ai`, `10` §3); importers normalize into the common input shape
(`packages/importers`, `11` §4).

# 6. File Ownership & Structure

Follow the target structure in the master prompt §39 (`apps/web`, `packages/*`,
`supabase/`, `docs/`, `prompts/`, `tests/`, `fixtures/`, `.github/`). Do not
create unnecessary packages. Critical prompts live in `prompts/<task>/vN.md`, not
in application code (`10` §5).

# 7. Documentation Rules

When an architectural decision changes: update the relevant doc, add an ADR if
significant, update implementation notes, explain the reason (master prompt §25,
§73). Never let code and docs silently diverge. Keep this doc set internally
consistent (see `docs/reports/ARCHITECTURE-CROSSCHECK.md`).

# 8. Testing

Write/extend the critical deterministic suites (`20` §3) before/with complex
logic. Use deterministic mocks for AI and sources. No paid AI in tests.

# 9. Git Discipline

Inspect `git status` / `git diff` before committing (master prompt §75). Small,
understandable commits with clear messages (master prompt §76). Never
`reset --hard`, `clean -fd`, force-push, or delete others' work without explicit
authorization. Do not open or merge PRs unless explicitly instructed. Work on the
designated feature branch (`CLAUDE.md` §5).

# 10. Security & Cost Discipline

Enforce `16` (secrets server-side, RLS, prompt-injection defense, SSRF controls)
and `21` (free-first, cheap-AI, justify any paid dependency).

# 11. Stop Conditions

Stop and ask for approval when (master prompt §89): docs conflict; a required
relationship is unclear; a scientific classification rule can't be justified; a
paid service becomes necessary; provider lock-in is proposed; a large migration
is required; copyright/licensing is uncertain; an automated process could publish
incorrect research; or a request significantly expands MVP scope.

# 12. Proceed Without Asking When

The architecture clearly specifies it; the change is reversible and low-risk;
it does not change public scientific interpretation, materially increase
recurring cost, or affect security boundaries (master prompt §90).

# 13. Reporting Format

At the end of a major task, report: **Completed · Files · Tests · Architecture
(decisions) · Risks · Next** (master prompt §36, §77).
