#!/usr/bin/env -S npx tsx
import { runAsk } from "./ask";
import { runExplain } from "./explain";
import { runInspect } from "./inspect";

const HELP = `querypad — local-first dataset understanding

Usage:
  querypad inspect [folder]        Profile a folder of data files and infer relationships
                                   (writes .querypad/ artifacts). Defaults to the current directory.
                                   --embed  precompute a term-embeddings cache (local model)
                                            so ask can resolve synonyms/terms semantically
  querypad ask "<question>" [folder]
                                   Answer a natural-language question: an agentic loop explores
                                   the schema, runs read-only SQL (self-correcting on errors),
                                   and explains the result — grounded in the inferred relationships.
  querypad explain [folder]        Justify each inferred relationship from its signals,
                                   with caveats to verify (reads .querypad/; run inspect first).
  querypad help                    Show this help

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
      const folder = positionals[0] ?? ".";
      const embedder = flags.embed === true
        ? (await import("../lib/embed/transformers-embedder")).createTransformersEmbedder()
        : undefined;
      await runInspect(folder, Date.now(), { embedder });
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
        folder: positionals[1] ?? ".",
        provider: typeof flags.provider === "string" ? flags.provider : undefined,
        showSql: flags["show-sql"] === true,
        maxSteps: steps && Number.isFinite(steps) ? steps : undefined,
        verbose: flags.verbose === true,
      });
      return 0;
    }
    case "explain": {
      const { positionals } = parseArgs(rest);
      return runExplain(positionals[0] ?? ".");
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
