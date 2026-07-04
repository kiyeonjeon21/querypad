import { complete, completeWithTools } from "../lib/ai/complete";
import { SQL_SYSTEM_PROMPT, buildSqlInput } from "../lib/ai/generate-sql";
import { buildAskContext } from "../lib/agent/ask-context";
import {
  runAgentQuery,
  type AgentComplete,
  type AgentQueryResult,
  type AgentStep,
} from "../lib/agent/loop";
import { discoverRelationships } from "../lib/discovery/relationships";
import { buildSemanticModel } from "../lib/discovery/semantic-model";
import { isReadOnlyQuery, stripSqlFences } from "../lib/discovery/sql-safety";
import { createNodeDb, type QueryResultRows } from "../lib/duckdb-node/connection";
import { loadFolder } from "../lib/duckdb-node/load";
import { profileTable } from "../lib/duckdb-node/profile";
import type { Relationship } from "../types/discovery";
import { resolveAiCredentials } from "./ai-env";
import { readArtifacts } from "./artifacts";
import { renderTable } from "./render";

const ANALYST_SYSTEM_PROMPT = `You are a data analyst. Given a question, the SQL that was run, and a sample of the result rows, state the answer as a concise 1-3 sentence finding. No preamble, do not restate the SQL, do not apologize.`;

const FOLLOWUP_SYSTEM_PROMPT = `You are a data analyst. Given the user's question, the SQL, a sample of results, and the dataset's tables and relationships, propose 2-3 sharp follow-up questions a curious analyst would ask next. Output ONLY the questions, one per line, no numbering, no bullets, no preamble.`;

