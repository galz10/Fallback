# Contributing

Fallback uses Node 24.x and pnpm 10.33.x.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Before handing off a change, run:

```sh
pnpm beta:check
```

For focused iteration, run the relevant subset first:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm format
pnpm size:check
```

Keep dependency changes exact-pinned and commit `pnpm-lock.yaml` whenever dependencies change.
