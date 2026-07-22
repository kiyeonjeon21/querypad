# Agent guide

## Product direction

QueryPad is **Cursor for Data** - a local-first, terminal-first AI CLI that
understands datasets (discovers relationships, builds semantic models) before
generating SQL.
The web app was retired (tag `web-final`); the surfaces are the CLI today and an MCP server next.
See `ROADMAP.md` for the layered plan.

## Layout: core / engine / adapters

- `src/core/` - pure logic with **zero npm dependencies** (discovery, agent loop, sql utils, formatters, types).
  Keep it that way: no Node built-ins beyond types, no fetch, no fs.
- `src/engine/` - `QueryRunner` implementations. `engine/duckdb` binds native `@duckdb/node-api` for files; `engine/attach` attaches external Postgres/MySQL/SQLite read-only and exposes their tables as pushdown views.
  Anything that reaches an external database must stay `READ_ONLY` and must never let a credential into a log line or an artifact (`redactConnectionString`).
- `src/ai/` - provider-agnostic LLM completion (Anthropic / OpenAI, BYOK). Credentials come from env via `adapters/cli/ai-env.ts`.
- `src/embed/` - embedding interface; `@huggingface/transformers` is an **optionalDependency**, loaded only via dynamic import.
- `src/adapters/` - thin, replaceable surfaces: `adapters/cli` and `adapters/mcp` (stdio MCP server).
  Surfaces depend on core/engine, never the reverse.
  `adapters/cli/source.ts` resolves a folder or a `--db` connection into one `Source`, so commands never branch on where the tables came from.
  `core/agent/toolkit.ts` is the **single** definition of the read-only agent tools; the `ask` loop and the MCP server both consume it. Add a tool there, not in a surface.
  The MCP SDK is a devDependency on purpose - tsup bundles it (`noExternal`) so the shipped CLI carries none of its HTTP-transport deps. Keep `dependencies` at one entry.

The tsconfig has `lib: ["ES2022"]` with **no DOM** on purpose - browser APIs in
core/engine are a type error, not a code-review catch.

## Artifacts contract

- `inspect` writes `.datactx/` (schema.json, relationships.json,
  semantic-model.yaml/.json, inspect-summary.md; optionally term-embeddings.json).
- `.datactx/verdicts.json` is the user's curation (reject/override inferred joins);
  `inspect`, `ask`, and `explain` must honor it and re-runs must preserve it.

## Release and verification

- Keep `package.json`, `package-lock.json`, and the latest `CHANGELOG.md` release version in sync.
- Run `npm run check` after code/config changes (version metadata + lint + typecheck + build).
- Run `npm run test:cli` when discovery/CLI logic changes (unit + spawn-based e2e).
- Do not commit demo video artifacts or `.datactx/` inspection output.
- `npm publish` is deferred until the product rename is settled; `private: true` stays.
