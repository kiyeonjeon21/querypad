import { complete, completeWithTools } from "../../ai/complete";
import { SQL_SYSTEM_PROMPT, buildSqlInput } from "../../ai/generate-sql";
import { buildAskContext } from "../../core/agent/ask-context";
import {
  runAgentQuery,
  type AgentComplete,
  type AgentQueryResult,
  type AgentStep,
} from "../../core/agent/loop";
import { discoverRelationships } from "../../core/discovery/relationships";
import { buildSemanticModel } from "../../core/discovery/semantic-model";
import { isReadOnlyQuery, stripSqlFences } from "../../core/discovery/sql-safety";
import { resolveTerms } from "../../core/discovery/term-search";
import { applyVerdicts } from "../../core/discovery/verdicts";
import { createTransformersEmbedder } from "../../embed/transformers-embedder";
import { createNodeDb, type QueryResultRows } from "../../engine/duckdb/connection";
import { profileTable } from "../../engine/duckdb/profile";
import type { Relationship } from "../../core/types/discovery";
import { resolveAiCredentials } from "./ai-env";
import { readArtifacts, readTermEmbeddings, readVerdicts } from "./artifacts";
import { renderTable, terminalRenderOptions } from "./render";
import type { Source } from "./source";

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
  source: Source;
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
    const { tables } = await options.source.load(db.runner);
    if (tables.length === 0) {
      throw new Error(options.source.emptyMessage);
    }

    // Prefer cached .datactx/ artifacts; otherwise profile + discover on the fly.
    const cached = await readArtifacts(options.source.outDir);
    const now = Date.now();
    let profiles = cached.profiles ?? undefined;
    let inferred: Relationship[];
    if (cached.relationships) {
      inferred = cached.relationships;
    } else {
      profiles =
        profiles ?? (await Promise.all(tables.map((table) => profileTable(table, db.runner, now))));
      inferred = await discoverRelationships(profiles, db.runner);
    }
    // Honor user curation (idempotent when the cache was already curated).
    const { relationships } = applyVerdicts(inferred, await readVerdicts(options.source.outDir));

    // Profiles enrich the model with dimensions/measures; undefined → entities only.
    const semanticModel = buildSemanticModel(
      tables.map((table) => table.name),
      relationships,
      now,
      profiles
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
      // Hybrid term resolution only when an embeddings cache exists (inspect --embed);
      // otherwise the loop falls back to lexical-only resolution built from the model.
      const cachedEmbeddings = await readTermEmbeddings(options.source.outDir);
      let resolveTermsFn;
      if (cachedEmbeddings) {
        const embedder = createTransformersEmbedder();
        const entries = cachedEmbeddings.entries;
        const entryVectors = entries.map((entry) => entry.vector);
        resolveTermsFn = async (query: string) => {
          const [queryVector] = await embedder([query]);
          return resolveTerms(entries, query, { queryVector, entryVectors });
        };
      }

      const agent = await runAgentQuery({
        question: options.question,
        context,
        tables,
        model: semanticModel,
        relationships,
        resolveTerms: resolveTermsFn,
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
        log(renderTable(agent.lastResult, terminalRenderOptions()));
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
    log(renderTable(result, terminalRenderOptions()));

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
