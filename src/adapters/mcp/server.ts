import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createDataToolkit, type DataToolkit } from "../../core/agent/toolkit";
import { prepareDataset } from "../dataset";
import { createNodeDb } from "../../engine/duckdb/connection";
import type { Source } from "../cli/source";

export const SERVER_NAME = "querypad";
export const SERVER_VERSION = "0.7.0";

/**
 * Extra tool, MCP-only: the grounding context `ask` builds for its own agent
 * (schema + inferred relationships + semantic entities). An external agent has
 * no system prompt from us, so this is how it gets grounded.
 */
const DESCRIBE_DATASET = {
  name: "describe_dataset",
  description:
    "Get the grounding context for this dataset: tables with columns, inferred relationships (with confidence), and the semantic model's entities, dimensions and measures. Call this first — it tells you which joins are correct and which metrics exist.",
  inputSchema: { type: "object" as const, properties: {} },
};

export interface McpServerDeps {
  source: Source;
  /** Injected in tests; defaults to the real DuckDB engine. */
  createDb?: typeof createNodeDb;
}

export interface PreparedTools {
  toolkit: DataToolkit;
  context: string;
  close: () => void;
}

/**
 * Load the source, curate its relationships, and build the read-only toolkit
 * plus the grounding context. The database stays open for the server's life —
 * views are lazy, so an attached external database is queried on demand.
 */
export async function prepareTools(deps: McpServerDeps): Promise<PreparedTools> {
  const db = await (deps.createDb ?? createNodeDb)();
  try {
    const { tables, relationships, model, context } = await prepareDataset(
      deps.source,
      db.runner
    );
    return {
      toolkit: createDataToolkit({ tables, model, relationships, runner: db.runner }),
      context,
      close: db.close,
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Wire the toolkit to an MCP `Server` over the low-level request handlers. */
export function createMcpServer(prepared: PreparedTools): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      DESCRIBE_DATASET,
      // The toolkit's JSON Schemas are MCP-shaped already; only the key differs.
      ...prepared.toolkit.definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === DESCRIBE_DATASET.name) {
      return { content: [{ type: "text" as const, text: prepared.context }] };
    }
    const outcome = await prepared.toolkit.run(name, args ?? {});
    return {
      content: [{ type: "text" as const, text: outcome.text }],
      isError: outcome.isError ?? false,
    };
  });

  return server;
}

/** `querypad mcp`: serve the read-only toolkit over stdio. */
export async function runMcp(deps: McpServerDeps): Promise<number> {
  const prepared = await prepareTools(deps);
  const server = createMcpServer(prepared);
  // stdout is the MCP transport — never write anything else to it.
  console.error(`querypad MCP server ready over stdio (${deps.source.label})`);
  await server.connect(new StdioServerTransport());

  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.stdin.on("close", stop);
  });
  prepared.close();
  return 0;
}
