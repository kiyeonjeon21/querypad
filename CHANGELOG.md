# Changelog

QueryPad is a local-first CLI. Version numbers mark GitHub release milestones
and public product updates.

## Unreleased

### Plan-first turn for multi-part questions

- Asked for revenue *and* ticket counts per customer, the agent wrote one query joining both
  children of the same parent and silently multiplied the rows, returning 3,405 for a customer
  whose revenue is 1,702.50. A warning in the grounding context did not prevent it - the agent
  wrote one confident query in a single step - so the fix is a turn with **no tools offered**,
  forcing it to commit to an approach in writing first
- The trigger is deliberately narrow: a false negative costs nothing, a false positive spends a
  turn on every question. Data-modification questions are excluded outright, because planning
  them measured *worse* - it turned a wrong number into a blank refusal. Safety stays the
  verification pass's job
- **Measured**: 1/8 runs without planning, 8/8 with, on the one case in either suite that
  triggers it. The hard A/B moved +30.6 to +33.3 - close to one noise unit, and necessarily so,
  since planning fires on 1 of 12 cases and could move the aggregate by at most 8.3 points. The
  case-level result is strong; the suite-level result is not, and both are reported
- `--no-plan` disables it, and a test asserts a non-triggering question takes a byte-identical
  path, so the feature is provably free when it does not apply

### Measure names are unique, and the fan-out case is gradeable (bug fix)

- Two tables with the same numeric column produced the same measure name, and the metric compiler
  resolved a name by scanning entities in order - so it silently computed the first table's
  measure. **This was live**: the committed hard dataset already had `sum_net_amt` on both `inv`
  and `inv_staging`, and its engine cases passed only because `inv` sorts before `inv_staging`
- Measure names are now unique across the model, table-qualifying *every* side of a collision so
  the outcome never depends on table order. Names that do not collide are untouched
- The eval's fan-out case asked for two numbers, the agent answered with two queries, and the row
  grader only saw the last one - it was failing for harness reasons. Reframed to one row per
  customer: a single gradeable result set that keeps the trap sharp
- **Re-measured**: the hard A/B is unchanged at **+30.6** (grounded 31/36, raw-sql 20/36) across
  two runs at different code states, which is a reproducibility signal for the harness itself.
  The reframed fan-out case still fails, but now for a real reason - an exact 2x fan-out
  inflation rather than a grading artifact

### A price column is no longer mistaken for a join target (bug fix)

- Relationship inference treated **any** unique, non-null column as a valid foreign-key target.
  A small price list has unique prices, so every money column whose values happened to coincide
  was "explained" as a foreign key into it - measured at 81%, 68% and 54% on a realistic fixture
- The damage was worse than a wrong edge in the graph. Both endpoints of a relationship are
  excluded from the semantic model, so a phantom edge **silently deleted the table's real
  measure**: an invoice table stopped exposing `sum_net_amt` at all, with nothing in the output
  to say why
- A non-id target is now credible only when the foreign column names it outright, which is what
  a genuine natural key looks like (`sku -> sku`, `region_cd -> region_cd`). Uniqueness alone no
  longer qualifies
- `isIdLike` moved to `signals.ts` as the single shared definition. The two halves of the engine
  had disagreed about it: the semantic model already knew that "a unique, non-null column like
  `amount` is a real measure, not a key", and inference did not
- Both engine suites are unchanged (18/18 and 25/25), so no real edge was lost, and a regression
  test pins the fixture that reproduces it

### Measures now carry their grain (bug fix)

- A measure had no notion of the grain it is valid at, so being handed one could make the agent
  *worse*: told that "net revenue" is `inv.net_amt`, it summed that column after joining down to
  `inv_line` and double-counted every invoice across its lines (2,520.50 instead of 1,074). This
  was the one case the grounded arm lost in the hard A/B, and it lost it because of the grounding
- `SemanticMeasure` now carries `grain`, and the grounding context states it plainly: *"measures
  are per inv row; joining InvLine repeats each inv row, so aggregate at that grain instead of
  summing across the join"*. The warning is derived from each entity's existing `has_many`, so it
  needs no new inference
- **Measured**: the target case went **0/3 to 3/3** and the hard A/B delta went **+22.2 to +30.6
  points** (grounded 31/36 = 86.1%, 10/12 cases; raw-sql 20/36 = 55.6%). The control arm gets no
  grounding context, so it is an unchanged control across both runs
- The fan-out case also stopped double-counting (its wrong answer of 8,156 is gone), though it now
  fails on a grading artifact: the agent answers a two-part question with two queries and the row
  grader sees only the last. That case is queued to be reframed
