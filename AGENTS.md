# Agent Instructions

This repository uses wavestack-style guardrails adapted for the Fallback Electron app. Keep changes small, verify them, and leave the repo easier to inspect than you found it.

## Required Before Handoff

Run the narrowest relevant checks while iterating, then finish with:

```sh
pnpm beta:check
```

If the full gate is too slow for the current edit, run and report the closest completed subset, such as `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format`, and `pnpm size:check`.

## Dependency Rules

- Prefer the platform, TypeScript, and existing dependencies before adding packages.
- New packages must install through pnpm with the checked-in `.npmrc` and `pnpm-workspace.yaml` policy.
- Do not bypass release-age, exact-version, lifecycle-script, or exotic-dependency restrictions without documenting the reason.
- Commit `pnpm-lock.yaml` after dependency changes.

## TypeScript Rules

- Treat `any`, unchecked indexing, and broad object shapes as design smells.
- Prefer discriminated unions for state machines and command results.
- Make union handling exhaustive and keep runtime validation close to external input boundaries.
- Avoid `@ts-ignore`, `@ts-nocheck`, `as any`, and non-null assertions. If a suppression is unavoidable, explain why and keep it local.
- Use `unknown` at boundaries, validate it, then narrow it.
- Keep files concise. The current limit is configured in `.repo-limits.json`; split files by purpose before raising limits.

## Pull Request Notes

Include:

- What changed.
- How it was verified.
- Any dependency or security tradeoffs.
