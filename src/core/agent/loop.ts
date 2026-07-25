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

/** Write verbs that mean the user asked to modify data — refuse those, answer the rest. */
const WRITE_VERB = /\b(delete|drop|truncate|update|insert|alter|remove)\b/i;

/**
 * Questions that ask for a second quantity or a second instruction. Deliberately
 * narrow: it is the trigger for spending an extra model turn, so a false negative
 * costs nothing (the agent proceeds as before) while a false positive costs a turn
 * on every question. Derived from observed failures, not from intuition - a bare
 * "and" would fire on "give the customer name and the amount", which is one
 * quantity with two columns and already answered correctly.
 */
const MULTI_PART =
  /\bthen\b|\band how many\b|\band their\b|\band the (number|count)\b|\balong with\b|\bas well as\b/i;

/**
 * Plan-first turn for a question that asks for more than one thing. The failure it
 * targets is specific and measured: asked for revenue *and* ticket counts per
 * customer, the agent writes a single query joining both children of the same
 * parent and silently multiplies the rows - returning 3405 for a customer whose
 * revenue is 1702.50, because that customer has two tickets.
 *
 * Note the last line. Our grader compares one result set, and more importantly the
 * question genuinely asks for one table, so a plan that splits the work into two
 * separate answers would be wrong for the user as well as unscoreable.
 */
export const PLANNING_PROMPT = `Before running anything, write a short plan (2 lines at most):
1. List each quantity the question asks for, and which table each one comes from.
2. If two quantities come from different tables that both hang off the same parent, joining them in one query repeats rows and inflates the totals. Compute each at its own grain - a subquery or CTE per quantity - then combine.
Then carry out the plan and return a single result set that answers the whole question.`;

/**
 * The planning turn for a question, or null when the extra turn would buy nothing.
 * Pure — unit-tested without the network.
 *
 * Data-modification questions are deliberately excluded even though they read as
 * multi-part. Measured: planning them made things worse, turning a wrong number into
 * a blank refusal — the over-refusal failure the verification pass exists to prevent.
 * Their failure was never decomposition (the agent already separates the parts), so
 * safety stays verification's job and planning stays decomposition's.
 */
export function buildPlanningTurn(question: string): string | null {
  if (WRITE_VERB.test(question)) return null;
  return MULTI_PART.test(question) ? PLANNING_PROMPT : null;
}

/**
 * Self-critique checklist injected once before the agent finalizes. Targets the
 * mistakes a naive agent makes: over-projecting columns, ignoring ranking words,
 * and over-refusing a prompt that mixes a write instruction with a readable one.
 */
export const VERIFICATION_PROMPT = `Before you finalize, re-check your answer against the question:
1. Projection & grain — Do your result columns match exactly what was asked? Drop any grouping key or descriptive column the question did not request; an extra column changes the shape of the answer.
2. Ranking & limits — If the question says "most", "top", "highest", "fewest", "least", "single", or "only", make sure you ORDER BY the right measure and LIMIT to the number implied.
3. Completeness & safety — Answer every answerable part of the question. If any part asks to modify data, refuse only that part (all tools are read-only) and still answer the rest.
If your answer already satisfies all three, restate your final finding now with no tool calls. Otherwise, use the tools to correct it, then finalize.`;

/**
 * Build the verification turn for a question: the fixed checklist plus a targeted
 * safety line when the question contains a data-modification instruction. Pure —
 * unit-tested without the network.
 */
