import path from "node:path";
import { runAsk } from "./ask";
import { runEnrich } from "./enrich";
import { runExplain } from "./explain";
import { runExportOkf } from "./export-okf";
import { runInspect } from "./inspect";
import { resolveSource } from "./source";

const HELP = `querypad — local-first dataset understanding

Usage:
  querypad inspect [folder]        Profile a folder of data files and infer relationships
                                   (writes .datactx/ artifacts). Defaults to the current directory.
                                   --embed  precompute a term-embeddings cache (local model)
                                            so ask can resolve synonyms/terms semantically
  querypad ask "<question>" [folder]
                                   Answer a natural-language question: an agentic loop explores
                                   the schema, runs read-only SQL (self-correcting on errors),
                                   and explains the result — grounded in the inferred relationships.
  querypad enrich <folder> <doc…>  Ingest business-glossary docs (.md/.txt/.csv/.json)
                                   and map terms → real columns, adding descriptions/synonyms
                                   to the semantic model. Add --apply to write semantic-model.yaml.
  querypad explain [folder]        Justify each inferred relationship from its signals,
                                   with caveats to verify (reads .datactx/; run inspect first).
  querypad export-okf [folder]     Export the semantic model as an Open Knowledge Format
                                   (Markdown+frontmatter) bundle under .datactx/okf/.
  querypad mcp [folder]            Run an MCP server over stdio, exposing the read-only
                                   tools (describe_dataset, list_tables, describe_table,
                                   sample_table, resolve_terms, query_metric, run_sql) to
                                   Claude Code / Cursor. Accepts --db/--schema/--out too.
  querypad eval <engine|agent>     Score the engine (deterministic, no API key) or the agent
                                   (needs a key) against evals/cases/. --json for raw output;
                                   agent accepts --cases <id,…> and --repeat <n>.
  querypad help                    Show this help

External databases (inspect · ask · enrich):
  --db <connection>                Attach a database read-only instead of scanning a folder:
                                     postgres://user:pw@host:5432/db
                                     mysql://user:pw@host:3306/db
                                     sqlite:./shop.db      (or a bare ./shop.db path)
                                   Its tables become views, so profiling and joins push down
                                   to the source. DuckDB enforces read-only; nothing is written.
  --schema <name>                  Restrict discovery to one schema (e.g. public)
  --out <folder>                   Where to write .datactx/ (default: current directory)

Options for ask:
  --provider <anthropic|openai>    AI provider (default: anthropic, or QUERYPAD_AI_PROVIDER)
                                   (agent mode is Anthropic-first; OpenAI uses single-shot)
  --show-sql                       Print the generated SQL without executing
  --steps <n>                      Max agent tool-using turns (default: 8)
  --verbose                        Print each agent tool step

Environment: ANTHROPIC_API_KEY or OPENAI_API_KEY for the chosen provider.
Supported file types: .parquet, .csv, .tsv, .json, .jsonl, .ndjson
`;

/** Split positional args from flags. Returns { positionals, flags }. */
function parseArgs(args: string[]): {
  positionals: string[];
  flags: Record<string, string | boolean>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

/** Read a flag that must carry a value (`--db x`, not a bare `--db`). */
function stringFlag(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const value = flags[name];
  if (value === true) throw new Error(`--${name} needs a value.`);
  return typeof value === "string" ? value : undefined;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return 0;
    case "inspect": {
      const { positionals, flags } = parseArgs(rest);
      const embedder = flags.embed === true
        ? (await import("../../embed/transformers-embedder")).createTransformersEmbedder()
        : undefined;
      const source = resolveSource({
        folder: positionals[0],
        db: stringFlag(flags, "db"),
        schema: stringFlag(flags, "schema"),
        out: stringFlag(flags, "out"),
      });
      await runInspect(source, Date.now(), { embedder });
      return 0;
    }
    case "ask": {
      const { positionals, flags } = parseArgs(rest);
      const question = positionals[0];
      if (!question) {
        console.error('Usage: querypad ask "<question>" [folder]\n');
        console.error(HELP);
        return 1;
      }
      const steps = typeof flags.steps === "string" ? Number(flags.steps) : undefined;
      await runAsk({
        question,
        source: resolveSource({
          folder: positionals[1],
          db: stringFlag(flags, "db"),
          schema: stringFlag(flags, "schema"),
          out: stringFlag(flags, "out"),
        }),
        provider: stringFlag(flags, "provider"),
        showSql: flags["show-sql"] === true,
        maxSteps: steps && Number.isFinite(steps) ? steps : undefined,
        verbose: flags.verbose === true,
      });
      return 0;
    }
    case "enrich": {
      const { positionals, flags } = parseArgs(rest);
      const db = stringFlag(flags, "db");
      // Without --db the first positional is the data folder; with it, all are docs.
      const folder = db ? undefined : positionals[0];
      const glossaryPaths = db ? positionals : positionals.slice(1);
      if ((!db && !folder) || glossaryPaths.length === 0) {
        console.error("Usage: querypad enrich <folder> <doc…> [--apply]\n");
        console.error("       querypad enrich --db <connection> <doc…> [--apply]\n");
        console.error(HELP);
        return 1;
      }
      await runEnrich({
        source: resolveSource({
          folder,
          db,
          schema: stringFlag(flags, "schema"),
          out: stringFlag(flags, "out"),
        }),
        glossaryPaths,
        apply: flags.apply === true,
        provider: stringFlag(flags, "provider"),
      });
      return 0;
    }
    case "explain": {
      const { positionals, flags } = parseArgs(rest);
      const out = stringFlag(flags, "out") ?? positionals[0] ?? ".";
      return runExplain(path.resolve(out));
    }
    case "export-okf": {
      const { positionals, flags } = parseArgs(rest);
      const out = stringFlag(flags, "out") ?? positionals[0] ?? ".";
      return runExportOkf(path.resolve(out));
    }
    case "eval": {
      const { positionals, flags } = parseArgs(rest);
      const { runEval } = await import("./eval");
      const repeat = typeof flags.repeat === "string" ? Number(flags.repeat) : undefined;
      return runEval({
        suite: positionals[0] ?? "engine",
        json: flags.json === true,
        only: typeof flags.cases === "string" ? flags.cases.split(",") : undefined,
        repeat: repeat && Number.isFinite(repeat) ? repeat : undefined,
        provider: stringFlag(flags, "provider"),
      });
    }
    case "mcp": {
      const { positionals, flags } = parseArgs(rest);
      const { runMcp } = await import("../mcp/server");
      return runMcp({
        source: resolveSource({
          folder: positionals[0],
          db: stringFlag(flags, "db"),
          schema: stringFlag(flags, "schema"),
          out: stringFlag(flags, "out"),
        }),
      });
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(HELP);
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
