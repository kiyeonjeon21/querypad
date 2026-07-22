import type { TableInfo } from "../types";
import type { Relationship, SemanticModel } from "../types/discovery";
import { buildSchemaContext } from "../../ai/schema-context";

export interface AskContextInput {
  tables: TableInfo[];
  relationships: Relationship[];
  semanticModel?: SemanticModel;
}

/** Render the inferred join graph as guidance for the SQL-generating model. */
function renderRelationships(relationships: Relationship[]): string {
  if (relationships.length === 0) {
    return "No relationships were inferred between the tables.";
  }
  const lines = relationships.map((rel) => {
    const from = `${rel.from.table}.${rel.from.column}`;
    const to = `${rel.to.table}.${rel.to.column}`;
    return `- ${from} -> ${to} (${rel.cardinality}, ${rel.confidence}% confidence)`;
  });
  return lines.join("\n");
}

/** Render the business entities so the model can reason in domain terms. */
function renderEntities(model: SemanticModel): string {
  const blocks = model.entities.map((entity) => {
    const assoc = [
      entity.belongsTo.length > 0 ? `belongs_to ${entity.belongsTo.join(", ")}` : null,
      entity.hasMany.length > 0 ? `has_many ${entity.hasMany.join(", ")}` : null,
      entity.hasOne.length > 0 ? `has_one ${entity.hasOne.join(", ")}` : null,
    ].filter(Boolean);
    const detail = assoc.length > 0 ? ` ${assoc.join(", ")}` : "";
    const lines = [`- ${entity.name} (table ${entity.table})${detail}`];
    if (entity.dimensions.length > 0) {
      const dims = entity.dimensions.map((d) => `${d.name} (${d.kind})`).join(", ");
      lines.push(`    dimensions: ${dims}`);
    }
    if (entity.measures.length > 0) {
      const measures = entity.measures.map((m) => `${m.name} (${m.agg})`).join(", ");
      lines.push(`    measures: ${measures}`);
    }
    return lines.join("\n");
  });
  return blocks.join("\n");
}

/**
 * Build the context block handed to the AI Analyst: table schemas, the inferred
 * relationships (so generated SQL joins on the correct keys), and — when available —
 * the semantic model's business entities for domain-level framing.
 */
export function buildAskContext({
  tables,
  relationships,
  semanticModel,
}: AskContextInput): string {
  const sections = [
    buildSchemaContext(tables),
    "",
    "Known relationships (use these for JOINs):",
    renderRelationships(relationships),
  ];

  if (semanticModel && semanticModel.entities.length > 0) {
    sections.push("", "Business entities:", renderEntities(semanticModel));
  }

  return sections.join("\n");
}
