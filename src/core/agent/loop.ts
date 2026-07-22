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
import { compileMetric, type MetricRequest } from "../discovery/compile-metric";
import type { QueryRunner } from "../discovery/relationships";
import { isReadOnlyQuery } from "../discovery/sql-safety";
import { buildTermCatalog, formatTarget } from "../discovery/term-catalog";
import { resolveTerms, type ResolvedTerm } from "../discovery/term-search";
import { quoteIdent } from "../sql/sql-utils";

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

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_tables",
    description: "List the available tables with their row counts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "describe_table",
    description: "Show the columns and types of a table.",
    input_schema: {
      type: "object",
      properties: { table: { type: "string", description: "Table name." } },
      required: ["table"],
    },
  },
  {
    name: "sample_table",
    description: "Return a few sample rows from a table.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name." },
        limit: { type: "integer", description: "Number of rows (1-50, default 5)." },
      },
      required: ["table"],
    },
  },
  {
    name: "resolve_terms",
    description:
      "Map a natural-language word or phrase (e.g. a synonym like 'customers' or 'revenue') to the matching entities, columns, or metrics. Use it when the user's wording doesn't obviously match a table/column.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "A word or phrase to resolve." } },
      required: ["query"],
    },
  },
  {
    name: "query_metric",
    description:
      "Compute a defined metric (see the entity 'measures' in context), optionally grouped by dimensions and filtered. Prefer this over run_sql when a metric exists — it emits correct, join-guarded SQL.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", description: "A measure name, e.g. sum_amount." },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "Dimension names to group by.",
        },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              op: { type: "string", enum: ["=", "!=", "<", "<=", ">", ">="] },
              value: {},
            },
            required: ["column", "op", "value"],
          },
          description: "Filters applied as a WHERE clause.",
        },
      },
      required: ["metric"],
    },
  },
  {
    name: "run_sql",
    description: "Execute a read-only SQL query (SELECT/WITH/…) and return the rows as JSON.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "A read-only SQL query." } },
      required: ["query"],
    },
  },
];

function toJsonScalar(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "valueOf" in value) {
    const unwrapped = (value as { valueOf(): unknown }).valueOf();
    if (unwrapped !== value) return toJsonScalar(unwrapped);
  }
  return value;
}

function rowsToJson(rows: Record<string, unknown>[], cap = 50): string {
  const capped = rows.slice(0, cap).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = toJsonScalar(value);
    return out;
  });
  const omitted = rows.length - capped.length;
  const note = omitted > 0 ? `\n(${omitted} more row(s) omitted)` : "";
  return JSON.stringify(capped) + note;
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  return rows.length > 0 ? Object.keys(rows[0]) : [];
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
  const lexicalCatalog = buildTermCatalog(model);
  const resolve = options.resolveTerms ?? (async (query: string) => resolveTerms(lexicalCatalog, query));
  const system = `${AGENT_SYSTEM_PROMPT}\n\n${context}`;

  const knownTables = new Map(tables.map((table) => [table.name, table]));
  const sqlHistory: string[] = [];
  const steps: AgentStep[] = [];
  let lastResult: AgentResultRows | null = null;

  async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "list_tables":
        return tables.length > 0
          ? tables.map((t) => `${t.name} (${t.rowCount} rows)`).join("\n")
          : "No tables are loaded.";
      case "describe_table": {
        const table = knownTables.get(String(input.table));
        if (!table) {
          return `Unknown table "${input.table}". Available: ${[...knownTables.keys()].join(", ")}`;
        }
        return table.columns.map((c) => `${c.name}: ${c.type}`).join("\n");
      }
      case "sample_table": {
        const name = String(input.table);
        if (!knownTables.has(name)) {
          return `Unknown table "${name}". Available: ${[...knownTables.keys()].join(", ")}`;
        }
        const raw = typeof input.limit === "number" ? input.limit : 5;
        const limit = Math.max(1, Math.min(50, Math.trunc(raw)));
        const rows = await runner(`SELECT * FROM ${quoteIdent(name)} LIMIT ${limit}`);
        return rowsToJson(rows);
      }
      case "resolve_terms": {
        const results = await resolve(String(input.query ?? ""));
        if (results.length === 0) return "No matching terms.";
        return results
          .map((r) => `${r.entry.term} (${r.entry.kind}) → ${formatTarget(r.entry.target)}`)
          .join("\n");
      }
      case "query_metric": {
        const request: MetricRequest = {
          metric: String(input.metric ?? ""),
          dimensions: Array.isArray(input.dimensions) ? input.dimensions.map(String) : undefined,
          filters: Array.isArray(input.filters)
            ? (input.filters as MetricRequest["filters"])
            : undefined,
        };
        const compiled = compileMetric(model, relationships, request);
        if (!compiled.ok) return compiled.error;
        sqlHistory.push(compiled.sql);
        const rows = await runner(compiled.sql);
        lastResult = { columns: columnsOf(rows), rows };
        return rowsToJson(rows);
      }
      case "run_sql": {
        const query = String(input.query ?? "");
        if (!isReadOnlyQuery(query)) {
          return "Refusing to run non-read-only SQL. Only read-only queries (SELECT/WITH/…) are allowed.";
        }
        const rows = await runner(query);
        lastResult = { columns: columnsOf(rows), rows };
        return rowsToJson(rows);
      }
      default:
        return `Unknown tool "${name}".`;
    }
  }

  const messages: ChatMessage[] = [{ role: "user", content: question }];

  for (let turn = 0; turn < maxSteps; turn += 1) {
    const { content } = await complete({ system, messages, tools: TOOL_DEFINITIONS });
    messages.push({ role: "assistant", content });

    const toolUses = toolUsesFrom(content);
    if (toolUses.length === 0) {
      return { answer: textFrom(content), sqlHistory, steps, lastResult };
    }

    const toolResults: ToolResultBlock[] = [];
    for (const use of toolUses) {
      const input = use.input ?? {};
      if (use.name === "run_sql" && typeof input.query === "string") {
        sqlHistory.push(input.query);
      }
      let output: string;
      let isError = false;
      try {
        output = await runTool(use.name, input);
      } catch (err) {
        output = `SQL error: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
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
