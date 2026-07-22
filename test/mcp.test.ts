import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, prepareTools, SERVER_NAME } from "../src/adapters/mcp/server";
import { resolveSource } from "../src/adapters/cli/source";

/**
 * Drive the real MCP server through a real MCP client over a linked in-memory
 * transport — the same protocol Claude Code speaks, minus the subprocess.
 */
async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const prepared = await prepareTools({ source: resolveSource({ folder: "fixtures/data" }) });
  const server = createMcpServer(prepared);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
      prepared.close();
    },
  };
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

test("mcp: server identifies itself and lists the read-only toolkit", async () => {
  const { client, close } = await connectedClient();
  try {
    assert.equal(client.getServerVersion()?.name, SERVER_NAME);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "describe_dataset",
      "describe_table",
      "list_tables",
      "query_metric",
      "resolve_terms",
      "run_sql",
      "sample_table",
    ]);

    // Every tool must carry a description and an object input schema, or clients
    // cannot render or validate them.
    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} has no description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema is not an object`);
    }
  } finally {
    await close();
  }
});

test("mcp: describe_dataset returns grounding context (schema + relationships + entities)", async () => {
  const { client, close } = await connectedClient();
  try {
    const text = textOf(await client.callTool({ name: "describe_dataset", arguments: {} }));
    assert.match(text, /users/);
    assert.match(text, /payments\.user_id/);
    assert.match(text, /User/);
  } finally {
    await close();
  }
});

test("mcp: list_tables / describe_table / sample_table work over the protocol", async () => {
  const { client, close } = await connectedClient();
  try {
    const list = textOf(await client.callTool({ name: "list_tables", arguments: {} }));
    for (const table of ["users", "payments", "events"]) assert.match(list, new RegExp(table));

    const describe = textOf(
      await client.callTool({ name: "describe_table", arguments: { table: "users" } })
    );
    assert.match(describe, /id:/);
    assert.match(describe, /plan:/);

    const sample = textOf(
      await client.callTool({ name: "sample_table", arguments: { table: "users", limit: 2 } })
    );
    assert.equal(JSON.parse(sample).length, 2);
  } finally {
    await close();
  }
});

test("mcp: run_sql executes reads and refuses writes with isError", async () => {
  const { client, close } = await connectedClient();
  try {
    const ok = await client.callTool({
      name: "run_sql",
      arguments: { query: "SELECT COUNT(*) AS n FROM users" },
    });
    assert.ok(!ok.isError);
    assert.ok(JSON.parse(textOf(ok))[0].n > 0);

    const refused = await client.callTool({
      name: "run_sql",
      arguments: { query: "DELETE FROM users" },
    });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /read-only/i);

    // The refusal must not have executed: the rows are still there.
    const after = await client.callTool({
      name: "run_sql",
      arguments: { query: "SELECT COUNT(*) AS n FROM users" },
    });
    assert.ok(JSON.parse(textOf(after))[0].n > 0);
  } finally {
    await close();
  }
});

test("mcp: a bad query comes back as a readable error, not a protocol failure", async () => {
  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "run_sql",
      arguments: { query: "SELECT nonexistent_col FROM users" },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /SQL error/);
  } finally {
    await close();
  }
});

test("mcp: query_metric compiles a guarded join from the semantic model", async () => {
  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "query_metric",
      arguments: { metric: "sum_amount", dimensions: ["plan"] },
    });
    assert.ok(!result.isError, textOf(result));
    const rows = JSON.parse(textOf(result));
    assert.ok(rows.length > 0);
    assert.ok("plan" in rows[0]);
  } finally {
    await close();
  }
});

test("mcp: resolve_terms maps a synonym to the semantic model", async () => {
  const { client, close } = await connectedClient();
  try {
    const text = textOf(
      await client.callTool({ name: "resolve_terms", arguments: { query: "users" } })
    );
    assert.match(text, /User/);
  } finally {
    await close();
  }
});

test("mcp: an unknown tool reports back instead of crashing the server", async () => {
  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({ name: "frobnicate", arguments: {} });
    assert.match(textOf(result), /Unknown tool/);

    // The connection is still usable afterwards.
    const list = await client.listTools();
    assert.ok(list.tools.length > 0);
  } finally {
    await close();
  }
});
