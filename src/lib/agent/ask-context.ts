import type { TableInfo } from "../../types";
import type { Relationship } from "../../types/discovery";
import { buildSchemaContext } from "../ai/schema-context";

export interface AskContextInput {
  tables: TableInfo[];
  relationships: Relationship[];
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

/**
 * Build the context block handed to the AI Analyst: table schemas plus the inferred
 * relationships, so generated SQL joins on the correct keys.
 */
export function buildAskContext({ tables, relationships }: AskContextInput): string {
  return [
    buildSchemaContext(tables),
    "",
    "Known relationships (use these for JOINs):",
    renderRelationships(relationships),
  ].join("\n");
}
