# WiseEvidence
## Open-Source Governance

**Document:** `docs/18-OPEN-SOURCE-GOVERNANCE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `17-DATA-GOVERNANCE.md`, `16-SECURITY.md`, `docs/adr/`

---

# 1. Purpose

Define how the open-source project is governed: contribution workflow, review,
licensing, security reporting, conduct, and the research-correction process.

The repository is **GitHub-first** (`04` §42, master prompt §32, §8).

# 2. Licensing Strategy (decided)

- **Code: Apache-2.0** — permissive with an explicit patent grant; institution-
  and contributor-friendly, allows broad reuse.
- **Curated data & metadata: CC-BY-4.0** — attribution required.

Recorded in **ADR-011**. The `LICENSE` file (Apache-2.0) and a data-license
notice land at Milestone 1. Third-party source metadata remains bound by its own
source terms (`17` §11).

# 3. Contribution Workflow

```text
Issue → Discussion → Branch → Pull Request → Review → Merge
```

- Contributions come via pull requests against feature branches.
- Significant architectural changes require an ADR (`docs/adr/`) and, where they
  change public interpretation, maintainer approval (master prompt §89).
- Code and architecture docs must not silently diverge (`00` §doc-discipline,
  master prompt §25, §73).

# 4. Repository Hygiene Files (Milestone 1)

`README.md` (exists) · `CONTRIBUTING.md` · `SECURITY.md` · `CODE_OF_CONDUCT.md` ·
`LICENSE` · `.env.example` · issue templates · PR template. Their *strategy* is
documented now; the files are created in Milestone 1 (`22`).

# 5. Code Review

- At least one maintainer review before merge.
- Reviews check: architecture conformance, the non-negotiable domain rules
  (dimension separation, AI-not-authority, human review), tests, security, cost
  impact, and accessibility (`91`, master prompt §91).
- Do not merge PRs without authorization (master prompt §75).

# 6. Architecture Decisions

Recorded as ADRs (`docs/adr/`), one per significant decision (Context / Decision
/ Consequences / Status). Trivial implementation choices do not get ADRs (master
prompt §38).

# 7. Data Contribution Rules

- Contributed research must preserve DOI, source, identifiers, and metadata
  (`17` §10, master prompt §47).
- No fabricated abstracts/outcomes; AI-generated summaries labeled until reviewed.
- Contributions enter the same import → review → publish pipeline (`11`, `12`).

# 8. Security Reporting

Responsible disclosure: security issues are reported privately (channel defined
in `SECURITY.md`) and addressed before public disclosure (`16` §13). Do not file
public issues for unpatched vulnerabilities.

# 9. Code of Conduct

A standard contributor covenant governs community interaction. Feedback focuses
on research objects and code, not on individuals' reputation (`13` §2).

# 10. Research Correction Process

Errors in published research are corrected via the correction workflow (`13` §4,
`12` §12) with preserved history (`17` §7). Corrections are transparent and
audited.