export function buildVerificationTurn(question: string): string {
  if (WRITE_VERB.test(question)) {
    return `${VERIFICATION_PROMPT}\n\nNote: this question contains a data-modification instruction. All tools are read-only and no data has been or will be changed. Refuse the modification explicitly, and answer any read-only part against the data exactly as it exists now — do not assume the modification happened or report a count as if it had.`;
  }
  return VERIFICATION_PROMPT;
}

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
  /**
   * True when the turn budget ran out and a final answer was forced, rather than
   * the agent finishing on its own. Without this, "it answered wrongly" and "it
   * ran out of turns" are indistinguishable — which makes any comparison of two
   * agent configurations unfalsifiable.
   */
  budgetExhausted: boolean;
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
  /** Run one self-critique turn before accepting the final answer (default false). */
  verify?: boolean;
  /**
   * Write a plan first, but only for questions that ask for more than one thing
   * (default false). Costs one model turn when it fires and nothing when it does not.
   */
  plan?: boolean;
  /** Restrict the agent to these tool names (default: the whole toolkit). */
  tools?: string[];
  /**
   * Replace the composed system prompt (preamble + grounding context). The eval
   * suite's ungrounded control arm uses this; product callers should not.
   */
  systemPrompt?: string;
  onStep?: (step: AgentStep) => void;
}

function textFrom(content: ContentBlock[]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Trim text blocks and drop empties. The API rejects an assistant message whose final
 * text block ends in whitespace, which a model writing a bulleted plan does routinely.
 */
function trimTextBlocks(content: ContentBlock[]): ContentBlock[] {
  const isText = (b: ContentBlock): b is { type: "text"; text: string } => b.type === "text";
  return content
    .map((block) => (isText(block) ? { ...block, text: block.text.trim() } : block))
    .filter((block) => !isText(block) || block.text.length > 0);
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
  const system = options.systemPrompt ?? `${AGENT_SYSTEM_PROMPT}\n\n${context}`;

  const sqlHistory: string[] = [];
  const steps: AgentStep[] = [];
  let lastResult: AgentResultRows | null = null;
  // One self-critique round: on the model's first finalization, send it back to
  // re-check projection/ranking/safety before we accept the answer.
  let verifyBudget = options.verify ? 1 : 0;

  // The same read-only toolkit the MCP server exposes — one definition, two surfaces.
  const toolkit = createDataToolkit({
    tables,
    model,
    relationships,
    runner,
    resolveTerms: options.resolveTerms,
    only: options.tools,
  });

  const messages: ChatMessage[] = [{ role: "user", content: question }];

  // Plan first, with no tools available, so the model has to commit to an approach in
  // writing before it can act. A warning in the grounding context was not enough: the
  // context already says which joins repeat rows, and the agent still wrote the
  // double-counting query in a single confident step.
  if (options.plan) {
    const planPrompt = buildPlanningTurn(question);
    if (planPrompt) {
      messages.push({ role: "user", content: planPrompt });
      const { content } = await complete({ system, messages, tools: [] });
      // Trailing whitespace on a final assistant block is rejected by the API, and a
      // transcript may not end on an assistant turn — so trim, then hand the turn back.
      messages.push({ role: "assistant", content: trimTextBlocks(content) });
      // Be explicit that the plan is not the answer. Left at "now carry out that plan",
      // the model finalized on the plan alone in 2 of 5 runs and returned no rows at all.
      messages.push({
        role: "user",
        content:
          "Now carry out that plan with the tools. You have not answered yet: run the query and " +
          "return the actual rows before giving your finding.",
      });
    }
  }

  for (let turn = 0; turn < maxSteps; turn += 1) {
    const { content } = await complete({ system, messages, tools: toolkit.definitions });
    messages.push({ role: "assistant", content });

    const toolUses = toolUsesFrom(content);
    if (toolUses.length === 0) {
      // The model wants to finalize. Spend the verify budget first, if any:
      // push the checklist and let it either restate (text-only) or self-correct.
      if (verifyBudget > 0) {
        verifyBudget -= 1;
        messages.push({ role: "user", content: buildVerificationTurn(question) });
        continue;
      }
      return {
        answer: textFrom(content),
        sqlHistory,
        steps,
        lastResult,
        budgetExhausted: false,
      };
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
  return {
    answer: textFrom(content),
    sqlHistory,
    steps,
    lastResult,
    budgetExhausted: true,
  };
}
