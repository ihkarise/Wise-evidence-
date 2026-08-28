<!--
Thank you for contributing to WiseEvidence. Please fill in the sections below.
See CONTRIBUTING.md for the full workflow and the non-negotiable domain rules.
-->

## Summary

<!-- What does this PR change, and why? -->

## Related issue

<!-- e.g. Closes #123 -->

## Type of change

- [ ] Documentation / architecture
- [ ] Tooling / CI
- [ ] Domain logic (`packages/*`)
- [ ] Web app (`apps/web`)
- [ ] Other:

## Milestone alignment

- [ ] This change fits the current milestone in `docs/22-ROADMAP.md` (no
      premature later-milestone features).
- [ ] If it changes an architectural decision, an ADR is added/updated in
      `docs/adr/`.

## Domain-rule checklist

- [ ] Keeps outcome, evidence quality, confidence, criticism, and provenance
      **separate** (no collapsing into one score).
- [ ] Treats outcome as a spectrum, not a positive/negative binary.
- [ ] Keeps AI as an assistant, not the final authority (suggestions stored
      separately, provenance preserved).
- [ ] No secrets/keys committed; only `PUBLIC_*` values reach the client.
- [ ] `packages/domain` imports no Astro/React/Supabase/AI SDK.

## Checks

- [ ] `pnpm -w lint` passes
- [ ] `pnpm -w typecheck` passes
- [ ] `pnpm -w test` passes
- [ ] `pnpm --filter @wise-evidence/web build` passes
- [ ] New/changed logic has deterministic tests (no network, no paid AI)