- Reported alongside: `hard-safety-no-write` regressed 2/3 to 0/3 in the grounded arm with its
  same known failure mode. Nothing in this change touches that path and the control moved by one
  run on identical inputs, so it reads as variance on a boundary case rather than a caused
  regression - but it is recorded rather than smoothed over

### A harder trap dataset, and a moat claim that now holds

- New `evals/dataset-hard/` (11 tables, deliberately bad naming) plus a committed glossary at
  `evals/glossary-hard.json`. It exists because the first dataset stopped discriminating: 8 of
  its 12 cases pass in *both* A/B arms
- Traps were chosen against the engine's **measured** solvable envelope, not intuition. An FK is
  only discoverable when it shares a token with `"<keyTable> <keyColumn>"`, so `cust_ref` and
  `owner` were rejected - the engine cannot solve those either, so they would fail in both arms
  and discriminate nothing
- **The A/B now discriminates: grounded 29/36 runs (80.6%, 9/12 cases) vs raw-sql 21/36 (58.3%,
  6/12), a +22.2 point delta with both metrics agreeing in direction**, versus +2.8 and
  disagreeing on the original dataset. Mean tool steps 1.5 vs 4.5. Validity checks clean:
  neither arm hit the turn budget, both baseline controls passed in both arms
- Every one of the control arm's failures has the same cause - it does not exclude void
  invoices - which is exactly the kind of rule a schema cannot express and a glossary can
- Two results kept in the open rather than tuned away: grounding **lost** `revenue-by-category`
  0/3 vs 1/3 by summing an invoice-grain measure at line grain, and both arms fail the fan-out
  case identically (8,156 vs 2,039), so grounding does not prevent fan-out once the agent
  hand-writes SQL instead of using `query_metric`
- `eval:engine:hard` is 25/25 and gates CI. Drop `--glossary` and exactly the five term cases
  fail, which a test asserts - the enrichment chain cannot silently rot
- Every `expectedSql` was verified against the CSVs before being committed, and a test re-runs
  all twelve so ground truth cannot drift

### Enrichment now reaches the agent and the resolver (bug fix)

- `enrich --apply` wrote descriptions and synonyms that **nothing ever read back**: there was no
  `readGlossary`, and `prepareDataset` rebuilt the semantic model from profiles on every run, so
  every enrichment was discarded before the next `ask`. `glossary.json` is now a curation input
  re-applied over the derived model, exactly as `verdicts.json` is re-applied over inferred
  relationships
- Glossary entries naming a **numeric** column were silently dropped, because a numeric column
  becomes a *measure* and `mergeGlossary` only looked at dimensions. Column-level entries now
  resolve against measures too - which is what makes a money term like "revenue" attachable at all
- `SemanticDimension` and `SemanticMeasure` carry `synonyms`, and `buildTermCatalog` indexes them,
  so a business word can finally resolve to an opaque column: `resolve_terms("net revenue")` now
  returns `sum_amt_c` where before it returned "No matching terms"
- The grounding context renders entity descriptions/synonyms and inline dimension/measure
  annotations, so enrichment is visible to the agent rather than only to the YAML file

### Grounded vs raw-SQL A/B (the moat claim, measured)

- New `querypad eval agent --ab`: runs two arms over the same cases, **interleaved case by case**
  so API drift cannot masquerade as a result. `grounded` is the zero-override arm (the shipped path,
  asserted identical to a plain run); `raw-sql` gets `run_sql` alone and no grounding context, and is
  not crippled - SHOW/DESCRIBE are read-only, so it discovers the schema itself the way a shell agent
  would. Also `--arm <grounded|raw-sql>` and `--steps <n>`
- **Result: the accuracy claim is not supported yet.** 12 cases, repeat 3, verify on, maxSteps 12:
  grounded 29/36 runs (80.6%, 8/12 cases) vs raw-sql 28/36 (77.8%, 9/12 cases). +2.8 points is far
  inside the noise floor at this sample size, and the arms disagree on direction depending on the
  metric. 8 of 12 cases passed 3/3 in *both* arms, including the fan-out, multi-hop, distinct and
  null-join traps
- **Result: efficiency is a large, consistent win.** 1.7 vs 4.3 mean tool steps, lower on every
  single case - grounding removes roughly 60% of the exploration
- Validity checks passed (they are printed before the score, and a dirty one means rerun rather than
  interpret): neither arm hit the turn budget, and both `baseline` control cases passed 3/3 in both
  arms
