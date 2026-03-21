import type { QueryResult } from "@/types";
import { formatValue } from "@/lib/utils";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generateExportHtml(
  query: string,
  result: QueryResult
): string {
  const headerCells = result.columns
    .map((col) => `<th>${escapeHtml(col)}</th>`)
    .join("");

  const bodyRows = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map((col) => `<td>${escapeHtml(formatValue(row[col]))}</td>`)
          .join("")}</tr>`
    )
    .join("\n");

  const jsonData = JSON.stringify({
    query,
    columns: result.columns,
    rows: result.rows,
  }).replace(/<\/script>/gi, "<\\/script>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QueryPad Export</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 2rem; color: #1f2937; }
  h1 { font-size: 1.25rem; margin-bottom: 1rem; }
  pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.875rem; font-family: ui-monospace, monospace; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; font-size: 0.875rem; }
  th { background: #f9fafb; text-align: left; padding: 0.5rem 0.75rem; border: 1px solid #e5e7eb; font-weight: 600; white-space: nowrap; }
  td { padding: 0.5rem 0.75rem; border: 1px solid #e5e7eb; font-family: ui-monospace, monospace; white-space: nowrap; }
  tr:hover { background: #f0f9ff; }
  .meta { font-size: 0.75rem; color: #6b7280; margin-top: 0.5rem; }
</style>
</head>
<body>
<h1>QueryPad Export</h1>
<pre>${escapeHtml(query)}</pre>
<p class="meta">${result.rowCount.toLocaleString()} rows &middot; ${result.executionTimeMs}ms</p>
<table>
<thead><tr>${headerCells}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
<script>window.__QUERYPAD_DATA__ = ${jsonData};</script>
</body>
</html>`;
}
