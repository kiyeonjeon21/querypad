# QueryPad Roadmap — Cursor for Data

QueryPad is **Cursor for Data**: a local-first AI tool that understands folders
of CSV/Parquet files, discovers relationships, builds semantic models, and
answers business questions using DuckDB.

The execution layer is solved — DuckDB does it well. The unsolved problem is
**dataset understanding**: which tables exist, what each field means, how datasets
connect, which join is correct. That is the bottleneck this roadmap attacks, and
the reason the understanding engine is built **CLI-first**.

**Surface decision (2026-07): terminal-first.** The browser app was retired
(tag `web-final`, ~6k LOC removed); repeating it in a TUI would compete with
polished terminal SQL IDEs (Harlequin) on ground that is not our moat. The
surfaces are the CLI and an MCP server today, and possibly a dedicated
terminal host later (cmux demonstrates the shape: a native host embedding
libghostty that runs agents — our CLI would be a first-class citizen inside
it, not a reimplementation).

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
| 3 — Semantic Model | Entity rollup → `.datactx/semantic-model.yaml` (`buildSemanticModel`) | ✅ Built |
| 4 — AI Analyst | `querypad ask`: NL → agentic tool-using loop (explore → SQL → self-correct → insight) | ✅ Built |
| `querypad explain` | Justify each relationship from stored `RelationshipSignals` + caveats | ✅ Built |
| AI Verification | `.datactx/verdicts.json`: reject/override inferred joins; honored by inspect/ask/explain | ✅ Built (CLI) |
| External databases | `--db` attaches Postgres/MySQL/SQLite read-only; tables become pushdown views | ✅ Built |
| MCP server | `querypad mcp` exposes the read-only toolkit over stdio to Claude Code / Cursor | ✅ Built |

## Built today

Six commands ship: `inspect` (Layers 1–2), `ask` (Layer 4), `explain`, `enrich`,
`export-okf`, and `help`.

```bash
querypad inspect ./data
```

```text
Tables:        3
Relationships: 2
  payments.user_id ↳ users.id  (100%, many-to-one)
  events.user_id   ↳ users.id  (100%, many-to-one)
Wrote artifacts to ./data/.datactx
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

Architecture (core / engine / adapters):

```text
src/core/       pure logic, zero npm deps: discovery (signals · relationships ·
                semantic-model · explain · verdicts · compile-metric · glossary ·
                okf-export · term-catalog · term-search · sql-safety) · agent loop ·
                sql utils · formatters · types
src/engine/     QueryRunner implementations: duckdb (files, native @duckdb/node-api) ·
                attach (external Postgres/MySQL/SQLite, read-only pushdown views)
src/ai/         complete.ts (shared streaming) · generate-sql.ts · providers.ts
src/embed/      embedding interface + optional Transformers.js backend
src/adapters/   cli (index · inspect · ask · explain · enrich · export-okf ·
                artifacts · render) · mcp (stdio server over the shared toolkit)
```

Relationship discovery: profile each table → find primary-key candidates (unique,
non-null) → prune FK pairs by name similarity + type compatibility → run a
value-overlap query per survivor → blend four signals (value overlap, name
similarity, type match, cardinality shape) into a 0–100% confidence → keep each
foreign column's single strongest target (competition disambiguation) so
overlapping id ranges don't yield false positives.

Artifacts written to `.datactx/`:

```text
schema.json          tables, columns, types, per-column profiles
relationships.json   inferred joins with confidence + per-signal breakdown
semantic-model.yaml  named business entities (belongs_to / has_many / has_one)
verdicts.json        user curation: reject/override inferred joins (optional)
inspect-summary.md   human- and agent-readable overview
```

## Layer 3 — Semantic Model (built)

Rolls inferred relationships into named business entities, stored as the source of truth.

```yaml
# .datactx/semantic-model.yaml
entities:
  - name: User
    table: users
    synonyms: [users, user]
    dimensions:
      - {name: plan, column: plan, kind: categorical, values: [paid, free]}
    measures:
      - {name: users_count, agg: count}
    has_many:
      - Payment
      - Event
  - name: Payment
    table: payments
    synonyms: [payments, payment]
    measures:
      - {name: payments_count, agg: count}
      - {name: sum_amount, agg: sum, column: amount}
    belongs_to:
      - User
