// Local embedding runtime — bge-small-en-v1.5 via @xenova/transformers,
// per DECISIONS.md "Local embeddings, no paid APIs". The model (~34MB
// quantized ONNX) is downloaded from the HuggingFace hub on first use
// and cached; after that everything runs offline.

export interface Embedder {
  /** Model identifier recorded alongside stored vectors. */
  readonly id: string;
  /** Vector dimensionality. */
  readonly dim: number;
  /** Embed texts into L2-normalized vectors. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export class TransformersEmbedder implements Embedder {
  readonly id = "bge-small-en-v1.5";
  readonly dim = 384;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: Promise<any> | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private load(): Promise<any> {
    if (!this.pipe) {
      this.pipe = import("@xenova/transformers").then(({ pipeline }) =>
        pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", {
          quantized: true,
        }),
      );
    }
    return this.pipe;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    const vecs: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      vecs.push(new Float32Array(out.slice([i, i + 1]).data));
    }
    return vecs;
  }
}

/** Cosine similarity. Assumes both vectors are L2-normalized. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
