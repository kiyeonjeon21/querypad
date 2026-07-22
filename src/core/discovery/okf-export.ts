import type { SemanticModel } from "../types/discovery";

/**
 * Export the semantic model as an Open Knowledge Format (OKF v0.1) bundle — a directory of
 * Markdown files with YAML frontmatter, one per entity plus an `index.md`, interlinked with
 * Markdown links. Pure — no IO. Lets any OKF/agent-ecosystem tool consume Grain's model.
 */

export interface OkfFile {
  /** Path relative to the bundle root, e.g. `index.md` or `users.md`. */
  path: string;
  content: string;
}

/** Render a frontmatter value as valid YAML (JSON string quoting is YAML-compatible). */
function yamlValue(value: string | string[]): string {
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  return JSON.stringify(value);
}

function frontmatter(fields: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) lines.push(`${key}: ${yamlValue(value)}`);
  lines.push("---");
  return lines.join("\n");
}

export function buildOkfBundle(model: SemanticModel): OkfFile[] {
  const timestamp = new Date(model.generatedAt).toISOString();
  const tableByEntity = new Map(model.entities.map((e) => [e.name, e.table]));
  const files: OkfFile[] = [];

  // index.md — the bundle entry point.
  const indexBody = [
    "# Dataset",
    "",
    `Semantic model with ${model.entities.length} entit${model.entities.length === 1 ? "y" : "ies"}.`,
    "",
    "## Entities",
    "",
    ...model.entities.map((e) => `- [${e.name}](${e.table}.md)`),
    "",
  ].join("\n");
  files.push({
    path: "index.md",
    content:
      frontmatter({
        type: "Dataset",
        title: "Dataset",
        description: `Grain semantic model with ${model.entities.length} entities.`,
        okf_version: "0.1",
        timestamp,
      }) +
      "\n\n" +
      indexBody,
  });

  // One file per entity.
  for (const entity of model.entities) {
    const body: string[] = [`# ${entity.name}`, "", `Table: \`${entity.table}\``, ""];

    if (entity.synonyms.length > 0) {
      body.push(`Also known as: ${entity.synonyms.join(", ")}`, "");
    }
    if (entity.dimensions.length > 0) {
      body.push("## Dimensions", "", "| Name | Kind | Column | Description |", "| --- | --- | --- | --- |");
      for (const dim of entity.dimensions) {
        body.push(`| ${dim.name} | ${dim.kind} | \`${dim.column}\` | ${dim.description ?? ""} |`);
      }
      body.push("");
    }
    if (entity.measures.length > 0) {
      body.push("## Measures", "");
      for (const measure of entity.measures) {
        const expr = measure.agg === "count" ? "count(*)" : `${measure.agg}(${measure.column})`;
        body.push(`- \`${measure.name}\` — ${expr}`);
      }
      body.push("");
    }
    const associations = [
      ...entity.belongsTo.map((n) => ["belongs_to", n] as const),
      ...entity.hasMany.map((n) => ["has_many", n] as const),
      ...entity.hasOne.map((n) => ["has_one", n] as const),
    ];
    if (associations.length > 0) {
      body.push("## Relationships", "");
      for (const [rel, name] of associations) {
        const table = tableByEntity.get(name);
        body.push(table ? `- ${rel} [${name}](${table}.md)` : `- ${rel} ${name}`);
      }
      body.push("");
    }

    files.push({
      path: `${entity.table}.md`,
      content:
        frontmatter({
          type: "Table",
          title: entity.name,
          description: entity.description ?? `The ${entity.name} entity (table ${entity.table}).`,
          tags: [entity.table],
          timestamp,
        }) +
        "\n\n" +
        body.join("\n"),
    });
  }

  return files;
}
