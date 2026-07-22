import { singularize, splitTokens } from "./signals";
import type { TermEntry } from "./term-catalog";

/**
 * Resolve a natural-language term to catalog entries via a hybrid of lexical token overlap
 * and (optional) vector cosine, fused with Reciprocal Rank Fusion. Pure — no IO. The lexical
 * floor always works; vectors refine ranking when supplied (e.g. "revenue" → sum_amount).
 */

export interface ResolveOptions {
  /** Embedding of the query; pair with `entryVectors` (aligned to the catalog) for hybrid. */
  queryVector?: number[];
  entryVectors?: number[][];
  /** Number of results to return (default 5). */
  k?: number;
  /** RRF constant (default 60). */
  rrfK?: number;
}

export interface ResolvedTerm {
  entry: TermEntry;
  score: number;
}

function tokenSet(value: string): Set<string> {
  return new Set(splitTokens(value).map((t) => singularize(t.toLowerCase())));
}

/** Exact-match → 1; otherwise Jaccard overlap of singularized tokens. */
export function lexicalScore(query: string, term: string): number {
  if (query.trim().toLowerCase() === term.trim().toLowerCase()) return 1;
  const q = tokenSet(query);
  const t = tokenSet(term);
  if (q.size === 0 || t.size === 0) return 0;
  let intersection = 0;
  for (const tok of q) if (t.has(tok)) intersection += 1;
  return intersection / (q.size + t.size - intersection);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rank only the entries that actually scored (> 0) by descending score. Entries with no
 * signal in this modality are absent, so RRF gives them no credit — otherwise all-zero ties
 * would hand an arbitrary entry the top rank.
 */
function rankHits(scores: number[]): Map<number, number> {
  const hits = scores
    .map((score, index) => ({ score, index }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const ranks = new Map<number, number>();
  hits.forEach((item, position) => ranks.set(item.index, position + 1));
  return ranks;
}

export function resolveTerms(
  catalog: TermEntry[],
  query: string,
  options: ResolveOptions = {}
): ResolvedTerm[] {
  const k = options.k ?? 5;
  const rrfK = options.rrfK ?? 60;
  const n = catalog.length;

  const lexRanks = rankHits(catalog.map((entry) => lexicalScore(query, entry.term)));

  const useVectors =
    options.queryVector !== undefined &&
    options.entryVectors !== undefined &&
    options.entryVectors.length === n;
  const vecRanks = useVectors
    ? rankHits(options.entryVectors!.map((vec) => cosine(options.queryVector!, vec)))
    : null;

  const scored = catalog.map((entry, index) => {
    let score = lexRanks.has(index) ? 1 / (rrfK + lexRanks.get(index)!) : 0;
    if (vecRanks?.has(index)) score += 1 / (rrfK + vecRanks.get(index)!);
    return { entry, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
