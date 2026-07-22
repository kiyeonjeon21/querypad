import type { ToolDefinition } from "../../ai/complete";
import { compileMetric, type MetricRequest } from "../discovery/compile-metric";
import type { QueryRunner } from "../discovery/relationships";
import { isReadOnlyQuery } from "../discovery/sql-safety";
import { buildTermCatalog, formatTarget } from "../discovery/term-catalog";
import { resolveTerms, type ResolvedTerm } from "../discovery/term-search";
import { quoteIdent } from "../sql/sql-utils";
import type { TableInfo } from "../types";
import type { Relationship, SemanticModel } from "../types/discovery";

/**
 * The read-only tools that make a dataset legible to an agent. Shared verbatim
 * by the built-in `ask` loop and the MCP server, so an external agent (Claude
 * Code, Cursor) sees exactly the tools our own agent uses.
 */
export const DATA_TOOL_DEFINITIONS: ToolDefinition[] = [
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

/** Rows from a tool that executed SQL, kept for display by the caller. */
export interface ToolResultRows {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ToolOutcome {
  /** Human/agent-readable output (JSON rows, a listing, a refusal, or an error). */
  text: string;
  /** SQL that was attempted, if any — recorded even when it failed. */
  sql?: string;
  /** Rows from the query, if it succeeded. */
  rows?: ToolResultRows;
  /** True when the engine rejected the query; `text` carries the message. */
  isError?: boolean;
}

export interface DataToolkitOptions {
  tables: TableInfo[];
  model: SemanticModel;
  relationships: Relationship[];
  runner: QueryRunner;
  /** Optional hybrid resolver; defaults to lexical-only over the model's catalog. */
  resolveTerms?: (query: string) => Promise<ResolvedTerm[]>;
  /** Max rows serialized into a tool's text output (default 50). */
  rowCap?: number;
}

export interface DataToolkit {
  definitions: ToolDefinition[];
  /**
   * Execute one tool. Never throws for a bad query: engine errors come back as
   * `{isError: true}` with the message as text, so an agent on either surface
   * can read the error and self-correct.
   */
  run(name: string, input: Record<string, unknown>): Promise<ToolOutcome>;
}

function toJsonScalar(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "valueOf" in value) {
    const unwrapped = (value as { valueOf(): unknown }).valueOf();
    if (unwrapped !== value) return toJsonScalar(unwrapped);
  }
  return value;
}

/** Serialize rows as JSON, capped, with a note when rows were dropped. */
export function rowsToJson(rows: Record<string, unknown>[], cap = 50): string {
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

/**
 * Build the read-only toolkit over a loaded dataset. Every tool is gated:
 * `run_sql` refuses anything that isn't read-only, and `query_metric` refuses
 * groupings that would fan out a measure.
 */
export function createDataToolkit(options: DataToolkitOptions): DataToolkit {
  const { tables, model, relationships, runner } = options;
  const cap = options.rowCap ?? 50;
  const lexicalCatalog = buildTermCatalog(model);
  const resolve =
    options.resolveTerms ?? (async (query: string) => resolveTerms(lexicalCatalog, query));
  const knownTables = new Map(tables.map((table) => [table.name, table]));

  /** Run SQL, turning an engine rejection into a readable, self-correctable outcome. */
  async function execute(sql: string): Promise<ToolOutcome> {
    try {
      const rows = await runner(sql);
      return { text: rowsToJson(rows, cap), sql, rows: { columns: columnsOf(rows), rows } };
    } catch (err) {
      return {
        text: `SQL error: ${err instanceof Error ? err.message : String(err)}`,
        sql,
        isError: true,
      };
    }
  }

  async function run(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
    switch (name) {
      case "list_tables":
        return {
          text:
            tables.length > 0
              ? tables.map((t) => `${t.name} (${t.rowCount} rows)`).join("\n")
              : "No tables are loaded.",
        };
      case "describe_table": {
        const table = knownTables.get(String(input.table));
        if (!table) {
          return {
            text: `Unknown table "${input.table}". Available: ${[...knownTables.keys()].join(", ")}`,
          };
        }
        return { text: table.columns.map((c) => `${c.name}: ${c.type}`).join("\n") };
      }
      case "sample_table": {
        const table = String(input.table);
        if (!knownTables.has(table)) {
          return {
            text: `Unknown table "${table}". Available: ${[...knownTables.keys()].join(", ")}`,
          };
        }
        const raw = typeof input.limit === "number" ? input.limit : 5;
        const limit = Math.max(1, Math.min(50, Math.trunc(raw)));
        return execute(`SELECT * FROM ${quoteIdent(table)} LIMIT ${limit}`);
      }
      case "resolve_terms": {
        const results = await resolve(String(input.query ?? ""));
        if (results.length === 0) return { text: "No matching terms." };
        return {
          text: results
            .map((r) => `${r.entry.term} (${r.entry.kind}) → ${formatTarget(r.entry.target)}`)
            .join("\n"),
        };
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
        if (!compiled.ok) return { text: compiled.error };
        return execute(compiled.sql);
      }
      case "run_sql": {
        const query = String(input.query ?? "");
        if (!isReadOnlyQuery(query)) {
          return {
            text:
              "Refusing to run non-read-only SQL. Only read-only queries (SELECT/WITH/…) are allowed.",
            sql: query,
            isError: true,
          };
        }
        return execute(query);
      }
      default:
        return { text: `Unknown tool "${name}".` };
    }
  }

  return { definitions: DATA_TOOL_DEFINITIONS, run };
}
