# WiseEvidence
## Community Architecture

**Document:** `docs/13-COMMUNITY-ARCHITECTURE.md`
**Version:** 0.1.0
**Status:** Draft
**Parent:** `00-ARCHITECTURE-BASELINE.md`
**Related:** `12-ADMIN-ARCHITECTURE.md`, `02-PRODUCT-REQUIREMENTS.md`

---

# 1. Purpose

Define community participation — feedback focused on **research objects**, not on
people. Community features are later-phase (Milestone 9) and must not compromise
the canonical data model.

# 2. Principles

- Community feedback targets **research objects** (summary accuracy, metadata
  accuracy, classification disagreement, usefulness), **not personal
  reputation** (`00`, master prompt §21).
- **No researcher upvote/downvote or popularity scoring** (`00`, `03` §11,
  master prompt §27, §58).
- Users **never directly modify** canonical research (`02` §10, master prompt
  §27). All input flows through the correction/review workflow (`12` §12).
- Votes, if ever introduced, mean *classification disagreement / data
  usefulness / correction signal* — never "this paper is scientifically true"
  (master prompt §58).

# 3. Community Actions (future)

From `02` §10 and `03` §19:
- Report an error
- Suggest a correction
- Submit a DOI / URL for consideration
- Flag a classification disagreement
- Bookmark (per-user, private)
- Discussion — only if justified later, and moderated

# 4. Correction Flow

```text
Community submission → Correction (status: open)
   → Admin review (/admin/corrections)
   → Accept (merge with audit + reason) | Reject (with reason)
```

Original values are preserved; corrections append history (`05` §10, master
prompt §52).

# 5. Balance Visualization (if built)

Any positive/negative balance/weighting visualization must show *reported
outcomes in indexed research*, not *scientific proof of efficacy*, and must
disclose its methodology: which studies are included/excluded, how mixed studies
are treated, whether quality is weighted, whether duplicate publications are
collapsed, and whether study design affects weight (master prompt §20, §59).
Do not invent an authoritative weighting formula without validation.

# 6. Accounts & Privacy

Community accounts (Milestone 9) collect the minimum necessary data (`57`,
`16`, `17`). Bookmarks are private per-user. No unnecessary personal data is
collected.

# 7. Abuse Prevention

Submissions are rate-limited and validated (`16`). Moderation and audit apply to
community-originated content. Untrusted community text is treated as data, never
as instructions to the AI pipeline (`10` §12).
