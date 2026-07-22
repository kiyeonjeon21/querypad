import type { Relationship, RelationshipVerdict } from "../types/discovery";
import { relationshipKey } from "./relationships";

/**
 * User curation of the inferred relationship graph, persisted as
 * `verdicts.json` in the artifact directory. Verdicts are keyed by
 * `relationshipKey`; overrides are full relationships the user edited or
 * added by hand (upserted by key).
 */
export interface VerdictsDoc {
  verdicts: Record<string, RelationshipVerdict>;
  overrides: Relationship[];
}

/** What `applyVerdicts` did, for logging. */
export interface CurationSummary {
  rejected: number;
  overridden: number;
  added: number;
}

export interface CuratedRelationships {
  relationships: Relationship[];
  summary: CurationSummary;
}

/**
 * Apply user verdicts to an inferred relationship list: drop rejected edges,
 * then upsert overrides by key. Pure and idempotent — safe to re-apply to an
 * already-curated list (rejected edges stay gone, overrides stay in place).
 */
export function applyVerdicts(
  relationships: Relationship[],
  doc: VerdictsDoc | null
): CuratedRelationships {
  if (!doc) {
    return { relationships, summary: { rejected: 0, overridden: 0, added: 0 } };
  }

  const verdicts = doc.verdicts ?? {};
  const overrides = doc.overrides ?? [];

  const kept = relationships.filter((rel) => verdicts[relationshipKey(rel)] !== "rejected");
  const rejected = relationships.length - kept.length;

  const byKey = new Map(kept.map((rel) => [relationshipKey(rel), rel]));
  let overridden = 0;
  let added = 0;
  for (const override of overrides) {
    const key = relationshipKey(override);
    // A rejected verdict on an override's key means the user removed it later.
    if (verdicts[key] === "rejected") continue;
    if (byKey.has(key)) overridden += 1;
    else added += 1;
    byKey.set(key, override);
  }

  return {
    relationships: [...byKey.values()],
    summary: { rejected, overridden, added },
  };
}
