import type { ProfileColumnKind } from "../types";
import type { RelationshipSignals } from "../types/discovery";

/**
 * Pure scoring helpers for relationship discovery. No DuckDB / IO — everything here
 * is deterministic over plain inputs so it can be unit-tested in isolation.
 */

/** Minimum name similarity for a column pair to be worth a (costly) value-overlap query. */
export const NAME_SIMILARITY_FLOOR = 0.15;

/** Name similarity at/above which a name is considered an explicit reference to the target. */
export const STRONG_NAME_SIMILARITY = 0.9;

/** Minimum value overlap for an edge to be emitted at all. */
export const OVERLAP_FLOOR = 0.5;

// Confidence weights — value overlap dominates, name similarity is the next strongest.
const WEIGHTS = {
  valueOverlap: 0.55,
  nameSimilarity: 0.25,
  typeMatch: 0.1,
  cardinalityShape: 0.1,
} as const;

/** Split an identifier into lowercase tokens across snake_case and camelCase boundaries. */
export function splitTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

/** Very small, dependency-free singularizer good enough for table-name heuristics. */
export function singularize(word: string): string {
  const lower = word.toLowerCase();
  if (lower.endsWith("ies") && lower.length > 3) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ses") && lower.length > 3) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 1) return lower.slice(0, -1);
  return lower;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Name similarity between a foreign column and the key it might reference.
 * Rewards the canonical `<singular-table>_<key>` and exact-name conventions,
 * and falls back to token overlap against both the key column and its table.
 */
export function nameSimilarity(
  foreignColumn: string,
  keyColumn: string,
  keyTable: string
): number {
  const foreign = foreignColumn.toLowerCase();
  const key = keyColumn.toLowerCase();
  const table = singularize(keyTable);

  // events.user_id ↳ users.id  →  "user_id" === "user" + "_" + "id"
  if (foreign === `${table}_${key}`) return 1;
  // payments.customer_id ↳ subscriptions.customer_id  →  identical column names
  if (foreign === key && key !== "id") return 1;
  // orders.user ↳ users.id
  if (foreign === table) return 0.9;

  const foreignTokens = splitTokens(foreignColumn);
  const keyTokens = splitTokens(`${keyTable} ${keyColumn}`);
  const overlap = jaccard(foreignTokens, keyTokens);

  // A bare shared "id" token is weak; require the table name to also appear.
  if (foreignTokens.includes(table)) return Math.max(overlap, 0.7);
  return overlap;
}

/** Are two column kinds joinable at all? */
/**
 * True for id-named columns (surrogate keys). Deliberately name-based, not
 * uniqueness-based: a unique, non-null column like `amount` is a real measure, not a
 * key, so summing it is meaningful and joining on it is not.
 */
export function isIdLike(name: string, table: string): boolean {
  const lower = name.toLowerCase();
  return lower === "id" || lower.endsWith("_id") || lower === `${singularize(table)}_id`;
}

export function isTypeCompatible(a: ProfileColumnKind, b: ProfileColumnKind): boolean {
  if (a === b) return true;
  // numbers stored as text vs numeric still routinely join after casting
  return (a === "numeric" && b === "text") || (a === "text" && b === "numeric");
}

/** 1 for identical type strings, 0.85 for same-kind, 0.4 for compatible cross-kind. */
export function typeMatchScore(
  foreignType: string,
  keyType: string,
  foreignKind: ProfileColumnKind,
  keyKind: ProfileColumnKind
): number {
  if (foreignType.toUpperCase() === keyType.toUpperCase()) return 1;
  if (foreignKind === keyKind) return 0.85;
  return isTypeCompatible(foreignKind, keyKind) ? 0.4 : 0;
}

/** 1 for a clean many-to-one; 0.8 when both sides are unique (one-to-one). */
export function cardinalityShapeScore(keyUnique: boolean, foreignUnique: boolean): number {
  if (!keyUnique) return 0;
  return foreignUnique ? 0.8 : 1;
}

/** Blend the individual signals into a 0..100 confidence score. */
export function confidence(signals: RelationshipSignals): number {
  const weighted =
    WEIGHTS.valueOverlap * signals.valueOverlap +
    WEIGHTS.nameSimilarity * signals.nameSimilarity +
    WEIGHTS.typeMatch * signals.typeMatch +
    WEIGHTS.cardinalityShape * signals.cardinalityShape;
  return Math.round(weighted * 100);
}
