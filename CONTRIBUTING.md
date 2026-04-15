# Contributing

Thanks for considering a contribution. This plugin is small and opinionated — the guidelines below keep it that way.

## Local setup

```bash
bun install
```

A sandbox Payload app lives in `dev/` and is what you should point at when smoke-testing. It wires the plugin against SQLite.

```bash
cd dev && bun dev
```

## Scripts

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `bun run build`    | Compile TypeScript to `dist/`.                            |
| `bun run dev`      | `tsc --watch` for incremental rebuilds.                   |
| `bun run lint`     | Biome check (no writes).                                  |
| `bun run lint:fix` | Biome check with safe autofixes applied.                  |
| `bun run format`   | Biome formatter only.                                     |
| `bun test`         | Run the Bun test suite.                                   |

## Code style

Enforced by Biome (`biome.json`). Short version:

- 2-space indent, single quotes, semicolons required, trailing commas everywhere.
- `noExplicitAny` is an error — use `unknown` and narrow.
- `useBlockStatements` is an error — always wrap `if` / `else` bodies in braces.
- Imports are auto-organised.

Before pushing:

```bash
bun run lint:fix
bunx tsc --noEmit
bun test
```

## Pull requests

- One logical change per PR.
- Reference the issue it closes in the description.
- If you touch the HTTP surface, update [`docs/api-reference.md`](./docs/api-reference.md).
- If you touch extraction behaviour for `richText` / `json`, update [`docs/rich-text.md`](./docs/rich-text.md).
- New field-level annotations go in [`docs/field-annotations.md`](./docs/field-annotations.md) *and* in the JSDoc on `ReversiaFieldCustom` (`src/types.ts`).

## Reporting bugs

Please include:

1. A minimal Payload config reproducing the issue (the `dev/` sandbox is a good starting point).
2. The collection / field definition that triggers it.
3. Request and response bodies for any Reversia call involved (redact secrets).
4. Expected vs actual behaviour.

## Security

Do not open a public issue for security reports. Email `contact@reversia.tech` instead.
