# QueryPad Roadmap — Cursor for Data

QueryPad is pivoting from "AI-powered SQL editor" to **Cursor for Data**: a
local-first AI workspace that understands folders of CSV/Parquet files, discovers
relationships, builds semantic models, and answers business questions using DuckDB.

The execution layer is solved — DuckDB does it well. The unsolved problem is
**dataset understanding**: which tables exist, what each field means, how datasets
connect, which join is correct. That is the bottleneck this roadmap attacks, and
the reason we build the understanding engine **CLI-first** before investing in UI.

> Cursor understands code → generates code → edits code → runs code.
> QueryPad understands datasets → infers relationships → generates SQL → executes analysis → explains findings.
>
> The semantic model is the AST for data. The relationship graph is the codebase graph.

## The four layers

```text
Layer 1  Dataset Discovery   →  profile files: schema, stats, uniqueness, cardinality
Layer 2  Relationship Disc.  →  infer joins automatically, with confidence scores
Layer 3  Semantic Model      →  roll relationships into named business entities
Layer 4  AI Analyst          →  question → semantic model → SQL → execution → insight
```

| Layer | Deliverable | Status |
|-------|-------------|--------|
| 1 — Dataset Discovery | Folder scan + per-column profiles (`profileTable`, `loadFolder`) | ✅ Built |
| 2 — Relationship Discovery | Confidence-scored FK inference (`discoverRelationships`, `querypad inspect`) | ✅ Built |
| 3 — Semantic Model | Entity rollup → `.querypad/semantic-model.yaml` (`buildSemanticModel`) | ✅ Built |
| 4 — AI Analyst | `querypad ask`: NL → SQL (relationship-aware) → execution → insight | ✅ Built |
| `querypad explain` | Justify each relationship from stored `RelationshipSignals` + caveats | ✅ Built |
| UI — AI Verification | Sidebar Relationships panel: accept/reject/edit inferred joins | ✅ Built |
| MCP server | Expose `inspect`/`ask`/`explain` as typed agent tools | 🚧 Next |

## Built today

Two CLI commands ship: `querypad inspect` (Layers 1–2) and `querypad ask` (Layer 4).

```bash
querypad inspect ./data
```

```text
Tables:        3
Relationships: 2
  payments.user_id ↳ users.id  (100%, many-to-one)
  events.user_id   ↳ users.id  (100%, many-to-one)
Wrote artifacts to ./data/.querypad
```

```bash
ANTHROPIC_API_KEY=sk-ant-... querypad ask "payments by plan" ./data
```

```text
-- SQL
SELECT u.plan, COUNT(*) AS payment_count, SUM(p.amount) AS total
FROM payments p JOIN users u ON p.user_id = u.id GROUP BY u.plan
...
Insight: All payments come from paid-plan users.
```

Architecture (engine-agnostic core, two DuckDB bindings):

```text
src/lib/discovery/     signals.ts · relationships.ts · semantic-model.ts · explain.ts · sql-safety.ts
src/lib/ai/            complete.ts (shared streaming) · generate-sql.ts · providers.ts
src/lib/duckdb-node/   connection.ts · load.ts · profile.ts   (native @duckdb/node-api)
src/lib/duckdb/        sql-utils.ts (shared) · profile.ts      (browser DuckDB-Wasm)
src/cli/               index.ts (dispatch) · inspect.ts · ask.ts · explain.ts · artifacts.ts
```

Relationship discovery: profile each table → find primary-key candidates (unique,
non-null) → prune FK pairs by name similarity + type compatibility → run a
value-overlap query per survivor → blend four signals (value overlap, name
similarity, type match, cardinality shape) into a 0–100% confidence → keep each
foreign column's single strongest target (competition disambiguation) so
overlapping id ranges don't yield false positives.

Artifacts written to `.querypad/`:

