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

/** A named business entity derived from a table and its relationships. */
export interface SemanticEntity {
  /** PascalCase singular, e.g. "User". */
  name: string;
  /** Source table, e.g. "users". */
  table: string;
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

/** Full output of a folder inspection, serialized to .querypad/ artifacts. */
export interface DiscoveryReport {
  generatedAt: number;
  profiles: TableProfile[];
  relationships: Relationship[];
  semanticModel: SemanticModel;
}
