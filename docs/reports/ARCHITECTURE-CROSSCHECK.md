# WiseEvidence — Architecture Cross-Check & Contradiction Report

**Document:** `docs/reports/ARCHITECTURE-CROSSCHECK.md`
**Version:** 0.1.0
**Status:** Milestone 0 output
**Date:** 2026-08-21

---

# 1. Purpose

Cross-read the full architecture set (`docs/00`–`23`, ADRs, `CLAUDE.md`,
`CLAUDE-CODE-MASTER-PROMPT.md`) for contradictions, ambiguities, and gaps, and
record each with a resolution or an explicit open decision. No silent
contradiction is left standing (master prompt §Phase-C, §89).

# 2. Method

For each cross-cutting concept (outcome model, study/publication counting, AI
boundary, roles, search, cost, automation) the drafted docs `00`–`04` were
compared against the new specs `05`–`23` and the master prompt. Findings below.

# 3. Findings & Resolutions

## F-1 — Outcome labels vs enum (RESOLVED)
- **Docs 00 §7 / 02 §4** list outcome *labels*: "Strong Positive … Mixed/Leaning
  Positive … Neutral/Inconclusive …".
- **Master prompt §5** lists an *enum*: `STRONG_POSITIVE … LEANING_POSITIVE …
  NEUTRAL_INCONCLUSIVE …`.
- **Resolution:** `07-OUTCOME-CLASSIFICATION.md` §2 makes the **enum canonical**
  (stored form) and the **label the display form**, with an explicit mapping.
  `LEANING_POSITIVE` ↔ "Mixed / Leaning Positive". No behavioral conflict.

## F-2 — Study vs Publication counting (RESOLVED)
- **Docs 00–04** mostly speak of "research records"; the master prompt §60–61
  requires distinguishing an underlying study from its publications to avoid
  double-counting.
- **Resolution:** `05-DATABASE-ARCHITECTURE.md` §4 models `ResearchStudy` and
  `Publication` separately, with an MVP 1:1 simplification that preserves the
  distinction for later dedup/linking. `11` §7 aligns dedup with this.

## F-3 — Outcome vs quality vs criticism separation (CONSISTENT)
- All of `00` §4, master prompt §3–4/§8, and new `07`/`08`/`09` agree these are
  separate dimensions. `08` §5 and `09` §4 explicitly forbid collapsing criticism
  into outcome or quality. No conflict; reinforced.

## F-4 — Roles set (RESOLVED / no conflict)
- **04 §40** lists `PUBLIC/REVIEWER/ADMIN` plus future roles; master prompt §53
  says reviewers must not get DB-admin rights.
- **Resolution:** `16` §3 and `12` §14 adopt `PUBLIC/REVIEWER/ADMIN` for MVP with
  future roles as extensions; reviewer ≠ DB admin is stated. Consistent.

## F-5 — "Hermes" references (RESOLVED / scoped out of MVP)
- **00 §18** ("Hermes ≠ Core Database"), **00 §19** ("Hermes automation" as a
  late step), and **04 §35–36** describe Hermes as a *future* external automation
  layer.
- **Resolution:** Treated as post-MVP (`22` Phase 7+). `11` §11 encodes the
  failure-isolation guarantee (Hermes failure must not break core). `CLAUDE.md`
  omits Hermes as a named component for the current phase — intentional, not a
  contradiction. Flagged so the term is understood consistently.

## F-6 — Analytics/Community module vs "no reputation" (RESOLVED)
- **04 §5** lists a Community and Analytics module; master prompt §21/§27/§58 and
  `13` forbid researcher reputation/popularity scoring.
- **Resolution:** `13` §2 scopes community to research-object feedback only, no
  reputation. Analytics is privacy-conscious event tracking (`57` in `02`, `17`
  §12). No conflict.

## F-7 — Search technology (CONSISTENT)
- `04` §37 and master prompt §28 both say PostgreSQL first, no Elasticsearch/
  vector DB in MVP. `14` and ADR-009 encode this. Consistent.

## F-8 — Development sequence numbering (RESOLVED / cosmetic)
- **00 §19** gives a 10-step sequence; the **master prompt** and `22` give
  Phases 0–10 with slightly different granularity/labels.
- **Resolution:** `22-ROADMAP.md` is the authoritative milestone sequence for
  implementation; `00` §19 is the higher-level intent. They agree in order
  (architecture → foundation → manual MVP → explorer → visualization → AI →
  automation → community → advanced). Naming difference only.

## F-9 — Confidence storage (RESOLVED / clarified)
- Docs treat confidence as a dimension but don't specify storage.
- **Resolution:** `05` §5 and `07` §9 place confidence as a field on
  `Classification` for the relevant dimensions, independent of outcome. Clarified,
  no conflict.

# 4. Gaps Filled in Milestone 0

The following were undefined before and are now specified: database model (`05`),
taxonomy (`06`), outcome rules (`07`), quality dimensions (`08`), criticism model
(`09`), AI architecture (`10`), import (`11`), admin (`12`), community (`13`),
search (`14`), UI/UX (`15`), security (`16`), governance (`17`, `18`), deployment
(`19`), testing (`20`), cost (`21`), roadmap (`22`), agent contract (`23`), and 11
ADRs.

# 5. Open Decisions (deferred, non-blocking)

- **Exact DDL, column types, RLS policy SQL, indexes** — deferred to Milestone 2
  migrations (`05` §14).
- **Overall quality summary derivation rule** — a documented rule is required *if*
  a summary is displayed (`08` §4); the exact formula is deferred and must be
  disclosed when chosen.
- **Balance/weighting visualization methodology** — only if built; methodology
  must be disclosed (`13` §5, `15` §6). Deferred to Phase 5.
- **Hosting provider specifics** (static host, staging setup) — deferred to
  Milestone 1 (`19`).

# 6. Conclusion

No blocking contradictions remain. The set is internally consistent for entering
Milestone 1 (Repository Foundation). Remaining items are explicit, deferred
implementation decisions, not conflicts.
