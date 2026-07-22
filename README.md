# QueryPad

> **Cursor for Data - a local-first AI CLI that understands your datasets, not just runs SQL on them.**

QueryPad points an AI at a folder of CSV/Parquet/JSON files, profiles them,
discovers how they connect, builds a semantic model, and answers business
questions with DuckDB - locally, with no server-side data processing and no account.

The execution layer is solved (DuckDB does it well).
The unsolved problem is that **people don't understand their data**: which tables exist, what each field means, how datasets connect, which join is correct.
QueryPad answers those questions first, then generates and runs the SQL.

```text
             ┌──────────────────────────────┐
 folder of → │  Understanding engine        │ → .datactx/ artifacts
 data files  │  profile → relationships     │   (schema · relationships ·
             │  → semantic model → agent    │    semantic model · verdicts)
             └──────────────────────────────┘
               terminal-first: CLI today,
               MCP server next
```

## Install

```bash
git clone https://github.com/vericontext/querypad && cd querypad
npm install && npm run build && npm link
```

## `inspect`: understand a folder

```bash
querypad inspect ./data
```

Scans the folder, profiles every file, and infers foreign-key relationships with
confidence scores:

```text
Tables:        3
Relationships: 2
  payments.user_id ↳ users.id  (100%, many-to-one)
  events.user_id   ↳ users.id  (100%, many-to-one)

Wrote artifacts to ./data/.datactx
```

It writes machine-readable artifacts that an AI agent (Claude Code, Cursor, ...)
can read to reason about the dataset instead of guessing at pandas:

```text
.datactx/
  schema.json          # tables, columns, types, per-column profiles
  relationships.json   # inferred joins with confidence + signals
  semantic-model.yaml  # named business entities (belongs_to / has_many)
  verdicts.json        # your accept/reject/edit curation (optional)
  inspect-summary.md   # human- and agent-readable overview
```

`inspect` also rolls the relationships into a semantic model of named entities -
with mechanically-derived **dimensions**, **measures**, and **synonyms** (deterministic,
no AI) so the agent is grounded in what you group by and the metrics that exist:

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
    has_many: [Payment, Event]
  - name: Payment
    table: payments
    synonyms: [payments, payment]
    measures:
      - {name: payments_count, agg: count}
      - {name: sum_amount, agg: sum, column: amount}
    belongs_to: [User]
```

## `ask`: the AI analyst

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # or OPENAI_API_KEY with --provider openai
querypad ask "total payment amount by user plan" ./data
```

`ask` runs an **agentic loop**: grounded in the inferred relationships and the semantic
model, it explores the schema with read-only tools (`list_tables`, `describe_table`,
`sample_table`, `run_sql`), maps a user's wording to the schema with **`resolve_terms`**
(e.g. "customers" → User, "revenue" → sum_amount), and computes a defined metric with
**`query_metric`** - a deterministic compiler that turns a metric + dimensions + filters
into correct, join-guarded SQL (many-to-one joins only; a grouping that would fan out the
measure is refused).
It executes on DuckDB, **self-corrects** when a query errors, and explains the result:

```text
-- SQL
SELECT u.plan, COUNT(*) AS payment_count, SUM(p.amount) AS total
FROM payments p JOIN users u ON p.user_id = u.id
GROUP BY u.plan ORDER BY u.plan

plan  payment_count   total
----  -------------  ------
paid              8  285.74

Insight: All payments come from paid-plan users.

Follow-up questions:
  1. Which paid users have the highest individual payments?
  2. Are there users with no payments at all?
  3. How does payment frequency vary across plans?
```

Every tool is read-only-gated (only `SELECT`/`WITH`/... execute) and the DB is
in-memory, so source files are never modified.
The agent loop is Anthropic-first (OpenAI falls back to a single-shot pipeline).
Use `--verbose` to see each tool step, `--steps <n>` to cap the turns, or `--show-sql` to preview a single query without running it.
`resolve_terms` is lexical by default; run `querypad inspect --embed` once to precompute a local-model embedding cache, and `ask` then fuses lexical + vector (RRF) for semantic matches.
Piped output (`querypad ask ... | ...`) switches result tables to TSV.

