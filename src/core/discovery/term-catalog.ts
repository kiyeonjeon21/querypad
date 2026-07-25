import type { SemanticModel } from "../types/discovery";

/** What kind of surface term this is, and thus what it points at. */
export type TermKind = "entity" | "synonym" | "dimension" | "measure";

/** The schema object a term resolves to (entity + table always set). */
export interface TermTarget {
  entity: string;
  table: string;
  column?: string;
  metric?: string;
}

export interface TermEntry {
  /** The searchable surface string (an entity name, synonym, dimension, or measure). */
  term: string;
  kind: TermKind;
  target: TermTarget;
  /** Richer text (term + a little context) used for embedding. */
  text: string;
}

/**
 * Flatten a semantic model into a flat catalog of searchable terms — the substrate for
 * resolving a user's words/synonyms to the right entity/column/metric. Pure — no IO.
 */
export function buildTermCatalog(model: SemanticModel): TermEntry[] {
  const entries: TermEntry[] = [];
  for (const entity of model.entities) {
    const base: TermTarget = { entity: entity.name, table: entity.table };
    const context = entity.description ? ` ${entity.description}` : "";

    entries.push({
      term: entity.name,
      kind: "entity",
      target: base,
      text: `${entity.name} ${entity.table}${context}`.trim(),
    });
    for (const synonym of entity.synonyms) {
      entries.push({
        term: synonym,
        kind: "synonym",
        target: base,
        text: `${synonym} ${entity.name}`,
      });
    }
    for (const dim of entity.dimensions) {
      const target = { ...base, column: dim.column };
      entries.push({
        term: dim.name,
        kind: "dimension",
        target,
        text: `${dim.name} ${dim.kind} dimension of ${entity.name}`,
      });
      // Glossary synonyms are the only route from a business word to an opaque
      // column name, so they have to be searchable terms in their own right.
      for (const synonym of dim.synonyms ?? []) {
        entries.push({
          term: synonym,
          kind: "synonym",
          target,
          text: `${synonym} ${dim.name} dimension of ${entity.name}`,
        });
      }
    }
    for (const measure of entity.measures) {
      const target = { ...base, metric: measure.name };
      entries.push({
        term: measure.name,
        kind: "measure",
        target,
        text: `${measure.name} ${measure.agg} measure of ${entity.name}`,
      });
      for (const synonym of measure.synonyms ?? []) {
        entries.push({
          term: synonym,
          kind: "synonym",
          target,
          text: `${synonym} ${measure.name} measure of ${entity.name}`,
        });
      }
    }
  }
  return entries;
}

/** Human-readable pointer for a resolved term, e.g. `users.plan` or `sum_amount`. */
export function formatTarget(target: TermTarget): string {
  if (target.metric) return target.metric;
  if (target.column) return `${target.table}.${target.column}`;
  return target.table;
}
