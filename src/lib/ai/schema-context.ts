import type { TableInfo } from "@/types";

export function buildSchemaContext(tables: TableInfo[]): string {
  if (tables.length === 0) return "No tables loaded.";

  return tables
    .map((t) => {
      const cols = t.columns
        .map((c) => `  - ${c.name}: ${c.type}`)
        .join("\n");
      return `Table: ${t.name} (${t.rowCount} rows)\n${cols}`;
    })
    .join("\n\n");
}