```

- Entity names are derived mechanically (`buildSemanticModel`): singularize → PascalCase
  (`users` → `User`, `order_items` → `OrderItem`), with deterministic collision handling.
  This keeps `inspect` key-free and deterministic.
- Associations come from the relationship graph: FK side `belongs_to`, PK side `has_many`
  (or `has_one` for one-to-one).
- **Dimensions / measures / synonyms** are derived mechanically from the column profiles
  (no AI): date → time dimension, low-cardinality text/boolean → categorical (with values),
  numeric non-key → `sum`, plus a row `count`; keys (relationship endpoints, id-named
  columns) are excluded. This is the deterministic floor the agent is grounded in.
- `ask` feeds the entities — with their dimensions and measures — into its context so
  generated SQL is reasoned in domain terms.
- Future: AI-enriched descriptions/synonyms/business metrics, then user-curated renames
  (e.g. `users` → `Customer`) over the mechanical defaults; surface ambiguous-join conflicts.

## Layer 4 — AI Analyst (built, agentic)

```bash
querypad ask "show 7-day retention for paid users" ./data
```

```text
Question → grounded in relationships → agent loop { list/describe/sample → run_sql → observe → self-correct } → insight
```

- An **agentic observe-act loop** (`src/core/agent/loop.ts`, `runAgentQuery`): the model calls
  read-only tools (`list_tables`, `describe_table`, `sample_table`, `run_sql`, `resolve_terms`
  — hybrid term→schema resolution, `src/core/discovery/term-search.ts` — and `query_metric` —
  a deterministic metric compiler, `src/core/discovery/compile-metric.ts`),
  reads their output — including DB errors — and rewrites failing SQL until it converges
  (bounded by `--steps`, default 8). Engine-agnostic via the shared `QueryRunner`, so other
  engines can bind later.
- Grounded in the inferred relationships and the semantic model's entities (`buildAskContext`),
  the market-standard anti-hallucination surface — the agent joins on the right keys and
  reasons in domain terms.
- Every tool is read-only-gated (`isReadOnlyQuery`); the in-memory DB is reloaded from files
  each run, so sources are never touched. Anthropic-first (`completeWithTools`); OpenAI falls
  back to a single-shot pipeline. `--verbose` shows each tool step; `--show-sql` previews a
  single query without executing.

## Next — deepening the agent

Direction set from late-2025/2026 market research (competitive landscape, agentic
architecture, naming). The moat is **semantic-first + local-first**: an agent grounded in a
governed semantic model is reliable where naked text-to-SQL is not, and almost every funded
competitor is cloud/warehouse-native. Build one step at a time:

1. **Agentic `ask` loop** — self-correcting, tool-using. ✅ Built.
2. **Semantic layer** — ✅ Built (all five sub-steps). (Research-settled architecture: structured YAML core → DuckDB hybrid
   term index → agent + metric compiler → OKF export). Sub-steps, one at a time:
   1. **Model schema + mechanical enrichment** — dimensions / measures / synonyms per entity,
      deterministically from the profiles (no AI). ✅ Built.
   2. Metric compiler + `query_metric` agent tool (pragmatic guarded joins) — the agent queries
      defined metrics, not raw tables. ✅ Built.
   3. Hybrid term-resolution index — NL terms → entity/column/metric via a `resolve_terms`
      tool: lexical token overlap always on, fused (RRF) with vector cosine over a local
      Transformers.js embedding cache (`inspect --embed`), BYOK API as an upgrade. ✅ Built.
   4. Any-doc-in glossary ingestion (`querypad enrich`): loaders (.md/.txt/.csv/.json;
      spreadsheets dropped — xlsx@0.18.5 carries unfixable CVEs, users export CSV) →
      schema-grounded LLM extraction (terms → real columns) → reviewable proposals, `--apply`
      folds descriptions/synonyms into the model. ✅ Built.
   5. OKF (Google Open Knowledge Format, MD+frontmatter) export for agent-ecosystem interop
      (`querypad export-okf` → `.datactx/okf/`). ✅ Built.
3. **External databases via DuckDB ATTACH** — ✅ Built. `--db postgres://… | mysql://… |
   sqlite:…` attaches read-only (DuckDB enforces it) and exposes each source table as a
   **view**, so nothing is copied and profiling / value-overlap / joins push down to the
   source engine. A `Source` abstraction (`src/adapters/cli/source.ts`) makes a folder and
   a database interchangeable to `inspect`, `ask`, and `enrich`; `--schema` scopes the
   discovery and `--out` places `.datactx/`. Credentials are redacted from every log line
   and artifact.
4. Verification step before answering + eval harness (question → expected-result pairs).
5. **MCP server** — ✅ Built. `querypad mcp` serves the read-only toolkit over stdio. The
   tools are not a reimplementation: `createDataToolkit` (`src/core/agent/toolkit.ts`) is
   the single definition that both the internal `ask` loop and the MCP server consume, so
   an external agent sees exactly the tools our own agent uses — plus `describe_dataset`,
   which hands over the grounding context `ask` would otherwise put in its system prompt.
   With the web app retired this is the interactive surface: the coding agent is the UI.
6. Short planning/decomposition for multi-part questions (bounded).
7. **Terminal host experiment** — integrate with cmux (scriptable CLI + socket API +
   sidebar) before considering a dedicated libghostty host; only build one if the
   experiment surfaces needs cmux cannot meet.
8. **Rename** (package / bin / domain / README) — *gated on formal trademark + domain
   clearance* (the name "datapad" was rejected: it collides with an active, funded
   competitor in the same category; "grain" has an npm squatter + a language collision).
   The artifact dir is already brand-independent (`.datactx/`), and npm publish waits
   for the name.

## `querypad explain` (built)

`querypad explain <folder>` reads `.datactx/relationships.json` and renders the stored
per-signal breakdown (`buildExplanation`) as a justification for each inferred relationship:
value overlap, name match, type match, and cardinality. It also surfaces caveats —
low-confidence edges, high-overlap/weak-name matches that may be coincidental, and tables
with no inferred relationships. Pure consumer of artifacts (no DuckDB / AI); run `inspect` first.

## AI Verification — verdicts (built)

The AI proposes; the user decides. `.datactx/verdicts.json` holds the curation —
verdicts keyed by `relationshipKey` (reject a wrong join) plus overrides (edit or
add one by hand):

```json
{
  "verdicts": { "events.user_id->users.id": "rejected" },
  "overrides": []
}
```

`applyVerdicts` (`src/core/discovery/verdicts.ts`, pure + idempotent) curates the
graph everywhere it is consumed: `inspect` (before the semantic model is built),
`ask` (before grounding the agent), and `explain`. Re-running `inspect` preserves
the file, so curation survives re-inference. The file is hand- and agent-editable;
an interactive `verify` command (walk each edge, y/n/e) can build on it later.
This replaces the retired web app's Relationships panel (IndexedDB verdicts).

## Claude Code integration

`querypad inspect` makes the dataset legible to coding agents. Instead of guessing
with pandas, Claude Code reads `.datactx/schema.json` + `relationships.json` and
reasons about the data directly:

```text
Claude Code  +  QueryPad  +  DuckDB
```

Layers 3–4 have landed, so the MCP server (step 5) is the natural next surface:
the same engine exposed as typed read-only tools, making the coding agent the
interactive UI instead of a bespoke one.

## Principles

- **Use DuckDB.** Do not build a database or a query engine.
- **Understanding before UI.** Relationship inference and semantic modeling are the
  bottleneck; a dashboard built before solving them is just another BI tool. The
  corollary, learned the expensive way: a surface that does not advance the
  understanding engine is a liability, not an asset.
- **Thin, replaceable surfaces.** The engine (`src/core`) has zero npm dependencies
  and never touches a connection or an HTTP client. Surfaces live in `src/adapters`
  and are cheap to add or delete.
- **Local-first.** Computation and storage stay on the user's machine; AI is BYOK.
- **Agent-native.** Artifacts are structured, typed, and token-efficient so agents
  can consume them directly.
