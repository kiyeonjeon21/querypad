/**
 * Engine-agnostic embedding interface. The term-search core never imports a concrete
 * model; the CLI injects one. Default model runs locally (Transformers.js); a BYOK API
 * embedder can implement the same type as a quality upgrade.
 */
export type Embedder = (texts: string[]) => Promise<number[][]>;

/** Local default: all-MiniLM-L6-v2, 384-dim, cross-surface (Node + browser). */
export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIM = 384;
