import type { TableInfo } from "../types";
import type {
  ChatMessage,
  ContentBlock,
  ToolCompletion,
  ToolDefinition,
  ToolResultBlock,
  ToolUseBlock,
} from "../../ai/complete";
import type { Relationship, SemanticModel } from "../types/discovery";
import type { QueryRunner } from "../discovery/relationships";
import type { ResolvedTerm } from "../discovery/term-search";
import { createDataToolkit } from "./toolkit";

/** Preamble prepended to the grounding context to steer the agent. */
export const AGENT_SYSTEM_PROMPT = `You are a data analyst agent working over a local, read-only DuckDB database.
Use the provided tools to explore the schema and answer the user's question with SQL.

Guidance:
- Ground your SQL in the known relationships and entities below; JOIN on the inferred keys.
- Prefer inspecting the schema (describe_table / sample_table) before writing complex SQL.
- All tools are read-only. If a query errors, read the error, fix the SQL, and retry.
- When you have the answer, reply with a concise 1-3 sentence finding. Do not restate the SQL.`;

/** A structurally-compatible result shape (matches the CLI's QueryResultRows). */
export interface AgentResultRows {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** One executed tool call in the agent transcript. */
export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
}

export interface AgentQueryResult {
  answer: string;
  /** Every SQL string the agent asked to run, in order (including failed ones). */
  sqlHistory: string[];
  steps: AgentStep[];
  /** Rows from the last successful `run_sql`, for display. */
  lastResult: AgentResultRows | null;
}

/** Injectable model turn so the loop can be driven without network calls in tests. */
export type AgentComplete = (input: {
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}) => Promise<ToolCompletion>;

export interface RunAgentQueryOptions {
  question: string;
  /** Grounding context (schema + relationships + entities) from buildAskContext. */
  context: string;
  tables: TableInfo[];
  /** Semantic model + relationships back the deterministic `query_metric` tool. */
  model: SemanticModel;
  relationships: Relationship[];
  /** Optional hybrid term resolver (vector+lexical); defaults to lexical-only from the model. */
  resolveTerms?: (query: string) => Promise<ResolvedTerm[]>;
  runner: QueryRunner;
  complete: AgentComplete;
  /** Max tool-using turns before a forced final answer (default 8). */
  maxSteps?: number;
  onStep?: (step: AgentStep) => void;
}

function textFrom(content: ContentBlock[]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function toolUsesFrom(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((block): block is ToolUseBlock => block.type === "tool_use");
}

/**
 * Drive a bounded observe-act loop: the model calls read-only tools, sees their
 * output (including DB errors, so it can self-correct), and produces a final
 * finding. Engine-agnostic — the caller injects a `QueryRunner` (Node or Wasm).
 */
export async function runAgentQuery(options: RunAgentQueryOptions): Promise<AgentQueryResult> {
  const { question, context, tables, model, relationships, runner, complete } = options;
  const maxSteps = options.maxSteps ?? 8;
  const system = `${AGENT_SYSTEM_PROMPT}\n\n${context}`;

  const sqlHistory: string[] = [];
  const steps: AgentStep[] = [];
  let lastResult: AgentResultRows | null = null;

  // The same read-only toolkit the MCP server exposes — one definition, two surfaces.
  const toolkit = createDataToolkit({
    tables,
    model,
    relationships,
    runner,
    resolveTerms: options.resolveTerms,
  });

  const messages: ChatMessage[] = [{ role: "user", content: question }];

  for (let turn = 0; turn < maxSteps; turn += 1) {
    const { content } = await complete({ system, messages, tools: toolkit.definitions });
    messages.push({ role: "assistant", content });

    const toolUses = toolUsesFrom(content);
    if (toolUses.length === 0) {
      return { answer: textFrom(content), sqlHistory, steps, lastResult };
    }

    const toolResults: ToolResultBlock[] = [];
    for (const use of toolUses) {
      const input = use.input ?? {};
      const outcome = await toolkit.run(use.name, input);
      const output = outcome.text;
      const isError = outcome.isError ?? false;
      if (outcome.sql) sqlHistory.push(outcome.sql);
      if (outcome.rows) lastResult = outcome.rows;
      const step: AgentStep = { tool: use.name, input, output, isError };
      steps.push(step);
      options.onStep?.(step);
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: output,
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Step budget exhausted — force a final answer with no further tool use.
  messages.push({
    role: "user",
    content: "You have reached the step limit. Give your best final answer now. Do not call any tools.",
  });
  const { content } = await complete({ system, messages, tools: [] });
  return { answer: textFrom(content), sqlHistory, steps, lastResult };
}
