import type { Relationship } from "../../types/discovery";

/**
 * Turn a relationship's stored signals into a human-readable justification. Pure —
 * a relationship graph in, prose explanation out. No IO, no re-running discovery.
 */

export interface ExplainedRelationship {
  relationship: Relationship;
  reasons: string[];
}

export interface ExplainReport {
  relationships: ExplainedRelationship[];
  caveats: string[];
}

/** Confidence at/above which an edge is considered trustworthy without manual review. */
const LOW_CONFIDENCE = 75;

function ref(rel: Relationship): { from: string; to: string } {
  return {
    from: `${rel.from.table}.${rel.from.column}`,
    to: `${rel.to.table}.${rel.to.column}`,
  };
}

function reasonsFor(rel: Relationship): string[] {
  const { from, to } = ref(rel);
  const s = rel.signals;
  const reasons: string[] = [];

  reasons.push(
    `${Math.round(s.valueOverlap * 100)}% of distinct ${from} values are present in ${to}`
  );

  if (s.nameSimilarity >= 0.9) {
    reasons.push("column name strongly matches the target");
  } else if (s.nameSimilarity >= 0.5) {
    reasons.push("column name partially matches the target");
  } else {
    reasons.push("weak name match");
  }

  if (s.typeMatch >= 1) {
    reasons.push("exact type match");
  } else if (s.typeMatch >= 0.85) {
    reasons.push("same type family");
  } else if (s.typeMatch > 0) {
    reasons.push("compatible types");
  } else {
    reasons.push("type mismatch");
  }

  reasons.push(
    rel.cardinality === "one-to-one"
      ? "one-to-one (both sides unique)"
      : "many-to-one (target key is unique)"
  );

  return reasons;
}

function caveatsFor(relationships: Relationship[], tableNames: string[]): string[] {
  const caveats: string[] = [];

  for (const rel of relationships) {
    const { from, to } = ref(rel);
    if (rel.confidence < LOW_CONFIDENCE) {
      caveats.push(`${from} ↳ ${to} is low-confidence (${rel.confidence}%) — verify manually`);
    }
    if (rel.signals.nameSimilarity < 0.5 && rel.signals.valueOverlap >= 0.9) {
      caveats.push(
        `${from} ↳ ${to} matched mainly on data overlap with weak name evidence — possibly coincidental`
      );
    }
  }

  const linked = new Set<string>();
  for (const rel of relationships) {
    linked.add(rel.from.table);
    linked.add(rel.to.table);
  }
  const orphans = tableNames.filter((name) => !linked.has(name));
  if (orphans.length > 0) {
    caveats.push(`Tables with no inferred relationships: ${orphans.join(", ")}`);
  }

  return caveats;
}

export function buildExplanation(
  relationships: Relationship[],
  tableNames: string[]
): ExplainReport {
  return {
    relationships: relationships.map((relationship) => ({
      relationship,
      reasons: reasonsFor(relationship),
    })),
    caveats: caveatsFor(relationships, tableNames),
  };
}