- Grading integrity: accuracy-only for both arms, because applying the case file's behavioral
  assertions to the grounded arm alone would have given the arm under test a strictly harder rubric.
  Run-level pass rates replace the strict all-runs-must-pass rule as the A/B headline, since the
  latter estimates p^N rather than p
- `AgentQueryResult.budgetExhausted` records when a turn budget forced the answer, so "failed for
  lack of grounding" and "ran out of turns" are no longer indistinguishable
- Reports now carry a `config` block (arm, repeat, verify, behavioral, maxSteps, tools, and the exact
  system prompt) so a number cannot be quoted without its setup, and a reader can audit that the
  control was not sandbagged. Per-arm report filenames keep the two artifacts apart
- `createDataToolkit` takes an `only` tool allowlist, throwing at construction on an unknown name so
  a silently tool-less agent can never look like a measurement
- Dropped the inert `mustNotUseTool: []` from the safety case: an empty array iterates zero times, so
  it read as an assertion while enforcing nothing

### Verification before answering

- `ask` now runs a self-critique pass before answering: when the agent goes to finalize, one
  verification turn re-checks projection/grain, ranking words ("most"/"top"/"single"), and
  completeness/safety, then the agent restates or self-corrects with the same read-only tools.
  On by default; `--no-verify` disables it
- Measured on the trap dataset (`eval:agent`, repeat-3): the ambiguous dual-FK over-projection
  trap went 0/3 → 3/3, and "delete every starter customer, then count the rest" stopped being a
  blanket refusal — the agent now refuses the write *and* returns the true, unmodified count
- `eval:agent --no-verify` reproduces the pre-verification baseline, so the delta is measurable
  rather than asserted

### Eval harness

- New `querypad eval <engine|agent>` command scoring both layers against `evals/dataset/`,
  a committed dataset built so careless answers are measurably wrong (fan-out, multi-hop,
  ambiguous dual foreign keys, distinct-vs-count, null joins)
- **Engine suite** (`npm run eval:engine`): deterministic, needs no API key, gates CI. Scores
  relationship inference + confidence, entity/dimension/measure derivation, metric compilation
  including the refusals that prevent fan-out, and term resolution
- **Agent suite** (`npm run eval:agent`): runs each question through the real agent loop and
  compares result rows against ground truth from the case's `expectedSql`. Grading is
  value-based — column names and row order are ignored — so any correct SQL formulation passes
  while a wrong join is caught by the number. Cases can also assert tool usage and a step budget
- `--repeat N` surfaces run-to-run non-determinism; `--cases a,b` narrows a run; reports are
  written to `.datactx/evals/` for diffing
- Dataset preparation (load → curate → model → grounding context) is now one shared
  `prepareDataset`, consumed by `ask`, the MCP server, and both eval suites

### MCP server

- New `querypad mcp [folder]` command: serves the read-only toolkit over stdio so
  Claude Code / Cursor can analyze a dataset directly
  (`claude mcp add querypad -- querypad mcp /path/to/data`). Accepts `--db`/`--schema`/`--out`
- Tools: `describe_dataset` (grounding context — tables, inferred joins, entities/
  dimensions/measures), `list_tables`, `describe_table`, `sample_table`, `resolve_terms`,
  `query_metric`, `run_sql`
- The tools are not a reimplementation: `createDataToolkit` (`src/core/agent/toolkit.ts`)
  is one definition consumed by both the internal `ask` loop and the MCP server
- Engine errors return as readable tool results rather than exceptions, so an agent on
  either surface can self-correct; `run_sql` refuses non-read-only queries
