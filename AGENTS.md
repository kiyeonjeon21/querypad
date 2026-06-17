<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Product direction

QueryPad is pivoting from "AI-powered SQL editor" to **Cursor for Data** — a
local-first AI workspace that understands datasets (discovers relationships, builds
semantic models) before generating SQL. See `ROADMAP.md` for the layered plan.

## Two surfaces, one core

- **Web app** (`src/app`, `src/components`) runs DuckDB-Wasm in the browser.
- **CLI** (`src/cli`, `src/lib/duckdb-node`) runs native `@duckdb/node-api` in Node.
- **Shared, engine-agnostic core** (`src/lib/discovery`, `src/lib/duckdb/sql-utils.ts`)
  is consumed by both via a `QueryRunner` abstraction.
- Node-only code (`src/lib/duckdb-node`, `src/cli`) must never be imported by app code,
  or the native addon leaks into the browser bundle. `npm run check`'s build step
  verifies this.

## Release and verification

- Keep `package.json`, `package-lock.json`, and the latest `CHANGELOG.md` release version in sync.
- Run `npm run check` after code/config changes.
- Run `npm test` when UI behavior or e2e-covered flows change.
- Run `npm run test:cli` when discovery/CLI logic changes.
- Do not commit demo video artifacts or `.querypad/` inspection output; use the videos
  as release/README upload assets.