```text
schema.json          tables, columns, types, per-column profiles
relationships.json   inferred joins with confidence + per-signal breakdown
semantic-model.yaml  named business entities (belongs_to / has_many / has_one)
inspect-summary.md   human- and agent-readable overview
```

## Layer 3 — Semantic Model (built)

Rolls inferred relationships into named business entities, stored as the source of truth.

```yaml
# .querypad/semantic-model.yaml
entities:
  - name: User
    table: users
    has_many:
      - Payment
      - Event
  - name: Payment
    table: payments
    belongs_to:
      - User
```

- Entity names are derived mechanically (`buildSemanticModel`): singularize → PascalCase
  (`users` → `User`, `order_items` → `OrderItem`), with deterministic collision handling.
  This keeps `inspect` key-free and deterministic.
- Associations come from the relationship graph: FK side `belongs_to`, PK side `has_many`
  (or `has_one` for one-to-one).
- `ask` feeds the entities into its context so generated SQL is reasoned in domain terms.
- Future: AI/user-curated renames (e.g. `users` → `Customer`) over the mechanical defaults.
- Surface conflicts (ambiguous joins, multiple FK candidates) for resolution.

## Layer 4 — AI Analyst (built)

```bash
querypad ask "show 7-day retention for paid users" ./data
```

```text
Question → inferred relationships as context → SQL generation → DuckDB execution → insight
```

- Reuses the AI layer (`src/lib/ai/complete.ts`, Claude + OpenAI). CLI keys come from
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; provider via `--provider`.
- Feeds the inferred relationships and the semantic model's entities (`buildAskContext`)
  so generated SQL joins on the right keys and is reasoned in domain terms.
- Generated SQL is read-only-gated (`isReadOnlyQuery`) and code-fence stripped before
  execution; the in-memory DB is reloaded from files each run, so sources are never touched.
- `--show-sql` previews the SQL without executing.

## `querypad explain` (built)

`querypad explain <folder>` reads `.querypad/relationships.json` and renders the stored
per-signal breakdown (`buildExplanation`) as a justification for each inferred relationship:
value overlap, name match, type match, and cardinality. It also surfaces caveats —
low-confidence edges, high-overlap/weak-name matches that may be coincidental, and tables
with no inferred relationships. Pure consumer of artifacts (no DuckDB / AI); run `inspect` first.

## UI — AI Verification (built)

The browser app has a **Relationships panel** in the sidebar — its purpose is
**AI verification**, not dashboard building. It runs the same discovery engine in the
browser (DuckDB-Wasm via `createBrowserQueryRunner`) and lets the user validate the
AI's assumptions:

```text
Detected relationship
  payments.user_id ↳ users.id     Confidence 100%
  [Accept]  [Reject]  [Edit]   (Why? → per-signal justification)
```

`RelationshipsPanel.tsx` reuses the shared `src/lib/discovery` core (`discoverRelationships`,
`buildExplanation`) — the same edges the CLI emits — so no logic is duplicated. Verdicts and
edits are keyed by `relationshipKey` and persisted to IndexedDB. The existing browser app
(Monaco, charts, pipelines, sharing) remains the interactive-analysis surface; the
verification view is additive.

## Claude Code integration

`querypad inspect` makes the dataset legible to coding agents. Instead of guessing
with pandas, Claude Code reads `.querypad/schema.json` + `relationships.json` and
reasons about the data directly:

```text
Claude Code  +  QueryPad  +  DuckDB
```

A future MCP server can expose the same engine (`inspect`, `ask`, `describe`) as
typed tools for agent workflows — a natural follow-on once Layers 3–4 land.

## Principles

- **Use DuckDB.** Do not build a database or a query engine.
- **Understanding before UI.** Relationship inference and semantic modeling are the
  bottleneck; a dashboard built before solving them is just another BI tool.
- **Local-first.** Computation and storage stay on the user's machine; AI is BYOK.
- **Agent-native.** Artifacts are structured, typed, and token-efficient so agents
  can consume them directly.
