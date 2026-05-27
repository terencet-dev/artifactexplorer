# Security Policy

Thank you for helping keep Artifact Explorer and its users safe.

## Supported Versions

Artifact Explorer is in **public preview** (`v0.1.x-public-preview`). Only the latest tagged release receives security updates. Pre-1.0 there is no LTS branch.

| Version             | Supported          |
| ------------------- | ------------------ |
| `0.1.x-public-preview` | ✅                 |
| earlier prototypes  | ❌                 |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.**

Use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/terencet-dev/artifactexplorer/security/advisories/new) of this repository.
2. Click **"Report a vulnerability"**.
3. Provide:
   - A clear description of the issue and its impact.
   - Steps to reproduce (proof-of-concept code, sample requests, or screenshots).
   - The affected commit SHA or release tag.
   - Any suggested mitigations, if you have them.

You should receive an acknowledgement within **72 hours** (best-effort — this is a personal open-source project, not a vendor with an on-call rotation). I will work with you to confirm the issue, prepare a fix, and coordinate disclosure.

If you do not get a response within 7 days, you are welcome to email the maintainer listed in `package.json`.

## Disclosure Timeline

- **Day 0:** Report received, acknowledgement sent.
- **Day 1–14:** Triage, reproduction, and fix development.
- **Day 14–30:** Patched release published. Public advisory follows once users have had a reasonable window to upgrade.
- **Day 90 (hard cap):** If a fix is genuinely impossible, the issue will be disclosed publicly so users can take their own mitigation steps.

I aim to credit reporters in the advisory unless they prefer to remain anonymous.

## Out of Scope

The following are **not** considered vulnerabilities for the purposes of this policy:

- Issues that require physical access to a user's device.
- Self-XSS or social engineering of the user.
- Reports based solely on outdated dependency scanners without a demonstrated impact path.
- Findings against forks, third-party deployments, or unsupported configurations.
- Missing security headers on pages that do not handle sensitive data.

## Operator Security Notes

If you are deploying Artifact Explorer for your own use:

- Always set `CRON_SECRET`, `DATABASE_URL`, and registry credentials via your hosting platform's secret store — never commit them.
- Keep `CRAWL_ENABLED=false` until you have configured registry credentials and verified rate-limit behavior in a staging environment.
- Prefer VNet/private-endpoint database access over publicly exposing your PostgreSQL instance (see `docs/azure/README.md`).
- Treat `NEXT_PUBLIC_*` env vars as **public** — they are baked into the client bundle.

Thank you for helping keep the project and its users secure.
