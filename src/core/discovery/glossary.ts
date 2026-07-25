import type { SemanticModel } from "../types/discovery";
import { stripSqlFences } from "./sql-safety";

/**
 * Glossary ingestion: turn extracted business terms into descriptions/synonyms on the
 * semantic model, grounded on the real schema. Pure — no IO. Field names borrow from SKOS
 * (synonyms = altLabel) and carry provenance + confidence for review.
 */

export interface GlossaryEntry {
  term: string;
  definition: string;
  synonyms: string[];
  /** The schema object this term describes. Entity-level when `column` is omitted. */
  mapsTo?: { table: string; column?: string };
  /** 0..1. Entries below the floor are not applied. */
  confidence: number;
  source?: string;
}

export interface AppliedChange {
  target: string;
  field: "description" | "synonyms";
  value: string;
}

/** Minimum confidence for an extracted entry to be applied. */
export const CONFIDENCE_FLOOR = 0.5;

/** Parse an LLM's JSON array of glossary entries into a clean, typed list. */
export function parseGlossary(text: string): GlossaryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripSqlFences(text));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: GlossaryEntry[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const term = typeof obj.term === "string" ? obj.term.trim() : "";
    if (!term) continue;
    const mapsTo =
      obj.mapsTo && typeof obj.mapsTo === "object"
        ? (() => {
            const m = obj.mapsTo as Record<string, unknown>;
            if (typeof m.table !== "string") return undefined;
            return {
              table: m.table,
              column: typeof m.column === "string" ? m.column : undefined,
            };
          })()
        : undefined;
    entries.push({
      term,
      definition: typeof obj.definition === "string" ? obj.definition.trim() : "",
      synonyms: Array.isArray(obj.synonyms)
        ? obj.synonyms.filter((s): s is string => typeof s === "string")
        : [],
      mapsTo,
      confidence: typeof obj.confidence === "number" ? obj.confidence : CONFIDENCE_FLOOR,
      source: typeof obj.source === "string" ? obj.source : undefined,
    });
  }
  return entries;
}

function cloneModel(model: SemanticModel): SemanticModel {
  return {
    generatedAt: model.generatedAt,
    entities: model.entities.map((e) => ({
      ...e,
      synonyms: [...e.synonyms],
      dimensions: e.dimensions.map((d) => ({ ...d })),
      measures: e.measures.map((m) => ({ ...m })),
      belongsTo: [...e.belongsTo],
      hasMany: [...e.hasMany],
      hasOne: [...e.hasOne],
    })),
  };
}

/** A model object a glossary entry can annotate: an entity, a dimension, or a measure. */
interface Annotatable {
  description?: string;
  synonyms?: string[];
}

/**
 * Add synonyms to a target, skipping blanks, its own name, and duplicates.
 * Returns the ones actually added so the caller can report them.
 */
function addSynonyms(target: Annotatable, own: string, synonyms: string[]): string[] {
  const added: string[] = [];
  for (const synonym of synonyms) {
    const clean = synonym.trim();
    if (!clean || clean === own) continue;
    target.synonyms = target.synonyms ?? [];
    if (target.synonyms.includes(clean)) continue;
    target.synonyms.push(clean);
    added.push(clean);
  }
  return added;
}

/**
 * Apply glossary entries to a copy of the model: descriptions and synonyms on the entity,
 * dimension, or measure a term maps to. Entries are dropped when below the confidence floor
 * or when `mapsTo` names a table/column that doesn't exist (schema grounding). Existing
 * descriptions are not overwritten.
 *
 * A column-level entry resolves against dimensions *and* measures. That matters because a
 * numeric column never becomes a dimension — it becomes a measure named `sum_<column>` — so
 * without the measure lookup, every money term in a glossary was silently discarded.
 */
export function mergeGlossary(
  model: SemanticModel,
  entries: GlossaryEntry[],
  floor = CONFIDENCE_FLOOR
): { model: SemanticModel; applied: AppliedChange[] } {
  const next = cloneModel(model);
  const byTable = new Map(next.entities.map((e) => [e.table, e]));
  const applied: AppliedChange[] = [];

  for (const entry of entries) {
    if (entry.confidence < floor || !entry.mapsTo) continue;
    const entity = byTable.get(entry.mapsTo.table);
    if (!entity) continue; // unknown table → drop

    const column = entry.mapsTo.column;
    // Entity-level when no column is named; otherwise the dimension or the measure
    // built over that column.
    const target: Annotatable | undefined = column
      ? (entity.dimensions.find((d) => d.column === column) ??
        entity.measures.find((m) => m.column === column))
      : entity;
    if (!target) continue; // unknown column → drop
    const label = column ? `${entity.table}.${column}` : entity.name;
    const own = column ?? entity.name;

    if (entry.definition && !target.description) {
      target.description = entry.definition;
      applied.push({ target: label, field: "description", value: entry.definition });
    }
    const added = addSynonyms(target, own, entry.synonyms);
    if (added.length > 0) {
      applied.push({ target: label, field: "synonyms", value: added.join(", ") });
    }
  }

  return { model: next, applied };
}
