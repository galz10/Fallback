# Security Policy

Fallback is local-first software that stores GitHub repository context on the user's machine. Please report suspected vulnerabilities privately.

## Reporting

Do not open a public issue for sensitive findings. Send the report to the project maintainers with:

- A concise description of the issue.
- Steps to reproduce.
- The likely impact.
- Any relevant logs, screenshots, or proof-of-concept details with secrets redacted.

## Scope

Security-sensitive areas include GitHub token handling, OAuth callback handling, local cache storage, update and release packaging, shell/editor handoff, and diagnostics export redaction.

## Dependency Policy

Dependencies are exact-pinned, installs use pnpm with a release-age cooldown, and lifecycle scripts are allowlisted in `pnpm-workspace.yaml`.
