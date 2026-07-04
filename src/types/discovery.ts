import type { TableProfile } from "./index";

/** One endpoint of a relationship: a specific column in a specific table. */
export interface ColumnRef {
  table: string;
  column: string;
}

/** Individual scoring signals behind a relationship's confidence (0..1 each). */
export interface RelationshipSignals {
  /** Fraction of distinct foreign values found in the referenced key (the decisive signal). */
  valueOverlap: number;
  /** Name-similarity between the foreign column and its key / referenced table. */
  nameSimilarity: number;
  /** 1 when types match exactly, lower for compatible-but-different types. */
  typeMatch: number;
  /** 1 for a clean many-to-one shape (key side unique, foreign side not). */
  cardinalityShape: number;
}

/** Cardinality of the relationship as observed in the data. */
export type RelationshipCardinality = "one-to-one" | "many-to-one";

/**
 * A directed foreign-key style relationship: `from` (the foreign column) references
 * `to` (the unique key column). Read as `from.column ↳ to.column`.
 */
export interface Relationship {
  from: ColumnRef;
  to: ColumnRef;
  /** 0..100, blended from `signals`. */
  confidence: number;
  cardinality: RelationshipCardinality;
  signals: RelationshipSignals;
}

/** A groupable/filterable attribute of an entity, derived from a column. */
export interface SemanticDimension {
  /** Dimension name (usually the column name). */
  name: string;
  column: string;
  kind: "categorical" | "time" | "numeric" | "boolean";
  /** Time dimensions only: the natural rollup grain. */
  grain?: "day" | "month" | "year";
  /** Categorical dimensions only, when the value set is small. */
  values?: string[];
}

/** A named aggregation over an entity. `count` omits `column`. */
export interface SemanticMeasure {
  name: string;
  agg: "count" | "sum";
  column?: string;
}

/** A named business entity derived from a table and its relationships. */
export interface SemanticEntity {
  /** PascalCase singular, e.g. "User". */
  name: string;
  /** Source table, e.g. "users". */
  table: string;
  /** Human/AI-authored description (empty until enriched). */
  description?: string;
  /** Alternative surface terms for this entity (for term resolution). */
  synonyms: string[];
  /** Groupable/filterable attributes derived from the table's columns. */
  dimensions: SemanticDimension[];
  /** Aggregations available over this entity. */
  measures: SemanticMeasure[];
  /** Entity names this entity references (foreign-key side). */
  belongsTo: string[];
  /** Entity names that reference this one with a many-to-one relationship. */
  hasMany: string[];
  /** Entity names that reference this one with a one-to-one relationship. */
  hasOne: string[];
}

/** The semantic model: business entities rolled up from tables + relationships. */
export interface SemanticModel {
  generatedAt: number;
  entities: SemanticEntity[];
}

/** A user's verification verdict on an inferred relationship. */
export type RelationshipVerdict = "accepted" | "rejected";

/** Browser-side discovery state for the relationship verification UI. */
export interface RelationshipDiscoveryState {
  status: "idle" | "loading" | "ready" | "error";
  relationships: Relationship[];
  error: string | null;
}

/** Full output of a folder inspection, serialized to .querypad/ artifacts. */
export interface DiscoveryReport {
  generatedAt: number;
  profiles: TableProfile[];
  relationships: Relationship[];
  semanticModel: SemanticModel;
}
