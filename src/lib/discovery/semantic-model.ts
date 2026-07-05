import type { ColumnProfile, TableProfile } from "../../types";
import type {
  Relationship,
  SemanticDimension,
  SemanticEntity,
  SemanticMeasure,
  SemanticModel,
} from "../../types/discovery";
import { singularize, splitTokens } from "./signals";

/**
 * Roll inferred relationships into named business entities. Pure — tables +
 * relationships in, semantic model out. No DuckDB / IO.
 */

/** A column is treated as categorical only when its distinct count is at or below this. */
const CATEGORICAL_MAX_DISTINCT = 50;
/** Include the literal value list only when the distinct count is at or below this. */
const CATEGORICAL_VALUES_MAX = 25;
/** Categorical columns must not exceed this fraction of the row count. */
const CATEGORICAL_MAX_DISTINCT_RATIO = 0.5;

function capitalize(token: string): string {
  return token.length === 0 ? token : token[0].toUpperCase() + token.slice(1);
}

function pascalCase(value: string): string {
  return splitTokens(value).map(capitalize).join("") || value;
}

/** Derive a PascalCase singular entity name, e.g. `order_items` → `OrderItem`. */
export function entityName(table: string): string {
  return pascalCase(singularize(table)) || pascalCase(table) || table;
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/** Assign one entity name per table, resolving collisions deterministically. */
function nameEntities(tableNames: string[]): Map<string, string> {
  const byTable = new Map<string, string>();
  const used = new Set<string>();
  for (const table of tableNames) {
    let name = entityName(table);
    if (used.has(name)) {
      // Collision (e.g. "users" and "user"): fall back to the full table PascalCase,
      // then a numeric suffix.
      const base = pascalCase(table) || name;
      name = base;
      let suffix = 2;
      while (used.has(name)) {
        name = `${base}${suffix}`;
        suffix += 1;
      }
    }
    used.add(name);
    byTable.set(table, name);
  }
  return byTable;
}

/** Alternative surface terms for an entity: the table name + singular + spaced forms. */
function deriveSynonyms(table: string, entityName: string): string[] {
  const spaced = splitTokens(table).join(" ");
  const candidates = [table, singularize(table), spaced];
  const out: string[] = [];
  for (const term of candidates) {
    if (term && term !== entityName && !out.includes(term)) out.push(term);
  }
  return out;
}

/** Columns that are keys — relationship endpoints or id-named columns. */
function keyColumns(table: string, relationships: Relationship[]): Set<string> {
  const keys = new Set<string>();
  for (const rel of relationships) {
    if (rel.from.table === table) keys.add(rel.from.column);
    if (rel.to.table === table) keys.add(rel.to.column);
  }
  return keys;
}

/**
 * True for id-named columns (surrogate keys). We exclude these from measures/dimensions
 * by name rather than by uniqueness — a unique, non-null column like `amount` is a real
 * measure, not a key, so summing it is meaningful.
 */
function isIdLike(name: string, table: string): boolean {
  const lower = name.toLowerCase();
  return lower === "id" || lower.endsWith("_id") || lower === `${singularize(table)}_id`;
}

/** Derive a dimension candidate from a non-key column, or null if it isn't one. */
function dimensionFor(col: ColumnProfile, rowCount: number): SemanticDimension | null {
  if (col.kind === "date") {
    return { name: col.name, column: col.name, kind: "time", grain: "day" };
  }
  if (col.kind === "boolean") {
    return {
      name: col.name,
      column: col.name,
      kind: "categorical",
      values: col.topValues.map((v) => v.value),
    };
  }
  if (col.kind === "text" || col.kind === "other") {
    const distinct = col.distinctCount;
    if (
      distinct !== null &&
      distinct <= CATEGORICAL_MAX_DISTINCT &&
      (rowCount === 0 || distinct <= rowCount * CATEGORICAL_MAX_DISTINCT_RATIO)
    ) {
      const dim: SemanticDimension = { name: col.name, column: col.name, kind: "categorical" };
      if (distinct <= CATEGORICAL_VALUES_MAX && col.topValues.length > 0) {
        dim.values = col.topValues.map((v) => v.value);
      }
      return dim;
    }
  }
  return null;
}

/** Mechanically derive dimensions + measures for one table from its profile. */
function enrichEntity(
  table: string,
  profile: TableProfile,
  relationships: Relationship[]
): { dimensions: SemanticDimension[]; measures: SemanticMeasure[] } {
  const keys = keyColumns(table, relationships);
  const dimensions: SemanticDimension[] = [];
  const measures: SemanticMeasure[] = [{ name: `${table}_count`, agg: "count" }];

  for (const col of profile.columns) {
    if (keys.has(col.name) || isIdLike(col.name, table)) continue;
    if (col.kind === "numeric") {
      measures.push({ name: `sum_${col.name}`, agg: "sum", column: col.name });
      continue;
    }
    const dim = dimensionFor(col, profile.rowCount);
    if (dim) dimensions.push(dim);
  }

  return { dimensions, measures };
}

export function buildSemanticModel(
  tableNames: string[],
  relationships: Relationship[],
  now: number,
  profiles?: TableProfile[]
): SemanticModel {
  const names = nameEntities(tableNames);
  const profileByTable = new Map((profiles ?? []).map((p) => [p.tableName, p]));

  const entities: SemanticEntity[] = tableNames.map((table) => {
    const entityNameValue = names.get(table)!;
    const profile = profileByTable.get(table);
    const enriched = profile
      ? enrichEntity(table, profile, relationships)
      : { dimensions: [], measures: [] };
    return {
      name: entityNameValue,
      table,
      synonyms: deriveSynonyms(table, entityNameValue),
      dimensions: enriched.dimensions,
      measures: enriched.measures,
      belongsTo: [],
      hasMany: [],
      hasOne: [],
    };
  });
  const byTable = new Map(entities.map((entity) => [entity.table, entity]));

  for (const rel of relationships) {
    const fromEntity = byTable.get(rel.from.table);
    const toEntity = byTable.get(rel.to.table);
    if (!fromEntity || !toEntity) continue;

    pushUnique(fromEntity.belongsTo, toEntity.name);
    if (rel.cardinality === "one-to-one") {
      pushUnique(toEntity.hasOne, fromEntity.name);
    } else {
      pushUnique(toEntity.hasMany, fromEntity.name);
    }
  }

  return { generatedAt: now, entities };
}

/** Quote a scalar for YAML flow context only when it could be misread. */
function flowScalar(value: string): string {
  if (value === "" || /[,:{}[\]"#]|^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function flowList(values: string[]): string {
  return `[${values.map(flowScalar).join(", ")}]`;
}

function renderDimension(dim: SemanticDimension): string {
  const parts = [`name: ${flowScalar(dim.name)}`, `column: ${flowScalar(dim.column)}`, `kind: ${dim.kind}`];
  if (dim.grain) parts.push(`grain: ${dim.grain}`);
  if (dim.values) parts.push(`values: ${flowList(dim.values)}`);
  if (dim.description) parts.push(`description: ${flowScalar(dim.description)}`);
  return `      - {${parts.join(", ")}}`;
}

function renderMeasure(measure: SemanticMeasure): string {
  const parts = [`name: ${flowScalar(measure.name)}`, `agg: ${measure.agg}`];
  if (measure.column) parts.push(`column: ${flowScalar(measure.column)}`);
  return `      - {${parts.join(", ")}}`;
}

/** Deterministically render the semantic model as YAML. */
export function renderSemanticYaml(model: SemanticModel): string {
  const lines: string[] = [
    "# QueryPad semantic model",
    `generated_at: ${new Date(model.generatedAt).toISOString()}`,
    "entities:",
  ];

  if (model.entities.length === 0) {
    lines.push("  []");
    return lines.join("\n") + "\n";
  }

  const assoc = (key: string, values: string[]) => {
    if (values.length === 0) return;
    lines.push(`    ${key}:`);
    for (const value of values) lines.push(`      - ${value}`);
  };

  for (const entity of model.entities) {
    lines.push(`  - name: ${entity.name}`);
    lines.push(`    table: ${entity.table}`);
    if (entity.description) lines.push(`    description: ${flowScalar(entity.description)}`);
    if (entity.synonyms.length > 0) lines.push(`    synonyms: ${flowList(entity.synonyms)}`);
    if (entity.dimensions.length > 0) {
      lines.push("    dimensions:");
      for (const dim of entity.dimensions) lines.push(renderDimension(dim));
    }
    if (entity.measures.length > 0) {
      lines.push("    measures:");
      for (const measure of entity.measures) lines.push(renderMeasure(measure));
    }
    assoc("belongs_to", entity.belongsTo);
    assoc("has_many", entity.hasMany);
    assoc("has_one", entity.hasOne);
  }

  return lines.join("\n") + "\n";
}