- The MCP SDK is bundled at build time, so the shipped CLI gains no runtime dependency
  (and none of the SDK's HTTP-transport packages)

### External databases

- New `--db` flag on `inspect`, `ask`, and `enrich`: attach a live **Postgres**,
  **MySQL**, or **SQLite** database instead of scanning a folder
  (`postgres://…`, `mysql://…`, `sqlite:./shop.db`, or a bare `./shop.db` path)
- Source tables are exposed as **views**, so nothing is copied into memory and
  profiling, value-overlap, and join queries push down to the source engine
- The attachment is `READ_ONLY` and DuckDB enforces it: neither QueryPad nor the
  agent can write to your database
- `--schema <name>` restricts discovery to one schema; `--out <folder>` chooses
  where `.datactx/` is written (`explain` and `export-okf` accept `--out` too)
- Passwords are stripped from every log line, error message, and artifact

## v0.7 — Terminal-First

### BREAKING: web app removed

- QueryPad is now terminal-first: the browser app (Next.js, DuckDB-Wasm, Monaco,
  charts, pipelines, sharing, collaboration, plugins — ~6k LOC) is retired. The last
  web-app state remains readable at the `web-final` git tag
- The web Relationships panel is replaced by `.datactx/verdicts.json` (below)
- Artifact directory renamed: `.querypad/` → `.datactx/` (brand-independent contract;
  re-run `inspect` after upgrading)
- `enrich` no longer accepts spreadsheets (`.xlsx`/`.xls`/`.ods`): the abandoned
  `xlsx@0.18.5` package carries two unfixable high CVEs exactly where untrusted files
  are parsed. Export the sheet as CSV instead
- Source reshaped into `src/core` (pure logic, zero npm deps) / `src/engine`
  (DuckDB binding) / `src/ai` / `src/embed` / `src/adapters` (cli)
- Dependencies: 20 → 1 (`@duckdb/node-api`); `@huggingface/transformers` is now an
  optionalDependency, needed only for `inspect --embed`

### Relationship verdicts

- New `.datactx/verdicts.json`: reject inferred joins or override/add them by hand;
  `inspect`, `ask`, and `explain` all honor it and re-runs preserve the curation

### Terminal rendering

- Result tables are display-width aware (CJK/Hangul align correctly), clamp to the
  terminal width, right-align numbers, and dim NULLs (NO_COLOR honored)
- Piped stdout switches to TSV with uncapped rows for downstream tools

### Packaging

- `tsup` bundles the CLI into a single executable (`dist/querypad.mjs`); `npm link`
  installs a working `querypad` binary. Publishing to npm is deferred until the
  product rename is settled
- New spawn-based CLI e2e suite in `npm run test:cli` (replaces Playwright)

### CLI: Dataset Understanding

- New `querypad inspect <folder>` command that profiles a folder of data files and
  infers foreign-key relationships with confidence scores
- New `querypad ask "<question>" <folder>` command (AI Analyst): an agentic loop explores
  the schema with read-only tools (`list_tables`/`describe_table`/`sample_table`/`run_sql`),
  runs SQL on DuckDB, self-corrects on errors, and explains the result — grounded in the
  inferred relationships (`--verbose` shows each tool step, `--steps` caps the turns)
- `ask` now suggests 2-3 follow-up questions after each answer (dataset-aware next steps)
- `inspect` now builds a semantic model (named business entities with belongs_to/has_many)
  and writes `.datactx/semantic-model.yaml`; `ask` feeds those entities as context too
- the semantic model now carries mechanically-derived **dimensions**, **measures**, and
  **synonyms** per entity (deterministic, no AI) — the agent is grounded in what you group
  by and the metrics that exist, the top text-to-SQL accuracy lever
- `ask`'s agent gained a **`query_metric`** tool: a deterministic compiler turns a defined
  metric + dimensions + filters into correct, **join-guarded** SQL (many-to-one joins only;
  a grouping that would fan out the measure is refused) — the agent queries the semantic
  layer instead of hand-writing every aggregation
- **hybrid term resolution**: a new `resolve_terms` agent tool maps a user's words/synonyms
  (e.g. "customers" → User, "revenue" → sum_amount) to entities/columns/metrics. Lexical by
  default; run `inspect --embed` to precompute a local-model embedding cache
  (Transformers.js, all-MiniLM-L6-v2) and `ask` fuses lexical + vector via RRF
- new `querypad enrich <folder> <doc…>` command: ingest heterogeneous business-glossary docs
  (.md/.txt/.csv/.json) → schema-grounded LLM extraction (terms mapped to **real**
  columns) → descriptions/synonyms merged into the semantic model. Writes `.datactx/glossary.json`
  proposals; `--apply` folds them into `semantic-model.yaml`
- new `querypad export-okf <folder>` command: export the semantic model as an **Open Knowledge
  Format** (OKF v0.1) bundle — Markdown+frontmatter, one file per entity + `index.md`, interlinked —
  under `.datactx/okf/`, so any OKF/agent-ecosystem tool can consume the model. `inspect`/`enrich`
  now also persist `semantic-model.json`
- New `querypad explain <folder>` command: justifies each inferred relationship from its
  signals (value overlap, name match, type, cardinality) and lists caveats to verify
- Generated SQL is read-only-gated (only SELECT/WITH/EXPLAIN/… execute) and code-fence stripped
- CLI AI keys come from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; provider via `--provider`
- Writes `.datactx/` artifacts (`schema.json`, `relationships.json`, `inspect-summary.md`)
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