## `explain`: justify every join

```bash
querypad explain ./data
```

Justifies each inferred relationship from its stored signals, and lists caveats to verify:

```text
payments.user_id ↳ users.id — 100% (many-to-one)
  • 100% of distinct payments.user_id values are present in users.id
  • column name strongly matches the target
  • exact type match
  • many-to-one (target key is unique)

Caveats (0)
  None.
```

## Verdicts: curate what the AI inferred

The AI proposes; you decide.
Reject a wrong join or add a missing one in `.datactx/verdicts.json`, and `inspect`, `ask`, and `explain` all honor it (curation survives re-inspection):

```json
{
  "verdicts": { "events.user_id->users.id": "rejected" },
  "overrides": []
}
```

## `enrich`: teach it your vocabulary

```bash
querypad enrich ./data glossary.md data-dictionary.csv --apply
```

Drop in your existing business-glossary documents - Markdown, text, CSV, or JSON -
and `enrich` normalizes them, asks the model to extract terms **grounded on your real
schema** (each term mapped to a real table/column, unmappable ones dropped), and merges
the resulting descriptions and synonyms into the semantic model.
It writes `.datactx/glossary.json` as reviewable proposals; `--apply` folds them into `semantic-model.yaml`.
Those synonyms and descriptions then feed `resolve_terms`, so the analyst understands your team's vocabulary.

## `export-okf`: interop with the agent ecosystem

```bash
querypad export-okf ./data
```

Exports the semantic model as an [Open Knowledge Format](https://okf.md) (OKF v0.1) bundle
under `.datactx/okf/` - Markdown with YAML frontmatter, one file per entity plus an
`index.md`, interlinked - so any OKF-aware tool or coding agent can consume the model directly.

## How relationship discovery works

For every table, QueryPad computes a statistical profile (row count, null %,
distinct count, ranges, top values).
It then identifies primary-key candidates (unique, non-null), prunes likely foreign-key pairs by **name similarity** and **type compatibility**, and runs a **value-overlap** query for each survivor.
A confidence score blends four signals - value overlap (dominant), name similarity, type match, and cardinality shape - and competition disambiguation keeps a foreign column pointed at its single strongest target, so overlapping integer id ranges don't produce false positives.

## Product layers

| Layer | What it does | Status |
|-------|--------------|--------|
| **1 - Dataset Discovery** | Scan folders; detect schema, types, statistics, uniqueness, cardinality | ✅ Built |
| **2 - Relationship Discovery** | Infer joins automatically with confidence scores | ✅ Built |
| **3 - Semantic Model** | Entities + dimensions/measures/synonyms, metric compiler, term resolution, glossary, OKF | ✅ Built |
| **4 - AI Analyst** | Question → agentic tool-using loop (explore → SQL → self-correct → insight) | ✅ Built |
| **MCP server** | Expose the read-only engine as typed tools for Claude Code / Cursor | 🚧 Next |

See [ROADMAP.md](ROADMAP.md) for the full plan.

## Architecture

```text
src/core/      pure logic, zero npm deps (discovery · agent · sql · format · types)
src/engine/    QueryRunner implementations (duckdb: native @duckdb/node-api)
src/ai/        provider-agnostic LLM completion (Anthropic / OpenAI, BYOK)
src/embed/     embedding interface + optional Transformers.js backend
src/adapters/  thin, replaceable surfaces (cli today; mcp next)
```

The core never touches a concrete database connection or an HTTP client - both
are injected - so future surfaces (MCP server, terminal host) plug in under
`adapters/` without touching the engine.

## Development

```bash
npm run querypad -- inspect ./fixtures/data   # run from source (tsx)
npm run test:cli                              # unit + spawn-based e2e tests
npm run check                                 # version metadata + lint + typecheck + build
```

## Releases

QueryPad is a local-first tool, not a hosted SaaS.
Version numbers mark GitHub release milestones and public product updates.
See [CHANGELOG.md](CHANGELOG.md) for release notes.
The retired browser app remains readable at the `web-final` tag.

## Contributing

Contributions are welcome! Feel free to open issues and pull requests. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

---

Built by [@vericontext](https://x.com/vericontext)
