import type { Relationship, SemanticMeasure, SemanticModel } from "../../types/discovery";
import { quoteIdent as qi } from "../duckdb/sql-utils";
import { isReadOnlyQuery } from "./sql-safety";

/**
 * Deterministically compile a defined metric (+ dimensions + filters) into SQL, so the
 * agent queries the semantic layer instead of hand-writing aggregations. Pure — no IO.
 * Scope: pragmatic guarded joins (single fact table + many-to-one joins only); a grouping
 * that would fan out the measure is refused rather than silently double-counted.
 */

export interface MetricFilter {
  column: string;
  op: "=" | "!=" | "<" | "<=" | ">" | ">=";
  value: string | number;
}

export interface MetricRequest {
  metric: string;
  dimensions?: string[];
  filters?: MetricFilter[];
}

export type CompileResult = { ok: true; sql: string } | { ok: false; error: string };

const ALLOWED_OPS = new Set(["=", "!=", "<", "<=", ">", ">="]);

function fail(error: string): CompileResult {
  return { ok: false, error };
}

/** Locate the entity that owns a measure. */
function findMeasure(model: SemanticModel, metric: string): { table: string; measure: SemanticMeasure } | null {
  for (const entity of model.entities) {
    const measure = entity.measures.find((m) => m.name === metric);
    if (measure) return { table: entity.table, measure };
  }
  return null;
}

/** Locate a dimension by name. */
function findDimension(model: SemanticModel, name: string): { table: string; column: string } | null {
  for (const entity of model.entities) {
    const dim = entity.dimensions.find((d) => d.name === name);
    if (dim) return { table: entity.table, column: dim.column };
  }
  return null;
}

/** Resolve a filter column against dimensions (by name or column) then measure columns. */
function findColumn(model: SemanticModel, name: string): { table: string; column: string } | null {
  for (const entity of model.entities) {
    const dim = entity.dimensions.find((d) => d.name === name || d.column === name);
    if (dim) return { table: entity.table, column: dim.column };
  }
  for (const entity of model.entities) {
    const measure = entity.measures.find((m) => m.column === name);
    if (measure?.column) return { table: entity.table, column: measure.column };
  }
  return null;
}

function allNames(model: SemanticModel, kind: "measures" | "dimensions"): string {
  const names = model.entities.flatMap((e) =>
    kind === "measures" ? e.measures.map((m) => m.name) : e.dimensions.map((d) => d.name)
  );
  return names.join(", ") || "(none)";
}

function literal(value: string | number): string {
  return typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
}

export function compileMetric(
  model: SemanticModel,
  relationships: Relationship[],
  request: MetricRequest
): CompileResult {
  const found = findMeasure(model, request.metric);
  if (!found) {
    return fail(`Unknown metric "${request.metric}". Available: ${allNames(model, "measures")}`);
  }
  const base = found.table;
  const joins = new Map<string, string>();

  // Ensure the fact table can reach `target` via a single many-to-one hop (no fan-out).
  const ensureJoin = (target: string, what: string): string | null => {
    if (target === base || joins.has(target)) return null;
    const forward = relationships.find((r) => r.from.table === base && r.to.table === target);
    if (forward) {
      joins.set(
        target,
        `JOIN ${qi(target)} ON ${qi(base)}.${qi(forward.from.column)} = ${qi(target)}.${qi(forward.to.column)}`
      );
      return null;
    }
    const reverse = relationships.find((r) => r.from.table === target && r.to.table === base);
    if (reverse) {
      return `Cannot use "${what}": joining ${target} to ${base} is one-to-many and would fan out metric "${request.metric}". Use a metric defined on ${target} instead.`;
    }
    return `"${what}" on ${target} is not joinable to ${base} in one hop.`;
  };

  // Dimensions → SELECT/GROUP BY expressions.
  const dimExprs: string[] = [];
  const dimSelects: string[] = [];
  for (const name of request.dimensions ?? []) {
    const dim = findDimension(model, name);
    if (!dim) return fail(`Unknown dimension "${name}". Available: ${allNames(model, "dimensions")}`);
    const joinError = ensureJoin(dim.table, name);
    if (joinError) return fail(joinError);
    const expr = `${qi(dim.table)}.${qi(dim.column)}`;
    dimExprs.push(expr);
    dimSelects.push(`${expr} AS ${qi(name)}`);
  }

  // Filters → WHERE.
  const whereParts: string[] = [];
  for (const filter of request.filters ?? []) {
    if (!ALLOWED_OPS.has(filter.op)) return fail(`Unsupported filter operator "${filter.op}".`);
    const col = findColumn(model, filter.column);
    if (!col) return fail(`Unknown filter column "${filter.column}".`);
    const joinError = ensureJoin(col.table, filter.column);
    if (joinError) return fail(joinError);
    whereParts.push(`${qi(col.table)}.${qi(col.column)} ${filter.op} ${literal(filter.value)}`);
  }

  const agg =
    found.measure.agg === "count"
      ? "COUNT(*)"
      : `SUM(${qi(base)}.${qi(found.measure.column ?? "")})`;

  const select = [...dimSelects, `${agg} AS ${qi(request.metric)}`].join(", ");
  let sql = `SELECT ${select} FROM ${qi(base)}`;
  for (const clause of joins.values()) sql += ` ${clause}`;
  if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(" AND ")}`;
  if (dimExprs.length > 0) sql += ` GROUP BY ${dimExprs.join(", ")} ORDER BY ${dimExprs.join(", ")}`;

  if (!isReadOnlyQuery(sql)) return fail("Compiled SQL failed the read-only check.");
  return { ok: true, sql };
}
