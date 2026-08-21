# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in WiseEvidence, please report it
**privately** so it can be addressed before public disclosure.

- Use GitHub's **private vulnerability reporting** ("Report a vulnerability" under
  the repository's **Security** tab), or
- contact the maintainers privately if a security contact is listed in the
  repository profile.

Please do **not** open a public issue or pull request for an unpatched
vulnerability.

When reporting, include where possible: a description, steps to reproduce, the
affected component/route, and any relevant logs — **without** including secrets,
credentials, or another person's data.

## What to expect

- Acknowledgement of your report.
- An assessment and, where confirmed, a fix developed privately.
- Coordinated disclosure once a fix is available, with credit if you wish.

## Scope and principles

WiseEvidence's security posture is documented in
[`docs/16-SECURITY.md`](docs/16-SECURITY.md). Key principles:

- Security never depends on client-side hiding; authorization is enforced
  server-side and via Row-Level Security.
- Service-role keys and other privileged secrets are never exposed to the
  frontend.
- Research abstracts, article text, scraped pages, and community text are
  **untrusted input** and must never override system instructions (prompt-
  injection defense).

## Secrets

Never commit secrets. Only `.env.example` (with placeholder values) is tracked;
real `.env` files are git-ignored. If you believe a secret was committed, treat it
as compromised, rotate it, and report it privately.
