# Changelog

QueryPad is a web app, not an npm package. Version numbers mark GitHub release
milestones and public product updates.

## Unreleased

### Web: Relationship Verification

- New Relationships panel in the sidebar: runs the same discovery engine in the browser
  (DuckDB-Wasm) and lists inferred joins with confidence and a per-signal "why"
- Accept / Reject / Edit each relationship to curate the AI's assumptions; verdicts and
  edits persist across refresh (IndexedDB)
- Reuses the engine-agnostic `src/lib/discovery` core (no logic duplicated between CLI and web)

### CLI: Dataset Understanding

- New `querypad inspect <folder>` command that profiles a folder of data files and
  infers foreign-key relationships with confidence scores
- New `querypad ask "<question>" <folder>` command (AI Analyst): generates SQL using the
  inferred relationships as context, runs it on DuckDB, and explains the result
- `ask` now suggests 2-3 follow-up questions after each answer (dataset-aware next steps)
- `inspect` now builds a semantic model (named business entities with belongs_to/has_many)
  and writes `.querypad/semantic-model.yaml`; `ask` feeds those entities as context too
- New `querypad explain <folder>` command: justifies each inferred relationship from its
  signals (value overlap, name match, type, cardinality) and lists caveats to verify
- Generated SQL is read-only-gated (only SELECT/WITH/EXPLAIN/… execute) and code-fence stripped
- CLI AI keys come from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; provider via `--provider`
- Writes `.querypad/` artifacts (`schema.json`, `relationships.json`, `inspect-summary.md`)
  for AI agents such as Claude Code to reason about the dataset
- Engine-agnostic discovery core shared between the browser app and the Node CLI
- Runs on a native Node DuckDB engine (`@duckdb/node-api`), separate from the browser Wasm engine

### Multi-Provider BYOK

- OpenAI BYOK support for the Cmd+K AI SQL assistant via the Responses API
- Provider selector for Claude and OpenAI with independent browser-local keys
- Updated the default Claude model to `claude-sonnet-4-6`
- Added `gpt-5.5` as the default OpenAI model

### Data Profile & Agent Context

- On-demand data profile drawer for loaded tables
- Column-level nulls, distinct counts, numeric ranges, averages, and top values
- Copy Agent Context action for Codex, Claude Code, or other coding agents
- README positioning updated around local-first OSS and the hosted demo

## v0.6 — Open-Source Release

- Vercel Analytics integration
- OG image and Twitter card metadata for social sharing
- Playwright e2e test suite
- CONTRIBUTING.md and project metadata
- CI, version metadata checks, and agent guidance for release hygiene

## v0.5 — Query Engine Fixes

- DATE and TIMESTAMP columns now display as human-readable ISO strings instead of raw epoch milliseconds
- DECIMAL values now display correctly with proper scale (e.g. `0.3` instead of `3`)
- Multi-statement SQL support — semicolon-separated queries execute sequentially, last result displayed
- Share URL v2 binary format — eliminates double base64 encoding, supports larger datasets reliably
- Backward-compatible decoding for existing v1 share links
- Clean floating-point display — removes IEEE 754 noise (e.g. `869.8600000000001` → `869.86`)

## v0.4 — Onboarding & File Management

- Sample data pre-loaded on first visit with welcome banner
- Global drag-and-drop — drop files anywhere on the workspace
- Add file modal with drag area, browse, and URL input
- Per-table delete (hover X button in sidebar)
- Auto-cleanup of sample data when user adds own files
- File size validation (100 MB hard limit, 50 MB soft warning)

## v0.3 — Collaboration & Extensibility

- Transform pipelines with DAG visualization
- Plugin system (4 extension types via ES module URL)
- Real-time collaboration (PartyKit + Y.js CRDT)

## v0.2 — Power Features

- Multi-format export (CSV, JSON, Markdown, HTML, Excel, Parquet)
- Multi-tab editor with IndexedDB persistence
- S3/HTTP remote file loading
- AI SQL assistant (BYOK streaming)

## v0.1 — Core

- IndexedDB persistence
- Excel (.xlsx) support
- HTML export
- Inline charts with auto-detection
