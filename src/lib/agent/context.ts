import type {
  ColumnProfile,
  QueryError,
  QueryResult,
  TableInfo,
  TableProfileState,
} from "@/types";

const RESULT_ROW_LIMIT = 20;
const RESULT_COLUMN_LIMIT = 12;

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value)
      : String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "valueOf" in value) {
    const unwrapped = (value as { valueOf(): unknown }).valueOf();
    if (unwrapped !== value) return formatScalar(unwrapped);
  }
  return String(value);
}

function escapeMarkdownCell(value: unknown): string {
  return formatScalar(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function profileDetail(column: ColumnProfile): string {
  if (column.kind === "numeric") {
    return `range ${formatScalar(column.min)} to ${formatScalar(column.max)}, avg ${formatScalar(column.avg)}`;
  }
  if (column.kind === "date") {
    return `range ${formatScalar(column.min)} to ${formatScalar(column.max)}`;
  }
  if (column.topValues.length > 0) {
    return column.topValues
      .map((item) => `${escapeMarkdownCell(item.value)} (${item.count})`)
      .join(", ");
  }
  return "no non-null values";
}

function renderResult(result: QueryResult): string {
  if (result.columns.length === 0) return "The latest statement returned no columns.";

  const columns = result.columns.slice(0, RESULT_COLUMN_LIMIT);
  const rows = result.rows.slice(0, RESULT_ROW_LIMIT);
  const omittedColumns = result.columns.length - columns.length;
  const omittedRows = result.rowCount - rows.length;
  const header = `| ${columns.map(escapeMarkdownCell).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${columns.map((column) => escapeMarkdownCell(row[column])).join(" | ")} |`)
    .join("\n");

  const notes = [
    omittedRows > 0 ? `${omittedRows.toLocaleString()} more rows not shown` : null,
    omittedColumns > 0 ? `${omittedColumns.toLocaleString()} more columns not shown` : null,
  ].filter(Boolean);

  return [
    `Rows: ${result.rowCount.toLocaleString()}`,
    `Execution: ${result.executionTimeMs}ms`,
    "",
    header,
    divider,
    body,
    notes.length > 0 ? `\n${notes.join("; ")}.` : "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

interface BuildAgentContextInput {
  tables: TableInfo[];
  tableProfiles: Record<string, TableProfileState>;
  activeQuery: string;
  activeResult: QueryResult | null;
  activeError: QueryError | null;
}

export function buildAgentContext({
  tables,
  tableProfiles,
  activeQuery,
  activeResult,
  activeError,
}: BuildAgentContextInput): string {
  const sections: string[] = ["# QueryPad Context"];

  sections.push(
    [
      "## Tables",
      tables.length === 0
        ? "No tables loaded."
        : tables
            .map((table) => {
              const columns = table.columns
                .map((column) => `- ${column.name}: ${column.type}`)
                .join("\n");
              return `### ${table.name}\nRows: ${table.rowCount.toLocaleString()}\n\n${columns}`;
            })
            .join("\n\n"),
    ].join("\n")
  );

  const profileSections = tables.map((table) => {
    const state = tableProfiles[table.name];
    if (state?.status !== "ready" || !state.profile) {
      return `### ${table.name}\nProfile not generated.`;
    }

    const rows = state.profile.columns
      .map((column) => {
        const nullPercent = `${column.nullPercent.toFixed(column.nullPercent >= 10 ? 0 : 1)}%`;
        return `| ${escapeMarkdownCell(column.name)} | ${escapeMarkdownCell(column.type)} | ${nullPercent} | ${column.distinctCount?.toLocaleString() ?? "n/a"} | ${profileDetail(column)} |`;
      })
      .join("\n");

    return [
      `### ${table.name}`,
      `Generated: ${new Date(state.profile.generatedAt).toISOString()}`,
      "",
      "| Column | Type | Null | Distinct | Profile |",
      "| --- | --- | --- | --- | --- |",
      rows,
    ].join("\n");
  });

  sections.push(["## Data Profiles", profileSections.join("\n\n")].join("\n"));

  sections.push(
    [
      "## Active SQL",
      activeQuery.trim() ? `\`\`\`sql\n${activeQuery.trim()}\n\`\`\`` : "No active SQL query.",
    ].join("\n")
  );

  if (activeError) {
    sections.push(["## Latest Query Error", activeError.message].join("\n"));
  } else if (activeResult) {
    sections.push(["## Latest Result", renderResult(activeResult)].join("\n"));
  } else {
    sections.push(["## Latest Result", "No query result yet."].join("\n"));
  }

  sections.push(
    [
      "## Task",
      "Use this context to inspect the data, write DuckDB SQL, explain results, or suggest the next analysis step.",
    ].join("\n")
  );

  return sections.join("\n\n");
}
