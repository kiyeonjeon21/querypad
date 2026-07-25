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
               terminal-first surfaces:
               CLI · MCP server
```

## Install

```bash
git clone https://github.com/kiyeonjeon21/querypad && cd querypad
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

## External databases: no JDBC, no DBeaver

Point the same engine at a live database instead of a folder:

```bash
querypad inspect --db postgres://user:pw@host:5432/shop --schema public --out ./ctx
querypad inspect --db mysql://root@127.0.0.1:3306/shop
querypad inspect --db sqlite:./shop.db          # or just ./shop.db
querypad ask "revenue by plan" --db postgres://user@host/shop --out ./ctx
```

DuckDB's `postgres`/`mysql`/`sqlite` extensions attach the database and QueryPad
exposes each table as a **view**, so nothing is copied into memory and profiling,
value-overlap, and join queries push down to the source engine.
The attachment is `READ_ONLY` and **DuckDB enforces it**, so neither QueryPad nor the agent can write to your database.
Passwords are stripped from every log line and artifact.

`--out` chooses where `.datactx/` goes (default: the current directory); `explain`
and `export-okf` accept the same flag.

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
It executes on DuckDB, **self-corrects** when a query errors, and - before answering -
runs a **verification pass** that re-checks the result against the question (right columns,
ranking words like "most"/"top", and refusing any write instruction while still answering the
rest). It then explains the result:

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
Use `--verbose` to see each tool step, `--steps <n>` to cap the turns, `--no-verify` to skip the self-critique pass, or `--show-sql` to preview a single query without running it.
`resolve_terms` is lexical by default; run `querypad inspect --embed` once to precompute a local-model embedding cache, and `ask` then fuses lexical + vector (RRF) for semantic matches.
Piped output (`querypad ask ... | ...`) switches result tables to TSV.

## `mcp`: hand the engine to your coding agent

```bash
querypad mcp ./data          # or: querypad mcp --db postgres://user@host/shop
```

Runs an MCP server over stdio exposing the **same read-only tools `ask` uses internally**, so Claude Code or Cursor becomes the analyst instead of a bespoke UI:

| Tool | What it does |
|---|---|
| `describe_dataset` | The grounding context: tables, inferred joins with confidence, entities/dimensions/measures. **Call this first.** |
| `list_tables` · `describe_table` · `sample_table` | Explore the schema |
| `resolve_terms` | "customers" → User, "revenue" → sum_amount |
| `query_metric` | Compile a defined metric into correct, join-guarded SQL |
| `run_sql` | Read-only SQL; writes are refused, errors come back readable so the agent self-corrects |

Register it with Claude Code:

```bash
claude mcp add querypad -- querypad mcp /path/to/data
```

The agent never sees a write path: `run_sql` is read-only-gated, and with `--db` the attachment is `READ_ONLY` at the DuckDB level too.

## `eval`: know whether a change made it better

```bash
npm run eval:engine    # deterministic, no API key, runs in CI
npm run eval:agent     # needs ANTHROPIC_API_KEY, costs tokens
npm run eval:ab        # grounded vs raw-SQL, both arms interleaved
```

Both suites score against `evals/dataset/` - a small e-commerce dataset built so a
careless answer is *wrong*, not just differently phrased:

| Trap | What it catches |
|---|---|
| **Fan-out** | `customers` has_many both `orders` and `support_tickets`; joining through tickets inflates revenue from 9,050 to 12,650 |
| **Multi-hop** | `order_items → orders → customers` and `order_items → products → categories` |
| **Ambiguous join** | `billing_region_id` and `shipping_region_id` both reference `regions`, and give different answers |
| **Distinct vs count** | 9 customers placed 12 orders |
| **Null join** | one order has no line items; INNER vs LEFT changes the result |

**Engine suite** asserts what the deterministic layers derive: inferred relationships and
their confidence, entity/dimension/measure derivation, metric compilation *including the
refusals that prevent fan-out*, and term resolution.

**Agent suite** puts each question through the real agent loop, then compares its rows
against ground truth produced by the case's `expectedSql` (never shown to the agent).
Grading is **value-based**: column names and order are ignored, so `SELECT SUM(x) AS total`
and `AS revenue` both count as correct, while a fan-out gets caught by the number.
Cases can also assert behavior - which tools were used, and a step budget.

```text
case                     outcome  steps  detail
-----------------------  -------  -----  --------------------------------
simple-count             pass         2
revenue-by-plan          fail         5  row 1: got [12650], expected [9050]

agent: 11/12 passed (91.7%), 1 failed
```

Reports land in `.datactx/evals/` (gitignored) so runs can be diffed, each carrying the
config it was produced under so a number is never quoted without its setup.
`--repeat N` runs each case N times to surface non-determinism; `--cases a,b` narrows the run.

**A/B suite** (`--ab`) answers the question the other two cannot: is the semantic layer
actually worth anything? It runs a `grounded` arm (what ships) against a `raw-sql` arm
(one read-only SQL tool, no inferred joins, no entities, no metrics) over the same cases,
interleaved so API drift cannot masquerade as a result. The control is not crippled -
`SHOW`/`DESCRIBE` are read-only, so it discovers the schema itself.

The honest current answer, and the reason this suite exists:

| | grounded | raw-sql |
|---|---|---|
| run pass rate | 29/36 (80.6%) | 28/36 (77.8%) |
| strict cases | 8/12 | 9/12 |
| **mean tool steps** | **1.7** | **4.3** |

On **accuracy the grounding does not yet pay for itself** on this dataset: +2.8 points is
inside the noise floor, the two metrics disagree on direction, and 8 of 12 cases pass 3/3 in
*both* arms - a frontier model does not fall for a 7-table fan-out trap. On **efficiency it
clearly does**: ~60% fewer exploration steps, on every case. Both numbers are printed with
validity checks (turn-budget exhaustion, baseline controls) that must be read first.

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
| **External databases** | `--db` attaches Postgres/MySQL/SQLite read-only as pushdown views | ✅ Built |
| **MCP server** | `querypad mcp` exposes the read-only toolkit to Claude Code / Cursor | ✅ Built |

See [ROADMAP.md](ROADMAP.md) for the full plan.

## Architecture

```text
src/core/      pure logic, zero npm deps (discovery · agent · sql · format · types)
src/engine/    QueryRunner implementations (duckdb: files; attach: external DBs)
src/ai/        provider-agnostic LLM completion (Anthropic / OpenAI, BYOK)
src/embed/     embedding interface + optional Transformers.js backend
src/evals/     eval harness: grading, engine suite, agent suite, reporting
src/adapters/  thin, replaceable surfaces (cli, mcp)
```

The core never touches a concrete database connection or an HTTP client - both
are injected - so future surfaces (MCP server, terminal host) plug in under
`adapters/` without touching the engine.

## Development

```bash
npm run querypad -- inspect ./fixtures/data   # run from source (tsx)
npm run test:cli                              # unit + spawn-based e2e tests
npm run eval:engine                           # score the deterministic engine
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
