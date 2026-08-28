# Security Policy

WiseEvidence takes the security and integrity of the platform seriously —
protecting both the codebase and the credibility of the research data it will
hold.

## Reporting a vulnerability

**Please report security issues privately. Do not open a public issue for an
unpatched vulnerability** (`docs/16-SECURITY.md` §13, `docs/18` §8).

Use GitHub's private vulnerability reporting for this repository:

- Go to the repository's **Security** tab → **Report a vulnerability**
  (GitHub Private Vulnerability Reporting).

Please include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected components or files, and
- any suggested remediation.

We aim to acknowledge reports promptly, investigate, and address confirmed
issues before public disclosure. Please give us reasonable time to remediate
before disclosing publicly. We will credit reporters who wish to be credited.

## Scope

At Milestone 1 the repository is a static-first scaffold with no database,
authentication, or AI pipeline. Even so, the following are always in scope:

- accidental exposure of secrets or credentials in the repository or history,
- supply-chain / dependency risks,
- the public-vs-secret credential boundary (see below), and
- build/CI configuration weaknesses.

## Credential handling (must not be violated)

- No secrets, API keys, or service-role keys are ever committed. `.env` is
  gitignored; only `.env.example` (placeholders) is tracked.
- Only `PUBLIC_*` variables reach the browser (Astro convention). The Supabase
  **service-role key bypasses RLS and must remain server-side only** — never
  prefixed with `PUBLIC_`, never referenced from client/island code
  (`docs/16-SECURITY.md` §5).
- Security must not depend on hiding things in the client. Authorization is
  enforced server-side and, in later milestones, by PostgreSQL Row-Level
  Security.

## Supported versions

The project is pre-1.0. Security fixes are applied to the default branch.
