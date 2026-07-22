import type { QueryResult } from "../types";

export type ChartType = "bar" | "line" | "scatter" | "pie";

export interface ChartConfig {
  type: ChartType;
  xColumn: string;
  yColumns: string[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

function isDateString(val: unknown): boolean {
  return typeof val === "string" && DATE_PATTERN.test(val);
}

export function detectChartConfig(result: QueryResult): ChartConfig | null {
  if (result.rows.length === 0 || result.columns.length < 2) return null;

  const sample = result.rows.slice(0, 10);
  const columns = result.columns;

  const colTypes: Record<string, "string" | "number" | "date"> = {};
  for (const col of columns) {
    const values = sample.map((r) => r[col]).filter((v) => v != null);
    if (values.length === 0) {
      colTypes[col] = "string";
      continue;
    }
    if (values.every((v) => typeof v === "number")) {
      colTypes[col] = "number";
    } else if (values.every((v) => isDateString(v))) {
      colTypes[col] = "date";
    } else {
      colTypes[col] = "string";
    }
  }

  const stringCols = columns.filter((c) => colTypes[c] === "string");
  const numberCols = columns.filter((c) => colTypes[c] === "number");
  const dateCols = columns.filter((c) => colTypes[c] === "date");

  // date + numbers → line
  if (dateCols.length >= 1 && numberCols.length >= 1) {
    return { type: "line", xColumn: dateCols[0], yColumns: numberCols };
  }

  // string + numbers → bar or pie
  if (stringCols.length >= 1 && numberCols.length >= 1) {
    const uniqueCategories = new Set(
      result.rows.map((r) => r[stringCols[0]])
    ).size;
    if (numberCols.length === 1 && uniqueCategories <= 10) {
      return { type: "pie", xColumn: stringCols[0], yColumns: numberCols };
    }
    return { type: "bar", xColumn: stringCols[0], yColumns: numberCols };
  }

  // two+ numbers → scatter
  if (numberCols.length >= 2) {
    return {
      type: "scatter",
      xColumn: numberCols[0],
      yColumns: [numberCols[1]],
    };
  }

  return null;
}
