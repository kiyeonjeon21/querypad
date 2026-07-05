# QueryPad

> **Cursor for Data — a local-first AI workspace that understands your datasets, not just runs SQL on them.**

QueryPad points an AI at a folder of CSV/Parquet/JSON files, profiles them,
discovers how they connect, and helps you analyze them with DuckDB — locally,
with no server-side data processing, no account, and no install.

The execution layer is solved (DuckDB does it well). The unsolved problem is that
**people don't understand their data**: which tables exist, what each field means,
how datasets connect, which join is correct. QueryPad is built to answer those
questions first, then generate and run the SQL.

<p align="center">
  <a href="https://querypad.io"><strong>Try the web app</strong></a>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/5fa069e0-aaa2-4cc1-9735-df93b840f44d" width="100%" />
</p>

## Two surfaces, one understanding engine

QueryPad ships as a **CLI** for dataset understanding and a **browser app** for
interactive analysis. Both share the same engine-agnostic discovery core; only the
DuckDB binding differs (native `@duckdb/node-api` for the CLI, DuckDB-Wasm for the web).

```text
                 ┌─────────────────────────┐
  folder of  →   │  Discovery core         │  → .querypad/ artifacts
  data files     │  profile → relationships│     (schema + relationships)
                 │  → semantic model        │
                 └───────────┬─────────────┘
                  CLI (Node) │ Web (Wasm)
                 querypad    │ querypad.io
                 inspect     │ drop & query
```

## CLI: dataset understanding

```bash
querypad inspect ./data
```

Scans a folder, profiles every file, and infers foreign-key relationships with
confidence scores:

```text
Tables:        3
Relationships: 2
  payments.user_id ↳ users.id  (100%, many-to-one)
  events.user_id   ↳ users.id  (100%, many-to-one)

Wrote artifacts to ./data/.querypad
```

It writes machine-readable artifacts that an AI agent (Claude Code, Cursor, …) can
read to reason about the dataset instead of guessing at pandas:

```text
.querypad/
  schema.json          # tables, columns, types, per-column profiles
  relationships.json   # inferred joins with confidence + signals
  semantic-model.yaml  # named business entities (belongs_to / has_many)
  inspect-summary.md   # human- and agent-readable overview
```

`inspect` also rolls the relationships into a semantic model of named entities —
with mechanically-derived **dimensions**, **measures**, and **synonyms** (deterministic,
no AI) so the agent is grounded in what you group by and the metrics that exist:

```yaml
# .querypad/semantic-model.yaml
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

```text
Claude Code  +  QueryPad  +  DuckDB
```

## How relationship discovery works

For every table, QueryPad computes a statistical profile (row count, null %,
distinct count, ranges, top values). It then identifies primary-key candidates
(unique, non-null), prunes likely foreign-key pairs by **name similarity** and
**type compatibility**, and runs a **value-overlap** query for each survivor. A
confidence score blends four signals — value overlap (dominant), name similarity,
type match, and cardinality shape — and competition disambiguation keeps a foreign
column pointed at its single strongest target, so overlapping integer id ranges
don't produce false positives.

## Product layers

| Layer | What it does | Status |
|-------|--------------|--------|
| **1 — Dataset Discovery** | Scan folders; detect schema, types, statistics, uniqueness, cardinality | ✅ Built (`profile`) |
| **2 — Relationship Discovery** | Infer joins automatically with confidence scores | ✅ Built (`inspect`) |
| **3 — Semantic Model** | Roll relationships into named business entities (`User ├ Payment ├ Event`) | ✅ Built (`inspect`) |
| **4 — AI Analyst** | Natural-language questions → agentic tool-using loop (explore → SQL → self-correct → insight) (`ask`) | ✅ Built (`ask`) |

See [ROADMAP.md](ROADMAP.md) for the full plan.

## CLI: ask a question

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # or OPENAI_API_KEY with --provider openai
querypad ask "total payment amount by user plan" ./data
```

`ask` runs an **agentic loop**: grounded in the inferred relationships and the semantic
model, it explores the schema with read-only tools (`list_tables`, `describe_table`,
`sample_table`, `run_sql`), maps a user's wording to the schema with **`resolve_terms`**
(e.g. "customers" → User, "revenue" → sum_amount), and computes a defined metric with
**`query_metric`** — a deterministic compiler that turns a metric + dimensions + filters
into correct, join-guarded SQL (many-to-one joins only; a grouping that would fan out the
measure is refused). It executes on DuckDB, **self-corrects** when a query errors, and
explains the result:

```text
-- SQL
SELECT u.plan, COUNT(*) AS payment_count, SUM(p.amount) AS total
FROM payments p JOIN users u ON p.user_id = u.id
GROUP BY u.plan ORDER BY u.plan

plan  payment_count  total
----  -------------  ------
paid  8              285.74

Insight: All payments come from paid-plan users.

Follow-up questions:
  1. Which paid users have the highest individual payments?
  2. Are there users with no payments at all?
  3. How does payment frequency vary across plans?
```

