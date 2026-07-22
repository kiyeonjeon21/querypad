import { EMBED_MODEL, type Embedder } from "./embedder";

/**
 * Node default embedder backed by Transformers.js. The heavy dependency is loaded via a
 * dynamic import so it never enters the browser app bundle and is only paid for when the
 * user actually embeds (e.g. `inspect --embed`). The pipeline is created once and reused.
 */
type FeaturePipeline = (text: string, opts: unknown) => Promise<{ data: Float32Array }>;

export function createTransformersEmbedder(): Embedder {
  let pipelinePromise: Promise<FeaturePipeline> | null = null;

  const getPipeline = async (): Promise<FeaturePipeline> => {
    if (!pipelinePromise) {
      // Loose shape avoids pulling Transformers.js's very large pipeline() return union.
      const mod = (await import("@huggingface/transformers")) as {
        pipeline: (task: string, model: string, opts: unknown) => Promise<unknown>;
      };
      pipelinePromise = mod.pipeline("feature-extraction", EMBED_MODEL, {
        dtype: "q8",
      }) as Promise<FeaturePipeline>;
    }
    return pipelinePromise;
  };

  return async (texts: string[]) => {
    const pipe = await getPipeline();
    const vectors: number[][] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      vectors.push(Array.from(output.data));
    }
    return vectors;
  };
}
