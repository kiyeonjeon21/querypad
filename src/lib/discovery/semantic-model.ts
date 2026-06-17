import type { Relationship, SemanticEntity, SemanticModel } from "../../types/discovery";
import { singularize, splitTokens } from "./signals";

/**
 * Roll inferred relationships into named business entities. Pure — tables +
 * relationships in, semantic model out. No DuckDB / IO.
 */

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

export function buildSemanticModel(
  tableNames: string[],
  relationships: Relationship[],
  now: number
): SemanticModel {
  const names = nameEntities(tableNames);

  const entities: SemanticEntity[] = tableNames.map((table) => ({
    name: names.get(table)!,
    table,
    belongsTo: [],
    hasMany: [],
    hasOne: [],
  }));
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
    assoc("belongs_to", entity.belongsTo);
    assoc("has_many", entity.hasMany);
    assoc("has_one", entity.hasOne);
  }

  return lines.join("\n") + "\n";
}