After the answer, `ask` suggests a few dataset-aware follow-up questions to guide the next
step. Every tool is read-only-gated (only `SELECT`/`WITH`/… execute) and the DB is
in-memory, so source files are never modified. The agent loop is Anthropic-first
(OpenAI falls back to a single-shot pipeline). Use `--verbose` to see each tool step,
`--steps <n>` to cap the turns, or `--show-sql` to preview a single query without running it.
`resolve_terms` is lexical by default; run `querypad inspect --embed` once to precompute a
local-model embedding cache, and `ask` then fuses lexical + vector (RRF) for semantic matches.

## CLI: explain why

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

## CLI: enrich with a glossary

```bash
querypad enrich ./data glossary.md data-dictionary.xlsx --apply
```

Drop in your existing business-glossary documents in whatever shape they come —
Markdown, text, CSV, JSON, or Excel — and `enrich` normalizes them, asks the model to
extract terms **grounded on your real schema** (each term mapped to a real table/column,
unmappable ones dropped), and merges the resulting descriptions and synonyms into the
semantic model. It writes `.querypad/glossary.json` as reviewable proposals; `--apply`
folds them into `semantic-model.yaml`. Those synonyms and descriptions then feed
`resolve_terms`, so the analyst understands your team's vocabulary.

## CLI: export to Open Knowledge Format

```bash
querypad export-okf ./data
```

Exports the semantic model as an [Open Knowledge Format](https://okf.md) (OKF v0.1) bundle
under `.querypad/okf/` — Markdown with YAML frontmatter, one file per entity plus an
`index.md`, interlinked with Markdown links. OKF is the emerging vendor-neutral format for
giving AI agents curated context about datasets, so any OKF-aware tool (or a coding agent
reading the folder) can consume Grain's model directly.

## Web app: interactive analysis

The browser app at [querypad.io](https://querypad.io) is the same OSS app running
client-side. Your data stays on your machine unless you explicitly share or collaborate.

- **Drag & drop anything** — CSV, Parquet, JSON, Excel — drop multiple formats at once and JOIN them
- **DuckDB-Wasm SQL** — Full analytical SQL in the browser (JOIN, GROUP BY, window functions, …)
- **Data profiles** — Column-level nulls, distinct counts, ranges, averages, and top values
- **Relationship verification** — Discover inferred joins in-browser; Accept / Reject / Edit each with a per-signal "why" (verdicts persist)
- **Agent context** — Copy schema, profiles, active SQL, and latest results for Claude Code or Codex
- **AI SQL assistant** — Cmd+K for natural language to SQL with Claude or OpenAI BYOK
- **Inline charts** — One-click Bar, Line, Scatter, Pie from query results
- **URL sharing** — Compress data + query into a single shareable link
- **Sample data on first visit** — Start exploring immediately, drop your own files when ready

<details>
<summary><strong>More web app features</strong></summary>

- **Monaco Editor** — Table/column autocomplete, syntax highlighting, Cmd+Enter to run
- **Virtualized table** — Smooth rendering up to 10,000 rows
- **IndexedDB persistence** — Data and queries survive page refresh
- **Multi-tab editor** — IDE-style tabs with independent queries and results
- **Export anywhere** — CSV, JSON, Markdown, HTML, Excel, Parquet, clipboard
- **S3/HTTP loading** — Load remote Parquet/CSV/JSON files by URL
- **Transform pipelines** — Chain queries with DAG visualization
- **Plugin system** — Extend with visualizations, exporters, file loaders, SQL macros
- **Real-time collaboration** — PartyKit + Y.js CRDT with remote cursors
- **File size guardrails** — 100 MB per file limit with clear warnings

</details>

## Quick Start

**Web app:**

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Sample data is automatically loaded on first visit.

**CLI:**

```bash
npm install
npm run querypad -- inspect ./fixtures/data            # discover relationships
ANTHROPIC_API_KEY=sk-ant-... npm run querypad -- ask "payments by plan" ./fixtures/data
```

## Tech Stack

| Area | Technology |
|------|-----------|
| Query Engine | DuckDB-Wasm (web) · `@duckdb/node-api` (CLI) |
| Framework | Next.js + TypeScript + Tailwind CSS v4 |
| AI | Anthropic Claude + OpenAI BYOK |
| Editor | Monaco Editor |
| State | Zustand |
| Charts | Recharts |
| Persistence | IndexedDB (idb-keyval) |
| Collaboration | PartyKit + Y.js (optional) |

## Releases

QueryPad is a local-first tool, not a hosted SaaS. Version numbers mark GitHub
release milestones and public product updates. See [CHANGELOG.md](CHANGELOG.md)
for release notes.

## Contributing

Contributions are welcome! Feel free to open issues and pull requests. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

---

Built by [@vericontext](https://x.com/vericontext)