/** Parse model follow-up output into a clean list (strip bullets/numbering, cap at 3). */
export function parseFollowups(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Injectable AI surface so the pipeline can be tested without network calls. */
export interface AskAi {
  generateSql(input: { context: string; question: string }): Promise<string>;
  generateInsight(input: { question: string; sql: string; sample: string }): Promise<string>;
  generateFollowups?(input: {
    question: string;
    sql: string;
    sample: string;
    context: string;
  }): Promise<string[]>;
  /** When present, `ask` runs an agentic tool-using loop instead of single-shot. */
  agentComplete?: AgentComplete;
}

export interface RunAskOptions {
  question: string;
  folder: string;
  provider?: string;
  showSql?: boolean;
  /** Max tool-using turns for the agent loop (default 8). */
  maxSteps?: number;
  /** Print each agent tool step. */
  verbose?: boolean;
  /** Injected in tests; built from env credentials otherwise. */
  ai?: AskAi;
  log?: (line: string) => void;
}

export interface AskResult {
  sql: string;
  result: QueryResultRows | null;
  insight: string | null;
  followups: string[] | null;
  /** Populated in agent mode; null for single-shot / --show-sql. */
  agent: AgentQueryResult | null;
}

function realAi(provider: string | undefined): AskAi {
  const creds = resolveAiCredentials(provider);
  const ai: AskAi = {
    generateSql: ({ context, question }) =>
      complete({
        provider: creds.provider,
        apiKey: creds.apiKey,
        system: SQL_SYSTEM_PROMPT,
        input: buildSqlInput(context, question),
      }),
    generateInsight: ({ question, sql, sample }) =>
      complete({
        provider: creds.provider,
        apiKey: creds.apiKey,
        system: ANALYST_SYSTEM_PROMPT,
        input: `Question: ${question}\n\nSQL:\n${sql}\n\nResult sample:\n${sample}`,
        maxTokens: 300,
      }),
    generateFollowups: ({ question, sql, sample, context }) =>
      complete({
        provider: creds.provider,
        apiKey: creds.apiKey,
        system: FOLLOWUP_SYSTEM_PROMPT,
        input: `${context}\n\nQuestion: ${question}\n\nSQL:\n${sql}\n\nResult sample:\n${sample}`,
        maxTokens: 300,
      }).then(parseFollowups),
  };

  // Agent mode is Anthropic-first; OpenAI falls back to the single-shot pipeline.
  if (creds.provider === "anthropic") {
    ai.agentComplete = ({ system, messages, tools, maxTokens }) =>
      completeWithTools({
        provider: creds.provider,
        apiKey: creds.apiKey,
        system,
        messages,
        tools,
        maxTokens,
      });
  }

  return ai;
}

export async function runAsk(options: RunAskOptions): Promise<AskResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const ai = options.ai ?? realAi(options.provider);

  const db = await createNodeDb();
  try {
    const { tables } = await loadFolder(options.folder, db.runner);
    if (tables.length === 0) {
      throw new Error(
        `No supported data files found in ${options.folder} ` +
          "(.parquet, .csv, .tsv, .json, .jsonl, .ndjson)."
      );
    }

    // Prefer cached .querypad/ artifacts; otherwise profile + discover on the fly.
    const cached = await readArtifacts(options.folder);
    let relationships: Relationship[];
    if (cached.relationships) {
      relationships = cached.relationships;
    } else {
      const now = Date.now();
      const profiles =
        cached.profiles ??
        (await Promise.all(tables.map((table) => profileTable(table, db.runner, now))));
      relationships = await discoverRelationships(profiles, db.runner);
    }

    const semanticModel = buildSemanticModel(
      tables.map((table) => table.name),
      relationships,
      Date.now()
    );
    const context = buildAskContext({ tables, relationships, semanticModel });

    // --show-sql: generate a single query and print it without executing.
    if (options.showSql) {
      const sql = stripSqlFences(await ai.generateSql({ context, question: options.question }));
      log("-- SQL");
      log(sql);
      return { sql, result: null, insight: null, followups: null, agent: null };
    }

    // Agent mode: a tool-using, self-correcting loop over the read-only DuckDB.
    if (ai.agentComplete) {
      const agent = await runAgentQuery({
        question: options.question,
        context,
        tables,
        runner: db.runner,
        complete: ai.agentComplete,
        maxSteps: options.maxSteps,
        onStep: options.verbose ? (step) => log(formatStep(step)) : undefined,
      });

      const sql = agent.sqlHistory[agent.sqlHistory.length - 1] ?? "";
      log("-- SQL");
      log(sql || "(no SQL executed)");
      if (agent.lastResult) {
        log("");
        log(renderTable(agent.lastResult));
      }
      log("");
      log(`Insight: ${agent.answer.trim()}`);

      const followups = await emitFollowups(ai, log, {
        question: options.question,
        sql,
        sample: agent.lastResult ? renderTable(agent.lastResult, 20) : "",
        context,
      });

      return { sql, result: agent.lastResult, insight: agent.answer, followups, agent };
    }

    // Single-shot fallback: generate SQL, execute, explain.
    const sql = stripSqlFences(await ai.generateSql({ context, question: options.question }));
    log("-- SQL");
    log(sql);

    if (!isReadOnlyQuery(sql)) {
      throw new Error(`Refusing to execute non-read-only SQL:\n${sql}`);
    }

    const result = await db.query(sql);
    log("");
    log(renderTable(result));

    const sample = renderTable(result, 20);
    const insight = await ai.generateInsight({ question: options.question, sql, sample });
    log("");
    log(`Insight: ${insight.trim()}`);

    const followups = await emitFollowups(ai, log, {
      question: options.question,
      sql,
      sample,
      context,
    });

    return { sql, result, insight, followups, agent: null };
  } finally {
    db.close();
  }
}

/** Render one agent tool step for --verbose output. */
function formatStep(step: AgentStep): string {
  const arg =
    step.tool === "run_sql"
      ? String(step.input.query ?? "")
      : JSON.stringify(step.input);
  const status = step.isError ? " [error]" : "";
  return `→ ${step.tool}${status}: ${arg}`;
}

/** Request follow-up questions (when supported) and print them. Returns the list or null. */
async function emitFollowups(
  ai: AskAi,
  log: (line: string) => void,
  input: { question: string; sql: string; sample: string; context: string }
): Promise<string[] | null> {
  if (!ai.generateFollowups) return null;
  const followups = await ai.generateFollowups(input);
  if (followups.length > 0) {
    log("");
    log("Follow-up questions:");
    followups.forEach((q, i) => log(`  ${i + 1}. ${q}`));
  }
  return followups;
}
