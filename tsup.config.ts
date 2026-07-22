import { defineConfig } from "tsup";

export default defineConfig({
  entry: { querypad: "src/adapters/cli/index.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Native addon and the optional embedding backend stay external;
  // everything else bundles into a single executable ESM file.
  external: ["@duckdb/node-api", "@huggingface/transformers"],
  // Bundle the MCP SDK so the shipped CLI carries no HTTP-transport
  // dependencies (express/hono/cors/jose) it never uses — we speak stdio only.
  noExternal: ["@modelcontextprotocol/sdk"],
});
