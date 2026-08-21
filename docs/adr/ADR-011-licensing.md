# ADR-011: Licensing — Apache-2.0 (code) + CC-BY-4.0 (data)

**Status:** Accepted
**Date:** 2026-08-21
**Related:** `docs/18-OPEN-SOURCE-GOVERNANCE.md` §2, `17-DATA-GOVERNANCE.md` §11

## Context

Code and curated research data raise different licensing concerns. Code benefits
from broad, institution-friendly reuse with patent protection; curated
data/metadata benefits from open reuse with required attribution to preserve
provenance. A single software license does not fit dataset distribution.

## Decision

- **Code: Apache-2.0** — permissive, with an explicit patent grant.
- **Curated research data & metadata: CC-BY-4.0** — attribution required.

Third-party source metadata is used only within that source's own terms and
licenses. The `LICENSE` file (Apache-2.0) and a data-license notice are added at
Milestone 1.

## Consequences

- Maximizes contribution and adoption of the codebase while protecting
  contributors via the patent grant.
- Keeps the curated dataset open and attributable, reinforcing provenance
  (`17` §3).
- Contributors must respect upstream source terms; not all source metadata can be
  redistributed under CC-BY-4.0, so per-source licensing is tracked on records
  (`17` §11).
- Chosen over AGPL-3.0/MIT alternatives for the code: Apache-2.0 balances broad
  reuse with patent safety without copyleft friction.
